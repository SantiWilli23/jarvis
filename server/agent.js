// Puente con el PC (Fase 2): presencia, topes de Claude Pro, uso y aprobaciones de la tarea en curso.
// El agente de escritorio habla con esto por /api/agent/* usando un token de dispositivo "pc".
import { all, get, run } from "./db/client.js";

export const PC_TIMEOUT_MS = 45_000;
// Capacidades que reporta el PC: { claude:{ok,modelos[]}, gemini_cli:{ok,cli:'agy',login,version,modelos[]}, repos:[ruta] }.
function cleanCaps(c) {
  const strs = (a) => (Array.isArray(a) ? a.map((x) => String(x).slice(0, 200)).slice(0, 30) : []);
  return {
    claude: { ok: !!c.claude?.ok, modelos: strs(c.claude?.modelos) },
    ...(() => {
      const g = c.gemini_cli || c.agy || {};
      const v = { ok: !!g.ok, cli: "agy", login: g.login ? String(g.login).slice(0, 20) : null, version: g.version ? String(g.version).slice(0, 20) : null, modelos: strs(g.modelos) };
      return { agy: v, gemini_cli: v }; // "agy" por compatibilidad con el Modo Pro
    })(),
    repos: strs((c.repos || []).map((r) => (typeof r === "string" ? r : r?.ruta || ""))).filter(Boolean),
  };
}
const dayOf = (t) => new Date(t).toISOString().slice(0, 10);

export function createAgent({ db, bus, tasks, approvals, audit, permissions, state, motores = null, now = () => Date.now() }) {
  const pc = state.pc;
  Object.assign(pc, { capabilities: null, online: false, last_seen: null, current_task: null, paused: false, version: null, host: null });
  // Topes por motor: los de Gemini (tope_gemini) son independientes de los de Claude (tope_claude).
  const caps = (engine = "claude") => {
    const t = (engine === "gemini" ? permissions.tope_gemini : permissions.tope_claude) || {};
    return { por_tarea_tokens: t.por_tarea_tokens ?? null, diario_tareas: t.diario_tareas ?? null, diario_tokens: t.diario_tokens ?? null };
  };
  const geminiModel = () => motores?.gemini?.modelo || "gemini-3.8-flash-high";
  const publish = (userId) => bus.emit("pc.status", { userId, ...api.view() });
  const setCaps = (c) => { if (c && typeof c === "object") pc.capabilities = cleanCaps(c); };
  const touch = () => { pc.last_seen = now(); };

  const api = {
    caps,
    capabilities: () => pc.capabilities,
    // Motores que el PC puede atender (según lo que informó): Claude siempre; Gemini solo con agy listo.
    // Gemini del PC está APAGADO por defecto: solo motores_pc.gemini.activo === true lo enciende (config/providers.json).
    geminiActive: () => motores?.gemini?.activo === true,
    engines: () => ["claude", ...(api.geminiReady() ? ["gemini"] : [])],
    geminiReady: () => motores?.gemini?.activo === true && !!pc.capabilities?.gemini_cli?.ok,
    // ¿Este motor llegó a su tope diario? (tareas o tokens)
    async capped(userId, engine = "claude") {
      const c = caps(engine), u = await api.usageToday(userId), x = engine === "gemini" ? u.gemini : u;
      return (c.diario_tareas != null && x.tareas >= c.diario_tareas) || (c.diario_tokens != null && x.tokens >= c.diario_tokens);
    },
    view() { return { online: pc.online, current_task: pc.current_task, paused: pc.paused, last_seen: pc.last_seen, host: pc.host, engines: api.engines(), gemini_activo: motores?.gemini?.activo === true }; },
    // Si el PC dejó de avisar, se marca desconectado (lo llama un temporizador y también /status).
    sweep(userId) {
      if (pc.online && now() - pc.last_seen > PC_TIMEOUT_MS) {
        pc.online = false; pc.current_task = null;
        if (userId) publish(userId);
        return true;
      }
      return false;
    },
    async hello(userId, { version = null, host = null, capabilities } = {}) {
      const wasOnline = pc.online;
      Object.assign(pc, { online: true, version, host: host ? String(host).slice(0, 60) : null });
      setCaps(capabilities); touch();
      // Tareas que se quedaron a medias cuando el PC se apagó: no se repiten solas (podrían duplicar efectos).
      const hung = await run(db, "UPDATE tasks SET status='interrumpida', result='El PC se apagó o perdió conexión durante la tarea.', updated_at=? WHERE user_id=? AND status IN ('reclamada','en_curso')", [now(), userId]);
      await audit?.log({ userId, action: "pc.en_linea", detail: `${host || "PC"} ${version || ""}`.trim() });
      if (!wasOnline) bus.emit("pc_online", { userId, host: pc.host }); // la Fase 4 lo convertirá en aviso de Telegram
      publish(userId);
      return {
        ok: true, interrumpidas: hung.changes || 0, caps: caps(), uso: await api.usageToday(userId),
        permissions: { automatico: permissions.automatico, requiere_aprobacion: permissions.requiere_aprobacion, carpetas_permitidas: permissions.carpetas_permitidas, carpetas_gemini: permissions.carpetas_gemini || [], aprobacion_caduca_minutos: permissions.aprobacion_caduca_minutos },
        motores: { gemini: { modelo: geminiModel(), activo: motores?.gemini?.activo === true } },
      };
    },
    async heartbeat(userId, { paused = false, current_task = null, capabilities } = {}) {
      const was = pc.online;
      setCaps(capabilities);
      pc.online = true; pc.paused = !!paused; pc.current_task = current_task ?? null; touch();
      if (!was) bus.emit("pc_online", { userId, host: pc.host });
      publish(userId);
      return { ok: true, uso: await api.usageToday(userId) };
    },
    async bye(userId) {
      pc.online = false; pc.current_task = null; publish(userId);
      await audit?.log({ userId, action: "pc.desconectado" });
      return { ok: true };
    },
    async usageToday(userId) {
      const r = await get(db, "SELECT COUNT(DISTINCT task_id) AS tareas, COALESCE(SUM(tokens_in+tokens_out),0) AS tokens FROM claude_usage WHERE user_id=? AND day=?", [userId, dayOf(now())]);
      const ai = await all(db, "SELECT engine, COALESCE(SUM(tokens_in+tokens_out),0) AS tokens, COUNT(*) AS llamadas FROM ai_usage WHERE user_id=? AND day=? GROUP BY engine", [userId, dayOf(now())]);
      const g = await get(db, "SELECT COUNT(*) AS tareas, COALESCE(SUM(tokens_in+tokens_out),0) AS tokens FROM ai_usage WHERE user_id=? AND day=? AND engine='gemini' AND role='tarea'", [userId, dayOf(now())]);
      const gt = ai.find((x) => x.engine === "gemini");
      return { tareas: Number(r.tareas), tokens: Number(r.tokens), gemini: { tareas: Number(g.tareas), tokens: Number(gt?.tokens || 0) }, ai: Object.fromEntries(ai.map((x) => [x.engine, { tokens: Number(x.tokens), llamadas: Number(x.llamadas) }])) };
    },
    // Entrega la siguiente tarea, solo de los motores que el PC atiende y que no llegaron a su tope diario.
    async claim(userId) {
      touch(); pc.online = true;
      const u = await api.usageToday(userId);
      const all_ = api.engines(), open = [];
      for (const e of all_) if (!(await api.capped(userId, e))) open.push(e);
      if (!open.length) return { task: null, reason: "tope_diario", uso: u };
      const t = await tasks.claim(userId, "pc", open);
      if (!t) return { task: null, reason: open.length < all_.length ? "tope_diario_parcial" : "cola_vacia", uso: u };
      pc.current_task = { id: t.id, seq: t.seq, engine: t.engine, preview: t.text.slice(0, 80) };
      publish(userId);
      return { task: t, caps: caps(t.engine), uso: u };
    },
    async progress(userId, taskId, events) {
      touch();
      const t = await tasks.get(userId, taskId);
      if (!t) return { ok: false, reason: "no_existe" };
      if (t.status === "reclamada") await tasks.setStatus(userId, taskId, "en_curso");
      for (const e of events.slice(0, 50)) {
        bus.emit("task.progress", { userId, task_id: taskId, event: { kind: String(e.kind || "info").slice(0, 20), text: String(e.text || "").slice(0, 300) } });
      }
      return { ok: true };
    },
    // Pide aprobación para una acción peligrosa (tarjeta ámbar en la web).
    async requestApproval(userId, taskId, { kind, summary, detail }) {
      touch();
      return approvals.request({ userId, taskId, kind: String(kind).slice(0, 40), summary: String(summary).slice(0, 200), detail: String(detail || "").slice(0, 1000) });
    },
    async approvalStatus(userId, id) {
      touch();
      const r = await get(db, "SELECT * FROM approvals WHERE id=? AND user_id=?", [id, userId]);
      if (!r) return null;
      let status = r.status;
      const ttl = (permissions.aprobacion_caduca_minutos ?? 30) * 60_000;
      if (status === "pendiente" && now() - Number(r.created_at) > ttl) {
        await run(db, "UPDATE approvals SET status='caducada', decided_at=? WHERE id=? AND status='pendiente'", [now(), id]);
        status = "caducada";
        bus.emit("approval.resolved", { userId, approval: { id: Number(id), status } });
      }
      return { id: Number(id), status };
    },
    async finish(userId, taskId, { status = "hecha", result = null, usage = {} }) {
      touch();
      const t = await tasks.get(userId, taskId);
      if (!t || !["reclamada", "en_curso"].includes(t.status)) return { ok: false, reason: "no_en_curso" };
      const st = ["hecha", "fallida", "rechazada", "tope_tarea"].includes(status) ? status : "fallida";
      const out = await tasks.finish(userId, taskId, { status: st, result: result == null ? null : String(result).slice(0, 20000) });
      const tin = Math.max(0, Math.floor(Number(usage.tokens_in) || 0)), tout = Math.max(0, Math.floor(Number(usage.tokens_out) || 0));
      // Cada motor cuenta en su propia tabla: Claude en claude_usage, Gemini en ai_usage (topes independientes).
      if (t.engine === "gemini") await run(db, "INSERT INTO ai_usage (user_id, day, engine, model, role, job_id, tokens_in, tokens_out, created_at) VALUES (?,?,?,?,?,?,?,?,?)", [userId, dayOf(now()), "gemini", geminiModel(), "tarea", null, tin, tout, now()]);
      else await run(db, "INSERT INTO claude_usage (user_id, task_id, day, tokens_in, tokens_out, created_at) VALUES (?,?,?,?,?,?)", [userId, taskId, dayOf(now()), tin, tout, now()]);
      pc.current_task = null; publish(userId);
      await audit?.log({ userId, action: `tarea.${st}`, detail: `#${t.seq} ${tin + tout} tokens` });
      return { ok: true, task: out };
    },
  };
  return api;
}
