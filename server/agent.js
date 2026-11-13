// Puente con el PC (Fase 2): presencia, topes de Claude Pro, uso y aprobaciones de la tarea en curso.
// El agente de escritorio habla con esto por /api/agent/* usando un token de dispositivo "pc".
import { all, get, run } from "./db/client.js";

export const PC_TIMEOUT_MS = 45_000;
// Capacidades que reporta el PC: { claude:{ok,modelos[]}, gemini_cli:{ok,login}, repos:[ruta] } (docs/PRO.md).
function cleanCaps(c) {
  const strs = (a) => (Array.isArray(a) ? a.map((x) => String(x).slice(0, 200)).slice(0, 30) : []);
  return {
    claude: { ok: !!c.claude?.ok, modelos: strs(c.claude?.modelos) },
    agy: { ok: !!(c.agy || c.gemini_cli)?.ok, login: (c.agy || c.gemini_cli)?.login ? String((c.agy || c.gemini_cli).login).slice(0, 20) : null, modelos: strs((c.agy || c.gemini_cli)?.modelos) },
    repos: strs((c.repos || []).map((r) => (typeof r === "string" ? r : r?.ruta || ""))).filter(Boolean),
  };
}
const dayOf = (t) => new Date(t).toISOString().slice(0, 10);

export function createAgent({ db, bus, tasks, approvals, audit, permissions, state, now = () => Date.now() }) {
  const pc = state.pc;
  Object.assign(pc, { capabilities: null, online: false, last_seen: null, current_task: null, paused: false, version: null, host: null });
  const caps = () => ({
    por_tarea_tokens: permissions.tope_claude?.por_tarea_tokens ?? null,
    diario_tareas: permissions.tope_claude?.diario_tareas ?? null,
    diario_tokens: permissions.tope_claude?.diario_tokens ?? null,
  });
  const publish = (userId) => bus.emit("pc.status", { userId, ...api.view() });
  const setCaps = (c) => { if (c && typeof c === "object") pc.capabilities = cleanCaps(c); };
  const touch = () => { pc.last_seen = now(); };

  const api = {
    caps,
    capabilities: () => pc.capabilities,
    view() { return { online: pc.online, current_task: pc.current_task, paused: pc.paused, last_seen: pc.last_seen, host: pc.host }; },
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
        permissions: { automatico: permissions.automatico, requiere_aprobacion: permissions.requiere_aprobacion, carpetas_permitidas: permissions.carpetas_permitidas, aprobacion_caduca_minutos: permissions.aprobacion_caduca_minutos },
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
      return { tareas: Number(r.tareas), tokens: Number(r.tokens), ai: Object.fromEntries(ai.map((x) => [x.engine, { tokens: Number(x.tokens), llamadas: Number(x.llamadas) }])) };
    },
    // Entrega la siguiente tarea respetando el tope diario.
    async claim(userId) {
      touch(); pc.online = true;
      const c = caps(), u = await api.usageToday(userId);
      if (c.diario_tareas != null && u.tareas >= c.diario_tareas) return { task: null, reason: "tope_diario", uso: u };
      if (c.diario_tokens != null && u.tokens >= c.diario_tokens) return { task: null, reason: "tope_diario", uso: u };
      const t = await tasks.claim(userId, "pc");
      if (!t) return { task: null, reason: "cola_vacia", uso: u };
      pc.current_task = { id: t.id, seq: t.seq, preview: t.text.slice(0, 80) };
      publish(userId);
      return { task: t, caps: c, uso: u };
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
      await run(db, "INSERT INTO claude_usage (user_id, task_id, day, tokens_in, tokens_out, created_at) VALUES (?,?,?,?,?,?)", [userId, taskId, dayOf(now()), tin, tout, now()]);
      pc.current_task = null; publish(userId);
      await audit?.log({ userId, action: `tarea.${st}`, detail: `#${t.seq} ${tin + tout} tokens` });
      return { ok: true, task: out };
    },
  };
  return api;
}
