// Orquestador Pro: ronda = plan (el usuario lo revisa) -> programar -> verificar por el otro motor
// (informe contra diff real) -> hasta 2 correcciones por decisión -> commit local al aceptar.
// El motor lógico "gemini" es Antigravity CLI (agy). Contrato: docs/PRO.md.
import { createStore, jobView, msgView } from "./store.js";
import { classifyTask } from "./classify.js";
import { planPrompt, codePrompt, fixPrompt, verifyPrompt, commitPrompt, consultPrompt, coordinatorSystem } from "./prompts.js";
import { parseAcciones, validar, contextoGroq, contarTurnos, MOTORES } from "./coordinator.js";
import { check, merge } from "./check.js";
import { redact, cleanDiff } from "./redact.js";
import { availability, repoValid, canonicalRepo } from "./availability.js";
import { classify as classifyText } from "../router/classify.js";
import { run } from "../db/client.js";

export class ProError extends Error {
  constructor(status, code, extra = {}) { super(code); this.status = status; this.code = code; this.extra = extra; }
}

const FINAL = ["hecha", "fallida", "cancelada"];
const other = (e) => (e === "claude" ? "gemini" : "claude");
const arr = (x) => (Array.isArray(x) ? x.map((v) => redact(String(v)).slice(0, 500)).slice(0, 100) : []);

function parseJson(x) {
  if (x && typeof x === "object") return x;
  const s = String(x ?? "");
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}
export function normInforme(x) {
  const o = parseJson(x);
  if (!o) return { dijo_hizo: [], archivos_tocados: [], comandos: [], resultado: "parcial: informe ilegible" };
  return { dijo_hizo: arr(o.dijo_hizo), archivos_tocados: arr(o.archivos_tocados), comandos: arr(o.comandos), resultado: redact(String(o.resultado || "parcial")).slice(0, 300) };
}
const humanInforme = (i) => `${i.dijo_hizo.length ? "Hice:\n" + i.dijo_hizo.map((d) => `- ${d}`).join("\n") : "Sin cambios declarados."}${i.archivos_tocados.length ? `\nArchivos: ${i.archivos_tocados.join(", ")}` : ""}${i.comandos.length ? `\nComandos: ${i.comandos.join("; ")}` : ""}\nResultado: ${i.resultado}`;
const humanVerif = (v) => {
  const l = (t, a) => (a.length ? `${t}:\n${a.map((d) => `- ${d}`).join("\n")}\n` : "");
  return `${l("Dijo y no hizo", v.dijo_no_hizo)}${l("Hizo y no dijo", v.hizo_no_dijo)}${l("Cambios ajenos", v.cambios_ajenos)}Veredicto: ${v.veredicto}`;
};

export function createOrchestrator({ db, bus, agent, approvals, audit, permissions, config, now = () => Date.now(), textProvider, quota = null, groq = () => null }) {
  const store = createStore({ db, now });
  const lim = config.limites || {};
  const cc = config.coordinador || {};
  const maxCorr = lim.correcciones_max ?? 2;
  const tmo = config.timeouts || {};

  const emitRound = (userId, r) => bus.emit("pro.round", { userId, thread_id: r.thread_id, round: { id: r.id, status: r.status, corrections: r.corrections, programmer: r.programmer, verifier: r.verifier, summary: r.summary } });
  async function setRound(userId, id, patch) { const r = await store.updateRound(userId, id, patch); emitRound(userId, r); return r; }
  async function say(userId, thread_id, round_id, author, kind, text, meta) {
    const m = await store.addMessage({ threadId: thread_id, userId, roundId: round_id, author, kind, text: redact(String(text)).slice(0, lim.informe_max_caracteres ?? 20000), meta });
    bus.emit("pro.message", { userId, thread_id, message: { id: m.id, author: m.author, kind: m.kind, text: m.text, meta: m.meta, created_at: m.created_at } });
    return m;
  }
  const using = (userId, engine) => bus.emit("pc.using", { userId, id: engine === "claude" ? "claude_pc" : "gemini" });

  function modelFor(engine, role) {
    if (role === "commit") return null;
    const m = config.modelos?.[engine]?.[role === "consultar" ? "verificar" : role];
    return Array.isArray(m) ? m[0] : m || null;
  }
  async function enqueue(userId, round, thread, role, engine, prompt) {
    const row = await store.createJob({ roundId: round.id, threadId: thread.id, userId, role, engine, model: modelFor(engine, role), repo: thread.repo,
      prompt: redact(prompt), mode: role === "programar" || role === "commit" ? "editar" : "solo_lectura" });
    return row;
  }
  async function ctxOf(userId, round) {
    const thread = await store.getThread(userId, round.thread_id);
    const msgs = await store.listMessages(thread.id);
    const request = msgs.find((m) => m.id === round.message_id)?.text || "";
    const plan = [...msgs].reverse().find((m) => m.round_id === round.id && m.kind === "plan")?.text || "";
    const jobs = await store.jobsOfRound(round.id);
    return { thread, request, plan, jobs };
  }
  const programmed = (jobs) => jobs.some((j) => j.role === "programar" && j.status === "hecho");

  // ---------- coordinador (Groq) ----------
  // Interruptor: config + ajuste del usuario (por defecto encendido). "disponible" = Groq tiene clave.
  async function coordinadorEstado(userId) {
    const activo = cc.enabled !== false && (await store.getSetting(userId, "pro_coordinador")) !== "0";
    return { activo, disponible: !!groq()?.enabled };
  }
  async function llamarGroq(userId, req) {
    const g = groq();
    if (!g?.enabled) return null;
    try {
      if (quota && !(await quota.check(userId, "groq")).ok) return null;
      const r = await g.chat({ ...req, params: cc.groq, signal: AbortSignal.timeout((cc.timeout_s ?? 20) * 1000) });
      if (quota) { await quota.record(userId, "groq", r.tokens); await quota.ingestHeaders(userId, "groq", r.headers); }
      return r.text;
    } catch (e) {
      await quota?.pauseOnError(userId, "groq", { status: e.status, headers: e.headers, message: e.message }).catch(() => {});
      return null;
    }
  }
  // Un turno de Groq sobre la ronda. true = lo gestionó; false = fallar a mano (flujo determinista de siempre).
  async function coordinar(userId, roundId) {
    const round = await store.getRound(userId, roundId);
    if (!round || round.status !== "coordinando") return true;
    if ((await store.coordTurnsToday(userId)) >= (cc.turnos_dia ?? 40)) return false;
    const { thread, jobs } = await ctxOf(userId, round);
    const msgs = await store.listMessages(thread.id);
    const limite = jobs.filter((j) => j.role === "consultar").length >= (cc.max_consultas_sin_usuario ?? 3) || contarTurnos(msgs, round.id) >= (cc.max_turnos_sin_usuario ?? 6);
    const raw = await llamarGroq(userId, { system: coordinatorSystem({ limite }), messages: [{ role: "user", content: contextoGroq({ thread, msgs, roundId: round.id }) }] });
    const parsed = raw == null ? null : parseAcciones(raw);
    const acciones = parsed ? validar(parsed.acciones, { limite, aprobado: false }) : [];
    if (parsed && !acciones.length && limite) { // quiso seguir consultando pasado el límite: se avisa al usuario y se para
      await say(userId, thread.id, round.id, "jarvis", "coordinador", "Llegué al límite de consultas sin su intervención. Dígame cómo seguimos.");
      await setRound(userId, round.id, { status: "conversando", summary: null });
      return true;
    }
    if (!acciones.length) return false;
    if (parsed.resumen) await store.setResumen(thread.id, redact(parsed.resumen));
    const T = thread.id, R = round.id;
    const habla = acciones.filter((a) => a.tipo === "hablar").map((a) => a.texto);
    const cons = acciones.find((a) => a.tipo === "consultar"), prop = acciones.find((a) => a.tipo === "proponer");
    // Cada turno deja exactamente un mensaje "coordinador" (sirve para contar turnos).
    await say(userId, T, R, "jarvis", "coordinador", habla.join("\n\n") || (cons ? `Consulto a ${cons.a === "claude" ? "Claude" : "Gemini"}.` : prop ? "Le propongo cómo seguir." : "Por ahora paro aquí."));
    if (prop) {
      await say(userId, T, R, "jarvis", "propuesta", prop.texto || `Programa ${prop.programador}, verifica ${prop.verificador}.`, { programador: prop.programador, verificador: prop.verificador, nota: prop.nota || null });
    }
    if (cons) {
      await say(userId, T, R, "jarvis", "consulta", cons.pregunta, { a: cons.a, pregunta: true });
      const opiniones = msgs.filter((m) => m.round_id === R && m.kind === "consulta" && m.author === (cons.a === "claude" ? "gemini" : "claude")).map((m) => m.text).slice(-2);
      await enqueue(userId, round, thread, "consultar", cons.a, consultPrompt({ pregunta: cons.pregunta, opiniones, engine: cons.a }));
      return true; // la ronda sigue en "coordinando" hasta que llegue la respuesta
    }
    await setRound(userId, R, { status: "conversando", summary: prop ? "Propuesta lista: apruébela para empezar" : null });
    return true;
  }
  // Fallback: sin Groq, o si falla, la ronda arranca planeando como siempre.
  async function arrancarPlan(userId, round, nota) {
    const { thread, request } = await ctxOf(userId, round);
    await enqueue(userId, round, thread, "planear", round.programmer, planPrompt({ request, engine: round.programmer, nota }));
    return setRound(userId, round.id, { status: "planeando", corrections: 0, summary: null });
  }
  const coordinarOFallback = async (userId, roundId) => {
    let ok = false;
    try { ok = await coordinar(userId, roundId); } catch { ok = false; }
    if (!ok) { const r = await store.getRound(userId, roundId); if (r && r.status === "coordinando") await arrancarPlan(userId, r); }
  };

  const orch = {
    store,
    status: (userId) => availability({ agent, config }),
    // ---------- web ----------
    async createThread(userId, { title, repo }) {
      if (!repoValid(repo, { agent, permissions })) throw new ProError(422, "repo_invalido");
      return store.createThread(userId, { title: redact(String(title || "Nuevo hilo")).slice(0, 80), repo: canonicalRepo(repo, agent) });
    },
    async send(userId, threadId, text, { privado = false } = {}) {
      const thread = await store.getThread(userId, threadId);
      if (!thread) throw new ProError(404, "no_existe");
      const t = String(text || "").trim();
      if (!t || t.length > (lim.mensaje_max_caracteres ?? 8000)) throw new ProError(400, "texto_invalido");
      const av = availability({ agent, config });
      if (!av.habilitado) throw new ProError(409, "pro_deshabilitado", { motivos: av.motivos });
      if (privado || classifyText(t, { flagPrivate: privado }).private) throw new ProError(422, "privado");
      if (!repoValid(thread.repo, { agent, permissions })) throw new ProError(422, "repo_invalido");
      if (await store.activeRound(threadId)) throw new ProError(409, "ronda_activa");
      const safe = redact(t);
      const msg = await say(userId, threadId, null, "usuario", "texto", safe, safe !== t ? { redactado: true } : null);
      const c = await classifyTask(safe, { textProvider });
      let round = await store.createRound({ threadId, userId, messageId: msg.id, taskKind: c.task_kind, programmer: c.programmer, verifier: c.verifier });
      emitRound(userId, round);
      if ((await coordinadorEstado(userId)).activo && groq()?.enabled) { // Groq coordina; si falla, sigue el flujo de siempre
        round = await setRound(userId, round.id, { status: "coordinando" });
        await coordinarOFallback(userId, round.id);
        return { message: msg, round: await store.getRound(userId, round.id) };
      }
      await enqueue(userId, round, thread, "planear", c.programmer, planPrompt({ request: safe, engine: c.programmer }));
      return { message: msg, round };
    },
    // El usuario aprueba la propuesta del coordinador (botón): arranca la ronda con esos motores y el plan.
    async iniciar(userId, roundId, { motor } = {}) {
      const round = await store.getRound(userId, roundId);
      if (!round) throw new ProError(404, "no_existe");
      if (round.status !== "conversando") throw new ProError(409, "estado_invalido");
      const msgs = await store.listMessages(round.thread_id);
      const prop = [...msgs].reverse().find((m) => m.round_id === round.id && m.kind === "propuesta");
      if (!prop || !MOTORES.includes(prop.meta?.programador)) throw new ProError(409, "estado_invalido");
      const programmer = MOTORES.includes(motor) ? motor : prop.meta.programador;
      const r = await store.updateRound(userId, round.id, { programmer, verifier: other(programmer) });
      return { round: await arrancarPlan(userId, r, prop.meta.nota) };
    },
    coordinadorEstado,
    async setCoordinador(userId, activo) { await store.setSetting(userId, "pro_coordinador", activo ? "1" : "0"); return coordinadorEstado(userId); },
    async decide(userId, roundId, { accion, text, motor } = {}) {
      let round = await store.getRound(userId, roundId);
      if (!round) throw new ProError(404, "no_existe");
      if (!["aprobar", "rechazar", "corregir"].includes(accion)) throw new ProError(400, "accion_invalida");
      if (!["esperando_aprobacion", "necesita_usuario"].includes(round.status)) throw new ProError(409, "estado_invalido");
      const { thread, request, plan, jobs } = await ctxOf(userId, round);
      const userText = redact(String(text || "")).slice(0, lim.mensaje_max_caracteres ?? 8000);
      if (userText) await say(userId, thread.id, round.id, "usuario", "texto", userText);
      if (accion === "rechazar") {
        round = await setRound(userId, round.id, { status: "cancelada", summary: programmed(jobs) ? "Rechazada; los cambios quedan sin commit en el repo" : "Rechazada" });
        return { round };
      }
      if (motor && ["claude", "gemini"].includes(motor) && !programmed(jobs)) round = await store.updateRound(userId, round.id, { programmer: motor, verifier: other(motor) });
      if (accion === "aprobar") {
        if (programmed(jobs)) { // aceptar la ronda -> commit local
          if (jobs.some((j) => j.role === "commit" && j.status !== "fallido" && j.status !== "cancelado")) throw new ProError(409, "commit_en_curso");
          const first = request.split("\n")[0].slice(0, 60);
          await enqueue(userId, round, thread, "commit", round.programmer, commitPrompt(`Jarvis Pro: ${first}`));
          round = await setRound(userId, round.id, { status: "esperando_aprobacion", summary: "Haciendo commit local..." });
        } else {
          if (!plan) throw new ProError(409, "estado_invalido");
          await enqueue(userId, round, thread, "programar", round.programmer, codePrompt({ request, plan, engine: round.programmer }));
          round = await setRound(userId, round.id, { status: "programando", corrections: 0, summary: null });
        }
      } else if (programmed(jobs)) { // corregir con indicación del usuario; reinicia el contador
        const v = (await store.lastReport(round.id, "verificacion"))?.body;
        await enqueue(userId, round, thread, "programar", round.programmer, fixPrompt({ request, plan, verification: v, userText, engine: round.programmer }));
        round = await setRound(userId, round.id, { status: "corrigiendo", corrections: 0, summary: null });
      } else { // replanificar
        await enqueue(userId, round, thread, "planear", round.programmer, planPrompt({ request, engine: round.programmer, feedback: userText }));
        round = await setRound(userId, round.id, { status: "planeando", corrections: 0, summary: null });
      }
      return { round };
    },
    async cancel(userId, roundId) {
      let round = await store.getRound(userId, roundId);
      if (!round) throw new ProError(404, "no_existe");
      if (FINAL.includes(round.status)) return { round };
      for (const j of await store.liveJobs(round.id)) await store.updateJob(j.id, { status: "cancelado", finished_at: now() });
      round = await setRound(userId, round.id, { status: "cancelada", summary: "Cancelada por el usuario" });
      await say(userId, round.thread_id, round.id, "jarvis", "sistema", "Ronda cancelada.");
      return { round };
    },
    async threadView(userId, id) {
      const thread = await store.getThread(userId, id);
      if (!thread) return null;
      return { thread, messages: await store.listMessages(id), rounds: await store.listRounds(id) };
    },
    async jobDetail(userId, id) {
      const row = await store.getJobRow(userId, id);
      if (!row) return null;
      return { job: jobView(row), report: (await store.reportsOfJob(id)).at(-1) || null, diff: row.diff || "" };
    },
    // ---------- PC ----------
    async claim(userId, { again } = {}) {
      await store.requeueStale(userId, (tmo.job_reclamado_s ?? 60) * 1000);
      for (let i = 0; i < 5; i++) {
        let row = null;
        if (again && i === 0) { const r = await store.getJobRow(userId, Number(again)); if (r && ["reclamado", "en_curso"].includes(r.status)) row = r; }
        row = row || (await store.claimNext(userId));
        if (!row) return { job: null };
        if (!repoValid(row.repo, { agent, permissions })) { await orch.fail(userId, row.id, { error: "repo_invalido" }); continue; }
        using(userId, row.engine);
        const fb = row.engine === "gemini" && row.role === "programar" && Array.isArray(config.modelos?.gemini?.programar) ? config.modelos.gemini.programar.slice(1) : [];
        const to = { planear: tmo.planear_s, programar: tmo.programar_s, verificar: tmo.verificar_s, consultar: tmo.consultar_s ?? 120, commit: 120 }[row.role] ?? 300;
        return { job: { id: Number(row.id), round_id: Number(row.round_id), role: row.role, engine: row.engine, model: row.model, repo: row.repo, mode: row.mode, prompt: row.prompt, timeout_s: to, ...(fb.length ? { fallback_models: fb, fallback_solo_por: config.modelos.gemini.programar_baja_solo_por || [503] } : {}) } };
      }
      return { job: null };
    },
    async events(userId, jobId, events) {
      const row = await store.getJobRow(userId, jobId);
      if (!row) throw new ProError(404, "no_existe");
      if (row.status === "cancelado") return { ok: true, cancelado: true };
      if (row.status === "reclamado" || row.status === "pendiente") await store.updateJob(row.id, { status: "en_curso" });
      using(userId, row.engine);
      for (const e of (Array.isArray(events) ? events : []).slice(0, 50)) {
        bus.emit("pro.delta", { userId, thread_id: Number(row.thread_id), round_id: Number(row.round_id), job_id: Number(row.id), author: row.engine, text: redact(String(e?.text || "")).slice(0, 2000) });
      }
      return { ok: true };
    },
    async requestApproval(userId, jobId, { kind, summary, detail } = {}) {
      const row = await store.getJobRow(userId, jobId);
      if (!row) throw new ProError(404, "no_existe");
      if (!kind || !summary) throw new ProError(400, "faltan_datos");
      const a = await approvals.request({ userId, kind: String(kind).slice(0, 40), summary: redact(String(summary)).slice(0, 200), detail: redact(String(detail || "")).slice(0, 1000) });
      await run(db, "UPDATE approvals SET pro_job_id=? WHERE id=?", [row.id, a.id]);
      return { approval: { ...a, pro_job_id: Number(row.id) } };
    },
    async report(userId, jobId, body = {}) {
      const row = await store.getJobRow(userId, jobId);
      if (!row) throw new ProError(404, "no_existe");
      if (row.status === "hecho") return { ok: true, duplicado: true };
      if (row.status === "cancelado") return { ok: true, ignorado: true };
      if (row.status === "fallido") throw new ProError(409, "job_cerrado");
      const diff = cleanDiff(body.diff, lim.diff_max_caracteres ?? 200000);
      const changed = await store.closeJob(row.id, { status: "hecho", tree_before: body.tree_before ? String(body.tree_before).slice(0, 80) : null, tree_after: body.tree_after ? String(body.tree_after).slice(0, 80) : null, diff, finished_at: now() });
      if (!changed) return { ok: true, duplicado: true };
      await store.addUsage({ userId, engine: row.engine, model: row.model, role: row.role, jobId: row.id, ...(body.usage || {}) });
      let round = await store.getRound(userId, row.round_id);
      if (!round || FINAL.includes(round.status)) return { ok: true, ignorado: true };
      const { thread, request, plan, jobs } = await ctxOf(userId, round);
      const T = thread.id;
      try {
        if (row.role === "planear") {
          const raw = body.informe;
          const txt = typeof raw === "string" ? raw : raw?.plan || raw?.texto || JSON.stringify(raw || "");
          await store.addReport({ jobId: row.id, roundId: round.id, kind: "informe", body: { plan: redact(txt) } });
          await say(userId, T, round.id, row.engine, "plan", txt, { job_id: Number(row.id), model: row.model });
          await setRound(userId, round.id, { status: "esperando_aprobacion", summary: "Plan listo para tu revisión" });
        } else if (row.role === "consultar") { // opinión de solo lectura: se muestra y Groq retoma el turno
          const txt = typeof body.informe === "string" ? body.informe : body.informe?.plan || body.informe?.texto || JSON.stringify(body.informe || "");
          await say(userId, T, round.id, row.engine, "consulta", txt, { job_id: Number(row.id), model: row.model });
          await coordinarOFallback(userId, round.id);
        } else if (row.role === "programar") {
          const inf = normInforme(body.informe);
          await store.addReport({ jobId: row.id, roundId: round.id, kind: "informe", body: inf });
          await say(userId, T, round.id, row.engine, "informe", humanInforme(inf), { job_id: Number(row.id), model: row.model });
          const v = await enqueue(userId, round, thread, "verificar", round.verifier, verifyPrompt({ request, plan, informe: inf, diff, det: check({ informe: inf, diff }), engine: round.verifier }));
          await setRound(userId, round.id, { status: "verificando", summary: null });
          void v;
        } else if (row.role === "verificar") {
          const prog = [...jobs].reverse().find((j) => j.role === "programar" && j.status === "hecho");
          const inf = prog ? (await store.reportsOfJob(prog.id)).at(-1)?.body : null;
          const det = check({ informe: inf, diff: prog?.diff || "" });
          const raw = parseJson(body.informe);
          const ai = raw && raw.veredicto ? raw : null;
          const v = merge(det, ai);
          await store.addReport({ jobId: row.id, roundId: round.id, kind: "verificacion", body: v });
          await say(userId, T, round.id, row.engine, "verificacion", humanVerif(v), { job_id: Number(row.id), model: row.model, veredicto: v.veredicto });
          if (v.veredicto === "aprobado") {
            await setRound(userId, round.id, { status: "esperando_aprobacion", summary: "Verificado: aprobado. Acepta para hacer commit local." });
          } else if (v.veredicto === "corregir" && round.corrections < maxCorr) {
            await enqueue(userId, round, thread, "programar", round.programmer, fixPrompt({ request, plan, verification: v, engine: round.programmer }));
            await setRound(userId, round.id, { status: "corrigiendo", corrections: round.corrections + 1, summary: null });
          } else {
            const why = v.veredicto === "corregir" ? `Se agotaron las ${maxCorr} correcciones` : "El verificador pide tu decisión";
            await setRound(userId, round.id, { status: "necesita_usuario", summary: why });
            await say(userId, T, round.id, "jarvis", "sistema", `${why}. Puedes aceptar igualmente, pedir una corrección (reinicia el contador) o rechazar.`);
          }
        } else if (row.role === "commit") {
          await setRound(userId, round.id, { status: "hecha", summary: "Aceptada y commiteada en local" });
          await say(userId, T, round.id, "jarvis", "sistema", "Ronda aceptada: commit local hecho (sin push).");
          await audit?.log({ userId, action: "pro.commit", detail: `ronda ${round.id}` });
        }
      } catch (e) {
        await setRound(userId, round.id, { status: "fallida", summary: "Error interno del orquestador" });
        await say(userId, T, round.id, "jarvis", "sistema", `Error interno: ${String(e.message).slice(0, 200)}`);
      }
      return { ok: true };
    },
    async fail(userId, jobId, { error } = {}) {
      const row = await store.getJobRow(userId, jobId);
      if (!row) throw new ProError(404, "no_existe");
      if (row.status === "fallido" || row.status === "hecho" || row.status === "cancelado") return { ok: true, duplicado: true };
      const err = redact(String(error || "error")).slice(0, 300);
      if (!(await store.closeJob(row.id, { status: "fallido", error: err, finished_at: now() }))) return { ok: true, duplicado: true };
      const round = await store.getRound(userId, row.round_id);
      if (!round || FINAL.includes(round.status)) return { ok: true };
      const code = err.split(/[\s:]/)[0];
      const T = round.thread_id;
      const nombre = row.engine === "claude" ? "Claude" : "Gemini (agy)";
      if (row.role === "consultar") { // la consulta es opcional: el usuario decide cómo seguir
        await setRound(userId, round.id, { status: "conversando", summary: null });
        await say(userId, T, round.id, "jarvis", "sistema", `No pude consultar a ${nombre} (${err}). Dígame cómo seguimos.`);
      } else if (row.role === "commit") {
        await setRound(userId, round.id, { status: "esperando_aprobacion", summary: "El commit falló; puedes reintentar" });
        await say(userId, T, round.id, "jarvis", "sistema", `No se pudo hacer el commit local (${err}). Puedes volver a aceptar.`);
      } else if (code === "sin_cuota") {
        await setRound(userId, round.id, { status: "necesita_usuario", summary: `${nombre} sin cuota (${row.role})` });
        await say(userId, T, round.id, "jarvis", "sistema", `${nombre} no tiene cuota para ${row.role}. No cambio de modelo en silencio: reintenta más tarde (corregir), usa el otro motor (corregir con motor) o cancela.`);
      } else {
        await setRound(userId, round.id, { status: "fallida", summary: `${row.role} falló: ${code}` });
        await say(userId, T, round.id, "jarvis", "sistema", `El paso "${row.role}" con ${nombre} falló: ${err}.`);
      }
      return { ok: true };
    },
  };
  return orch;
}
