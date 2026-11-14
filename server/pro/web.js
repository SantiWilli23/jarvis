// Pro web: Groq traduce el pedido a un prompt técnico; el usuario lo envía a Claude Code web o Jules.
// El resultado llega por la API de GitHub (solo lectura). Jarvis NUNCA fusiona ni escribe en GitHub.
// No usa pro_jobs: así pro-worker.js (PC) jamás reclama un envío web.
import { validRef } from "../connectors/github.js";
import { envioView } from "./store.js";
import { redact, isSensitivePath } from "./redact.js";
import { filtrar, cita, webPrompt, revisionPrompt, traductorSystem, resumenSystem } from "./prompts.js";
import { parseAcciones, validar, contextoTraductor } from "./traductor.js";
import { classify as classifyText } from "../router/classify.js";

const FINAL = ["hecha", "fallida", "cancelada"];
const ABIERTA = ["en_curso_web", "necesita_usuario", "resultado_listo"];
const SUGERIDOS_TOOL = { claude_web: "jules", jules: "claude_web" };

export function createProWeb({ store, say, setRound, llamarGroq, groq, github, browser, chat, agent, audit, config, ProError, now = () => Date.now() }) {
  const cw = config.web || {};
  const cc = config.coordinador || {};
  const dests = cw.destinos || {};
  const gh = () => github?.();
  const log = (userId, action, detail) => audit?.log({ userId, action, detail });
  const ghErr = () => new ProError(502, "github_error");

  async function disponibilidad() {
    const g = gh(), motivos = [];
    if (!g?.enabled) motivos.push(g?.rechazadas?.[0]?.motivo === "github_llave_clasica" ? "github_llave_clasica" : g?.rechazadas?.length ? "github_llave_invalida" : "github_sin_llave");
    else { try { await g.cuentas(); } catch { motivos.push("github_llave_invalida"); } }
    const b = browser?.();
    return {
      habilitado: motivos.length === 0, motivos,
      destinos: { claude_web: { asistido: !!(b?.activo?.() && agent.view().online), copiar: true }, jules: { copiar: true } },
      traductor: !!groq()?.enabled,
    };
  }
  async function exigirHabilitado() {
    const av = await disponibilidad();
    if (!av.habilitado) throw new ProError(409, "web_deshabilitado", { motivos: av.motivos });
  }

  // ---------- hilo: repo y rama SOLO del cuerpo de la petición ----------
  async function repoCanon(ghRepo) {
    let lista;
    try { lista = await gh().repos(); } catch { throw ghErr(); }
    const k = String(ghRepo || "").toLowerCase();
    const x = lista.find((r) => String(r.full_name).toLowerCase() === k);
    if (!x) throw new ProError(422, "repo_invalido");
    return x.full_name;
  }
  async function ramaOk(full, rama) {
    if (!validRef(rama)) throw new ProError(422, "rama_invalida");
    let lista;
    try { lista = await gh().ramas(full); } catch { throw ghErr(); }
    if (lista.some((b) => b.name === rama)) return rama;
    if (lista.length >= 100) { try { await gh().rama(full, rama); return rama; } catch { /* no existe */ } }
    throw new ProError(422, "rama_invalida");
  }
  async function crearHilo(userId, { title, gh_repo, gh_rama }) {
    await exigirHabilitado();
    const full = await repoCanon(gh_repo);
    const rama = await ramaOk(full, gh_rama);
    const t = await store.createWebThread(userId, { title: redact(String(title || "Nuevo hilo")).slice(0, 80), ghRepo: full, ghRama: rama });
    log(userId, "pro.repo_elegido", `${full}@${rama} hilo ${t.id}`);
    return t;
  }
  async function cambiarRama(userId, threadId, gh_rama) {
    const t = await store.getThread(userId, threadId);
    if (!t) throw new ProError(404, "no_existe");
    if (t.modo !== "web") throw new ProError(409, "no_es_web");
    await exigirHabilitado();
    const rama = await ramaOk(await repoCanon(t.gh_repo), gh_rama);
    const out = await store.setGhRama(userId, threadId, rama);
    log(userId, "pro.repo_elegido", `${t.gh_repo}@${rama} hilo ${t.id}`);
    return out;
  }

  // ---------- traducir (Groq opcional) ----------
  const lastPrompt = async (roundId, threadId) => [...(await store.listMessages(threadId))].reverse().find((m) => m.round_id === roundId && m.kind === "prompt");
  async function traducir(userId, round) {
    const thread = await store.getThread(userId, round.thread_id);
    const msgs = await store.listMessages(thread.id);
    const turnos = msgs.filter((m) => m.round_id === round.id && m.kind === "coordinador").length;
    const limite = turnos >= (cc.max_turnos_sin_usuario ?? 6);
    let parsed = null;
    if (groq()?.enabled && cc.enabled !== false && (await store.coordTurnsToday(userId)) < (cc.turnos_dia ?? 40)) {
      let archivos = [];
      try { archivos = (await gh().arbol(thread.gh_repo, thread.gh_rama)).archivos; } catch { /* sin árbol */ }
      const raw = await llamarGroq(userId, { system: traductorSystem({ limite }), messages: [{ role: "user", content: contextoTraductor({ thread, msgs, archivos }) }] });
      parsed = raw == null ? null : parseAcciones(raw);
    }
    const acciones = parsed ? validar(parsed.acciones, { limite }) : [];
    if (parsed?.resumen) await store.setResumen(thread.id, redact(parsed.resumen));
    const T = thread.id, R = round.id;
    if (!acciones.length) { // sin Groq (o sin acción válida): plantilla con el texto del usuario
      const pedido = msgs.filter((m) => m.round_id === R && m.author === "usuario" && m.kind === "texto").map((m) => m.text).join("\n");
      await say(userId, T, R, "jarvis", "sistema", "Sin traductor disponible: uso su texto tal cual como prompt. Revíselo antes de enviarlo.");
      await say(userId, T, R, "jarvis", "prompt", pedido, { destino_sugerido: "claude_web", prompt: pedido, criterios: [], plantilla: true });
      return setRound(userId, R, { status: "prompt_listo", summary: "Prompt listo (plantilla)" });
    }
    const habla = acciones.filter((a) => a.tipo === "hablar" || a.tipo === "preguntar").map((a) => a.texto);
    const red = acciones.find((a) => a.tipo === "redactar");
    await say(userId, T, R, "jarvis", "coordinador", habla.join("\n\n") || (red ? "Le dejo el prompt redactado." : "Por ahora paro aquí."));
    if (red) {
      await say(userId, T, R, "jarvis", "prompt", red.prompt, { destino_sugerido: red.destino_sugerido, prompt: red.prompt, criterios: red.criterios });
      return setRound(userId, R, { status: "prompt_listo", summary: "Prompt listo: elija dónde enviarlo" });
    }
    return setRound(userId, R, { status: "conversando", summary: null });
  }

  async function mensaje(userId, thread, text, { privado = false } = {}) {
    const t = String(text || "").trim();
    if (!t || t.length > 8000) throw new ProError(400, "texto_invalido");
    await exigirHabilitado();
    if (privado || classifyText(t, { flagPrivate: privado }).private || (await chat().checkPrivate({ userId, text: t, flagPrivate: privado })).private) throw new ProError(422, "privado");
    const safe = redact(t);
    let round = await store.activeRound(thread.id);
    if (round && !["conversando", "prompt_listo"].includes(round.status)) throw new ProError(409, "ronda_activa");
    if (!round) {
      round = await store.createRound({ threadId: thread.id, userId, messageId: null, taskKind: "web", programmer: "claude_web", verifier: "jules" });
      if (!round) throw new ProError(409, "ronda_activa");
      const msg = await say(userId, thread.id, round.id, "usuario", "texto", safe, safe !== t ? { redactado: true } : null);
      round = await setRound(userId, round.id, { message_id: msg.id, status: "traduciendo" });
      round = await traducir(userId, round);
      return { message: msg, round };
    }
    const msg = await say(userId, thread.id, round.id, "usuario", "texto", safe, safe !== t ? { redactado: true } : null);
    round = await setRound(userId, round.id, { status: "traduciendo" });
    return { message: msg, round: await traducir(userId, round) };
  }

  // ---------- enviar ----------
  const getRoundThread = async (userId, roundId) => {
    const round = await store.getRound(userId, roundId);
    if (!round) throw new ProError(404, "no_existe");
    const thread = await store.getThread(userId, round.thread_id);
    if (thread?.modo !== "web") throw new ProError(409, "no_es_web");
    return { round, thread };
  };
  async function foto(thread) {
    try {
      const ramas = (await gh().ramas(thread.gh_repo)).map((b) => ({ name: b.name, sha: b.commit?.sha || null }));
      const prs = (await gh().prs(thread.gh_repo)).map((p) => Number(p.number));
      return { ramas, prs };
    } catch { throw ghErr(); }
  }
  async function crearEnvio(userId, round, thread, { destino, modo, rol, texto }) {
    const d = dests[destino];
    if (!d) throw new ProError(422, "destino_invalido");
    if (!["asistido", "copiar"].includes(modo)) throw new ProError(422, "modo_invalido");
    if (!["programar", "revisar"].includes(rol)) throw new ProError(422, "rol_invalido");
    if (d.extra && rol === "revisar") throw new ProError(422, "destino_invalido");
    await exigirHabilitado();
    const prompt = texto.slice(0, cw.prompt_max_caracteres ?? 7000);
    const priv = await chat().checkPrivate({ userId, text: prompt });
    if (priv.private) throw new ProError(422, "privado");
    if ((await store.enviosHoy(userId)) >= (cw.envios_dia ?? 20)) throw new ProError(429, "tope_dia");
    if (modo === "asistido" && (!d.sitio || !browser?.().activo?.() || !agent.view().online)) throw new ProError(409, "asistido_no_disponible");
    const f = await foto(thread);
    let tarea = null;
    if (modo === "asistido") {
      try { tarea = await browser().enqueue({ userId, site: d.sitio, prompt, proRoundId: round.id }); }
      catch (e) { if (e?.error) throw new ProError(e.status || 400, e.error); throw e; }
    }
    const row = await store.createEnvio({ roundId: round.id, threadId: thread.id, userId, destino, rol, prompt, ramasAntes: f.ramas, prsAntes: f.prs });
    await store.updateEnvio(row.id, { status: tarea ? "preparando" : "copiado", ...(tarea ? { browser_task_id: tarea.id } : {}) });
    const r = await setRound(userId, round.id, { status: "en_curso_web", summary: `Enviado a ${d.nombre}: espere el resultado en GitHub` });
    log(userId, "pro.web.enviar", `${destino} ${modo} ronda ${round.id} envio ${row.id}`);
    return { envio: await envioFull(userId, row.id), prompt, url: d.url, round: r, ...(tarea ? { tarea: { id: tarea.id, status: tarea.status } } : {}) };
  }
  async function enviar(userId, roundId, { destino, modo = "copiar", rol = "programar", prompt_editado } = {}) {
    const { round, thread } = await getRoundThread(userId, roundId);
    if (!["prompt_listo", "en_curso_web"].includes(round.status)) throw new ProError(409, "estado_invalido");
    if (rol !== "programar") throw new ProError(422, "rol_invalido"); // la revisión va por /revisar
    const pm = await lastPrompt(round.id, thread.id);
    if (!pm) throw new ProError(409, "sin_prompt");
    const base = typeof prompt_editado === "string" && prompt_editado.trim() ? prompt_editado.trim().slice(0, 5000) : pm.meta.prompt;
    const texto = webPrompt({ repo: thread.gh_repo, rama: thread.gh_rama, prompt: base, criterios: pm.meta.criterios || [] });
    return crearEnvio(userId, round, thread, { destino: String(destino || ""), modo, rol, texto });
  }
  async function revisar(userId, roundId, { destino, modo = "copiar" } = {}) {
    const { round, thread } = await getRoundThread(userId, roundId);
    if (!ABIERTA.includes(round.status)) throw new ProError(409, "estado_invalido");
    const envios = await store.enviosOfRound(round.id);
    const prog = [...envios].reverse().find((e) => e.rol === "programar" && e.resultado);
    if (!prog) throw new ProError(409, "sin_resultado_vinculado");
    const res = JSON.parse(prog.resultado);
    const otra = SUGERIDOS_TOOL[prog.destino];
    if (!otra) throw new ProError(422, "destino_invalido");
    destino = destino || otra;
    if (destino === prog.destino) throw new ProError(422, "misma_herramienta");
    if (destino !== otra) throw new ProError(422, "destino_invalido");
    const pm = await lastPrompt(round.id, thread.id);
    const texto = revisionPrompt({ repo: thread.gh_repo, rama: thread.gh_rama, head: res.head, criterios: pm?.meta?.criterios || [], pedido: pm?.meta?.prompt || "" });
    return crearEnvio(userId, round, thread, { destino, modo, rol: "revisar", texto });
  }
  async function yaEnviado(userId, roundId, { envio_id } = {}) {
    const { round } = await getRoundThread(userId, roundId);
    const envios = await store.enviosOfRound(round.id);
    const e = envio_id ? envios.find((x) => x.id === Number(envio_id)) : envios.at(-1);
    if (!e) throw new ProError(404, "no_existe");
    await store.updateEnvio(e.id, { status: "enviado", sent_at: now() });
    return { ok: true, envio: await envioFull(userId, e.id) };
  }
  async function envioFull(userId, id) { return envioView(await store.getEnvioRow(userId, id)); }

  // ---------- resultado: API de GitHub ----------
  const mismo = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();
  async function validarPr(full, n) {
    let pr;
    try { pr = await gh().pr(full, n); } catch { throw new ProError(422, "pr_invalido"); }
    if (!mismo(pr?.head?.repo?.full_name, full) || !mismo(pr?.base?.repo?.full_name, full)) throw new ProError(422, "fork_no_permitido");
    if (!String(pr.html_url || "").startsWith(`https://github.com/${full}/`)) throw new ProError(422, "url_invalida");
    return pr;
  }
  async function sincronizarTarea(userId, e) {
    if (!e.browser_task_id || !["preparando", "prompt_listo"].includes(e.status)) return e;
    const t = await browser().get(userId, e.browser_task_id);
    if (!t) return e;
    if (t.status === "prompt_listo" && e.status !== "prompt_listo") await store.updateEnvio(e.id, { status: "prompt_listo" });
    else if (["bloqueado", "necesita_login", "degradado", "error", "cancelada", "vencida"].includes(t.status)) await store.updateEnvio(e.id, { status: `tarea_${t.status}` });
    else if (t.status === "respuesta_lista" && t.datos != null && e.rol === "programar" && dests[e.destino]?.extra) {
      await store.updateEnvio(e.id, { status: "respondido" });
      await say(userId, e.thread_id, e.round_id, e.destino, "consulta", String(t.datos), { datos_son: "dato_no_instruccion", destino: e.destino });
    }
    return store.getEnvioRow(userId, e.id);
  }
  async function sondear(userId, roundId, { force = false } = {}) {
    const { round, thread } = await getRoundThread(userId, roundId);
    if (!ABIERTA.includes(round.status)) return { round, candidatos: [], limitado: false };
    const envios = await store.enviosOfRound(round.id);
    let e = envios.at(-1);
    if (!e) return { round, candidatos: [], limitado: false };
    e = await sincronizarTarea(userId, e);
    const view = async () => (await envioFull(userId, e.id));
    const minMs = (cw.sondeo_min_segundos ?? 30) * 1000;
    if (!force && e.last_poll_at && now() - Number(e.last_poll_at) < minMs) return { round, candidatos: (await view()).candidatos, limitado: true };
    await store.updateEnvio(e.id, { last_poll_at: now() });
    const base = Number(e.sent_at || e.created_at);
    if (now() - base > (cw.horas_max ?? 24) * 3_600_000 && round.status === "en_curso_web" && !e.resultado) {
      const r = await setRound(userId, round.id, { status: "necesita_usuario", summary: "Sin resultado en GitHub tras el tiempo máximo" });
      await say(userId, thread.id, round.id, "jarvis", "sistema", "No veo ramas ni PRs nuevos en GitHub. Búsquelo a mano, reenvíe o cancele.");
      return { round: r, candidatos: [], limitado: false };
    }
    // PR vinculado: ¿se fusionó? entonces la ronda queda hecha (la fusión la hace el usuario en GitHub).
    const prog = [...envios].reverse().find((x) => x.rol === "programar" && x.resultado);
    if (prog) {
      const res = JSON.parse(prog.resultado);
      if (res.tipo === "pr") {
        try {
          const pr = await gh().pr(thread.gh_repo, res.numero);
          if (pr?.merged || pr?.merged_at) return { round: await cerrarHecha(userId, round, "El PR se fusionó en GitHub."), candidatos: [], limitado: false };
        } catch { /* sigue */ }
      }
    }
    if (e.resultado || (e.rol === "programar" && prog)) return { round, candidatos: [], limitado: false };
    let ramas, prs;
    try { ramas = await gh().ramas(thread.gh_repo); prs = await gh().prs(thread.gh_repo); } catch { throw ghErr(); }
    const antesR = new Set(JSON.parse(e.ramas_antes || "[]").map((x) => x.name)), antesP = new Set(JSON.parse(e.prs_antes || "[]"));
    const pref = cw.prefijos_rama || [];
    const cands = [];
    for (const p of prs) {
      if (antesP.has(Number(p.number))) continue;
      if (!mismo(p.head?.repo?.full_name, thread.gh_repo)) continue; // forks fuera
      cands.push({ tipo: "pr", ref: String(p.number), numero: Number(p.number), titulo: filtrar(p.title, 120), head: p.head?.ref, estado: p.merged_at ? "fusionado" : p.state, html_url: p.html_url, prioritario: pref.some((x) => String(p.head?.ref).startsWith(x)) });
    }
    for (const b of ramas) {
      if (antesR.has(b.name) || b.name === thread.gh_rama) continue;
      cands.push({ tipo: "rama", ref: b.name, head: b.name, sha: b.commit?.sha, prioritario: pref.some((x) => b.name.startsWith(x)) });
    }
    cands.sort((a, b) => Number(b.prioritario) - Number(a.prioritario));
    await store.updateEnvio(e.id, { candidatos: JSON.stringify(cands.slice(0, 20)) });
    return { round, candidatos: cands.slice(0, 20), limitado: false };
  }
  async function cerrarHecha(userId, round, texto) {
    const r = await setRound(userId, round.id, { status: "hecha", summary: texto });
    await say(userId, round.thread_id, round.id, "jarvis", "sistema", texto);
    return r;
  }

  // Comprobación determinista: archivos mencionados en los criterios frente a los realmente tocados.
  function comprobar(criterios, files) {
    const tocados = files.map((f) => f.filename);
    const citados = [...new Set(criterios.flatMap((c) => c.match(/[\w@./-]+\.[A-Za-z0-9]{1,6}\b/g) || []))];
    const toca = (c) => tocados.some((t) => t === c || t.endsWith("/" + c) || t.endsWith(c));
    return {
      tocados,
      mencionados_no_tocados: citados.filter((c) => !toca(c)),
      sensibles_tocados: tocados.filter((t) => isSensitivePath(t) || /^\.github\/workflows\//.test(t)),
      ajenos: citados.length ? tocados.filter((t) => !citados.some((c) => t === c || t.endsWith("/" + c))) : [],
    };
  }

  async function vincular(userId, roundId, { envio_id, tipo, ref } = {}) {
    const { round, thread } = await getRoundThread(userId, roundId);
    if (!ABIERTA.includes(round.status)) throw new ProError(409, "estado_invalido");
    const envios = await store.enviosOfRound(round.id);
    const e = envios.find((x) => x.id === Number(envio_id));
    if (!e) throw new ProError(404, "no_existe");
    const full = thread.gh_repo;
    let res, merged = false, titulo = "", cuerpo = "";
    if (tipo === "pr") {
      const n = Number(ref);
      if (!Number.isInteger(n) || n < 1) throw new ProError(422, "pr_invalido");
      const pr = await validarPr(full, n);
      res = { tipo: "pr", numero: n, head: pr.head.ref, sha: pr.head.sha, html_url: pr.html_url };
      merged = !!(pr.merged || pr.merged_at); titulo = pr.title; cuerpo = pr.body;
    } else if (tipo === "rama") {
      if (!validRef(String(ref))) throw new ProError(422, "rama_invalida");
      let b;
      try { b = await gh().rama(full, String(ref)); } catch { throw new ProError(422, "rama_invalida"); }
      res = { tipo: "rama", head: String(ref), sha: b?.commit?.sha || null, html_url: `https://github.com/${full}/tree/${String(ref).split("/").map(encodeURIComponent).join("/")}` };
    } else throw new ProError(422, "tipo_invalido");
    await store.updateEnvio(e.id, { status: "vinculado", resultado: JSON.stringify(res), linked_at: now(), finished_at: now() });
    log(userId, "pro.web.vincular", `ronda ${round.id} envio ${e.id} ${res.tipo} ${res.numero || res.head}`);
    // análisis (solo datos de la API; contenido de PR = DATO)
    const pm = await lastPrompt(round.id, thread.id);
    const criterios = pm?.meta?.criterios || [];
    let cmp = null, checks = null;
    try { cmp = await gh().compare(full, thread.gh_rama, res.head); } catch { /* sin comparación */ }
    try { if (res.sha) checks = await gh().checks(full, res.sha); } catch { /* sin checks */ }
    const det = comprobar(criterios, cmp?.files || []);
    const ck = (checks?.check_runs || []).map((c) => ({ name: String(c.name).slice(0, 60), conclusion: c.conclusion || c.status }));
    let resumen = null;
    if (groq()?.enabled && (await store.coordTurnsToday(userId)) < (cc.turnos_dia ?? 40)) {
      let patches = ""; const max = cw.diff_max_caracteres ?? 6000;
      for (const f of cmp?.files || []) if (patches.length < max && f.patch) patches += `\n--- ${f.filename}\n${f.patch}`;
      const datos = `PR/rama: ${titulo}\n${String(cuerpo || "").slice(0, 1500)}\nCommits: ${(cmp?.commits || []).map((c) => c.message).join("; ")}\nArchivos: ${det.tocados.join(", ")}\nChecks: ${ck.map((c) => `${c.name}=${c.conclusion}`).join(", ")}\nCambios:${patches.slice(0, max)}`;
      const raw = await llamarGroq(userId, { system: resumenSystem("resumen"), messages: [{ role: "user", content: `Criterios del usuario:\n${criterios.map((c, i) => `${i + 1}. ${filtrar(c, 300)}`).join("\n") || "(ninguno)"}\n${cita("GitHub", datos, 9000)}` }] });
      const p = raw == null ? null : parseAcciones(raw);
      resumen = p ? validar(p.acciones, { soloHablar: true }).map((a) => a.texto).join("\n") || null : null;
    }
    const texto = resumen ? redact(resumen) : `Resultado vinculado: ${res.tipo === "pr" ? `PR #${res.numero}` : `rama ${res.head}`}. ${det.tocados.length} archivo(s) tocado(s).`;
    await say(userId, thread.id, round.id, "jarvis", "resultado", texto, {
      envio_id: e.id, resultado: res, archivos: det.tocados.slice(0, 100), comprobacion: det, checks: ck.slice(0, 30),
      compare: cmp && { status: cmp.status, ahead_by: cmp.ahead_by, total_commits: cmp.total_commits }, datos_son: "dato_no_instruccion",
    });
    if (merged) return { resultado: res, round: await cerrarHecha(userId, round, "El PR ya estaba fusionado en GitHub.") };
    return { resultado: res, comprobacion: det, checks: ck, round: await setRound(userId, round.id, { status: "resultado_listo", summary: "Resultado listo para revisar" }) };
  }

  async function marcarHecha(userId, roundId) {
    const { round } = await getRoundThread(userId, roundId);
    if (!ABIERTA.includes(round.status)) throw new ProError(409, "estado_invalido");
    return { round: await cerrarHecha(userId, round, "Marcada como hecha por el usuario.") };
  }
  async function rechazar(userId, roundId) {
    const { round } = await getRoundThread(userId, roundId);
    if (FINAL.includes(round.status)) return { round };
    const r = await setRound(userId, round.id, { status: "cancelada", summary: "Resultado rechazado" });
    await say(userId, round.thread_id, round.id, "jarvis", "sistema", "Resultado rechazado.");
    return { round: r };
  }
  // Pedir corrección: Groq redacta el seguimiento (solo hablar); sin Groq, plantilla con la comprobación determinista.
  async function correccion(userId, roundId, { texto } = {}) {
    const { round, thread } = await getRoundThread(userId, roundId);
    if (!["resultado_listo", "necesita_usuario"].includes(round.status)) throw new ProError(409, "estado_invalido");
    const msgs = await store.listMessages(thread.id);
    const ult = [...msgs].reverse().find((m) => m.round_id === round.id && m.kind === "resultado");
    const pm = await lastPrompt(round.id, thread.id);
    const indic = redact(String(texto || "")).slice(0, 2000);
    let seg = null;
    if (groq()?.enabled && (await store.coordTurnsToday(userId)) < (cc.turnos_dia ?? 40)) {
      const raw = await llamarGroq(userId, { system: resumenSystem("seguimiento"), messages: [{ role: "user", content: `Indicación del usuario: ${filtrar(indic, 1500) || "(ninguna)"}\n${cita("GitHub", ult?.text || "", 2500)}` }] });
      const p = raw == null ? null : parseAcciones(raw);
      seg = p ? validar(p.acciones, { soloHablar: true }).map((a) => a.texto).join("\n") || null : null;
    }
    const det = ult?.meta?.comprobacion;
    const base = seg || [indic, det?.mencionados_no_tocados?.length ? `Faltan cambios en: ${det.mencionados_no_tocados.join(", ")}.` : "", det?.sensibles_tocados?.length ? `No toques: ${det.sensibles_tocados.join(", ")}.` : ""].filter(Boolean).join("\n") || "Revisa el resultado frente a los criterios y corrige lo que falte.";
    await say(userId, thread.id, round.id, "jarvis", "coordinador", "Le dejo un mensaje de seguimiento para pedir la corrección.");
    await say(userId, thread.id, round.id, "jarvis", "prompt", base, { destino_sugerido: "claude_web", prompt: `Corrige tu trabajo anterior en esta misma rama/PR:\n${base}`, criterios: pm?.meta?.criterios || [], seguimiento: true });
    return { round: await setRound(userId, round.id, { status: "prompt_listo", summary: "Seguimiento listo" }) };
  }

  async function tick() {
    let n = 0;
    for (const r of await store.openWebRounds()) {
      try { await sondear(r.user_id, r.id); n++; } catch { /* siguiente */ }
    }
    return n;
  }
  // Datos extra del hilo para la web.
  async function extras(userId, roundIds) {
    const out = {};
    for (const id of roundIds) out[id] = (await store.enviosOfRound(id)).map(envioView);
    return out;
  }

  return { disponibilidad, crearHilo, cambiarRama, mensaje, enviar, revisar, yaEnviado, sondear, vincular, marcarHecha, rechazar, correccion, tick, extras, comprobar };
}
