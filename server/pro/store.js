// CRUD de las tablas Pro (hilos, mensajes, rondas, jobs, informes, ai_usage).
import { all, get, run } from "../db/client.js";

const j = (s) => { try { return s == null ? null : JSON.parse(s); } catch { return null; } };
const n = (x) => (x == null ? null : Number(x));
const day = (t) => new Date(t).toISOString().slice(0, 10);

export const msgView = (r) => r && { id: Number(r.id), thread_id: Number(r.thread_id), round_id: n(r.round_id), author: r.author, kind: r.kind, text: r.text, meta: j(r.meta) || {}, created_at: Number(r.created_at) };
export const roundView = (r) => r && { id: Number(r.id), thread_id: Number(r.thread_id), status: r.status, corrections: Number(r.corrections), programmer: r.programmer, verifier: r.verifier, summary: r.summary, task_kind: r.task_kind, message_id: n(r.message_id), created_at: Number(r.created_at), updated_at: Number(r.updated_at) };
export const threadView = (r) => r && { id: Number(r.id), title: r.title, repo: r.repo, status: r.status, resumen: r.resumen || null, modo: r.modo || "local", gh_repo: r.gh_repo || null, gh_rama: r.gh_rama || null, created_at: Number(r.created_at), updated_at: Number(r.updated_at) };
export const jobView = (r) => r && { id: Number(r.id), round_id: Number(r.round_id), thread_id: Number(r.thread_id), role: r.role, engine: r.engine, model: r.model, repo: r.repo, mode: r.mode, status: r.status, model_real: r.model_real || null, tree_before: r.tree_before, tree_after: r.tree_after, error: r.error, created_at: Number(r.created_at), started_at: n(r.started_at), finished_at: n(r.finished_at) };

export const envioView = (r) => r && { id: Number(r.id), round_id: Number(r.round_id), thread_id: Number(r.thread_id), destino: r.destino, rol: r.rol, prompt: r.prompt, browser_task_id: n(r.browser_task_id), status: r.status, resultado: j(r.resultado), candidatos: j(r.candidatos) || [], created_at: Number(r.created_at), sent_at: n(r.sent_at), linked_at: n(r.linked_at), finished_at: n(r.finished_at), last_poll_at: n(r.last_poll_at) };

export function createStore({ db, now = () => Date.now() }) {
  const self = {
    // hilos
    async createThread(userId, { title, repo }) {
      const t = now();
      const r = await run(db, "INSERT INTO pro_threads (user_id,title,repo,created_at,updated_at) VALUES (?,?,?,?,?)", [userId, title || "Nuevo hilo", repo, t, t]);
      return threadView(await get(db, "SELECT * FROM pro_threads WHERE id=?", [r.id]));
    },
    async createWebThread(userId, { title, ghRepo, ghRama }) {
      const t = now();
      const r = await run(db, "INSERT INTO pro_threads (user_id,title,repo,modo,gh_repo,gh_rama,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)", [userId, title || "Nuevo hilo", ghRepo, "web", ghRepo, ghRama, t, t]);
      return threadView(await get(db, "SELECT * FROM pro_threads WHERE id=?", [r.id]));
    },
    async setGhRama(userId, id, rama) { await run(db, "UPDATE pro_threads SET gh_rama=?, updated_at=? WHERE id=? AND user_id=?", [rama, now(), id, userId]); return self.getThread(userId, id); },
    // envíos Pro web
    async createEnvio({ roundId, threadId, userId, destino, rol, prompt, ramasAntes, prsAntes }) {
      const r = await run(db, "INSERT INTO pro_web_envios (round_id,thread_id,user_id,destino,rol,prompt,ramas_antes,prs_antes,created_at) VALUES (?,?,?,?,?,?,?,?,?)", [roundId, threadId, userId, destino, rol, prompt, JSON.stringify(ramasAntes || []), JSON.stringify(prsAntes || []), now()]);
      return self.getEnvioRow(userId, r.id);
    },
    async getEnvioRow(userId, id) { return get(db, "SELECT * FROM pro_web_envios WHERE id=? AND user_id=?", [id, userId]); },
    async enviosOfRound(roundId) { return all(db, "SELECT * FROM pro_web_envios WHERE round_id=? ORDER BY id", [roundId]); },
    async updateEnvio(id, patch) {
      const keys = Object.keys(patch);
      await run(db, `UPDATE pro_web_envios SET ${keys.map((k) => `${k}=?`).join(",")} WHERE id=?`, [...keys.map((k) => patch[k]), id]);
    },
    async enviosHoy(userId) { return Number((await get(db, "SELECT COUNT(*) AS n FROM pro_web_envios WHERE user_id=? AND created_at>=?", [userId, now() - 86_400_000]))?.n || 0); },
    async openWebRounds() { return all(db, "SELECT r.* FROM pro_rounds r JOIN pro_threads t ON t.id=r.thread_id WHERE t.modo='web' AND r.status IN ('en_curso_web','resultado_listo')"); },
    async getThread(userId, id) { return threadView(await get(db, "SELECT * FROM pro_threads WHERE id=? AND user_id=?", [id, userId])); },
    async listThreads(userId) { return (await all(db, "SELECT * FROM pro_threads WHERE user_id=? ORDER BY updated_at DESC, id DESC", [userId])).map(threadView); },
    async touchThread(id) { await run(db, "UPDATE pro_threads SET updated_at=? WHERE id=?", [now(), id]); },
    async setResumen(id, resumen) { await run(db, "UPDATE pro_threads SET resumen=? WHERE id=?", [resumen, id]); },
    // Turnos de Groq dados hoy (UTC) por el usuario: cada turno deja un mensaje "coordinador".
    async coordTurnsToday(userId) {
      const d = new Date(now()); d.setUTCHours(0, 0, 0, 0);
      return Number((await get(db, "SELECT COUNT(*) AS n FROM pro_messages WHERE user_id=? AND kind='coordinador' AND created_at>=?", [userId, d.getTime()]))?.n || 0);
    },
    async getSetting(userId, key) { return (await get(db, "SELECT value FROM settings WHERE user_id=? AND key=?", [userId, key]))?.value ?? null; },
    async setSetting(userId, key, value) {
      await run(db, "INSERT INTO settings (user_id,key,value,created_at) VALUES (?,?,?,?) ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value", [userId, key, value, now()]);
    },
    // mensajes
    async addMessage({ threadId, userId, roundId = null, author, kind = "texto", text, meta = null }) {
      const r = await run(db, "INSERT INTO pro_messages (thread_id,user_id,round_id,author,kind,text,meta,created_at) VALUES (?,?,?,?,?,?,?,?)", [threadId, userId, roundId, author, kind, text, meta ? JSON.stringify(meta) : null, now()]);
      await self.touchThread(threadId);
      return msgView(await get(db, "SELECT * FROM pro_messages WHERE id=?", [r.id]));
    },
    async listMessages(threadId) { return (await all(db, "SELECT * FROM pro_messages WHERE thread_id=? ORDER BY id", [threadId])).map(msgView); },
    // rondas
    // Atómico: solo crea la ronda si el hilo no tiene otra sin cerrar (dos envíos a la vez: gana uno). null = ya hay una.
    async createRound({ threadId, userId, messageId = null, taskKind, programmer, verifier }) {
      const t = now();
      const r = await run(db, "INSERT INTO pro_rounds (thread_id,user_id,message_id,task_kind,programmer,verifier,created_at,updated_at) SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM pro_rounds WHERE thread_id=? AND status NOT IN ('hecha','fallida','cancelada'))", [threadId, userId, messageId, taskKind, programmer, verifier, t, t, threadId]);
      if (!r.changes) return null;
      return self.getRound(userId, r.id);
    },
    async getRound(userId, id) { return roundView(await get(db, "SELECT * FROM pro_rounds WHERE id=? AND user_id=?", [id, userId])); },
    async listRounds(threadId) { return (await all(db, "SELECT * FROM pro_rounds WHERE thread_id=? ORDER BY id", [threadId])).map(roundView); },
    // Ronda sin cerrar: cuenta también "necesita_usuario" y "conversando" (dos rondas del mismo hilo no se mezclan).
    async activeRound(threadId) { return roundView(await get(db, "SELECT * FROM pro_rounds WHERE thread_id=? AND status NOT IN ('hecha','fallida','cancelada') ORDER BY id DESC", [threadId])); },
    async updateRound(userId, id, patch) {
      const keys = Object.keys(patch);
      await run(db, `UPDATE pro_rounds SET ${keys.map((k) => `${k}=?`).join(",")}, updated_at=? WHERE id=? AND user_id=?`, [...keys.map((k) => patch[k]), now(), id, userId]);
      return self.getRound(userId, id);
    },
    // jobs
    async createJob({ roundId, threadId, userId, role, engine, model, repo, prompt, mode }) {
      const r = await run(db, "INSERT INTO pro_jobs (round_id,thread_id,user_id,role,engine,model,repo,prompt,mode,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)", [roundId, threadId, userId, role, engine, model, repo, prompt, mode, now()]);
      return self.getJobRow(userId, r.id);
    },
    async getJobRow(userId, id) { return get(db, "SELECT * FROM pro_jobs WHERE id=? AND user_id=?", [id, userId]); },
    async jobsOfRound(roundId) { return all(db, "SELECT * FROM pro_jobs WHERE round_id=? ORDER BY id", [roundId]); },
    async updateJob(id, patch) {
      const keys = Object.keys(patch);
      await run(db, `UPDATE pro_jobs SET ${keys.map((k) => `${k}=?`).join(",")} WHERE id=?`, [...keys.map((k) => patch[k]), id]);
    },
    // Vuelve a `pendiente` los jobs reclamados que el PC no confirmó en `staleMs` (PC caído o respuesta perdida).
    async requeueStale(userId, staleMs) {
      return run(db, "UPDATE pro_jobs SET status='pendiente', started_at=NULL WHERE user_id=? AND status='reclamado' AND started_at < ?", [userId, now() - staleMs]);
    },
    // Jobs que el PC tenía en marcha (reclamados o en curso) y ya no puede estar atendiendo (reinicio) o se pasaron de tiempo.
    async runningJobs(userId) { return all(db, "SELECT * FROM pro_jobs WHERE user_id=? AND status IN ('reclamado','en_curso')", [userId]); },
    async lastJob(roundId) { return get(db, "SELECT * FROM pro_jobs WHERE round_id=? ORDER BY id DESC", [roundId]); },
    // Reclamo atómico: solo uno gana aunque lleguen dos claims a la vez.
    async claimNext(userId) {
      for (let i = 0; i < 3; i++) {
        const row = await get(db, "SELECT * FROM pro_jobs WHERE user_id=? AND status='pendiente' ORDER BY id LIMIT 1", [userId]);
        if (!row) return null;
        const r = await run(db, "UPDATE pro_jobs SET status='reclamado', started_at=? WHERE id=? AND status='pendiente'", [now(), row.id]);
        if (r.changes) return self.getJobRow(userId, row.id);
      }
      return null;
    },
    // Cierra el job solo si seguía vivo (idempotencia: un reenvío no se procesa dos veces).
    async closeJob(id, patch) {
      const keys = Object.keys(patch);
      const r = await run(db, `UPDATE pro_jobs SET ${keys.map((k) => `${k}=?`).join(",")} WHERE id=? AND status IN ('pendiente','reclamado','en_curso')`, [...keys.map((k) => patch[k]), id]);
      return r.changes;
    },
    async lastReport(roundId, kind) {
      const r = await get(db, "SELECT * FROM pro_reports WHERE round_id=? AND kind=? ORDER BY id DESC", [roundId, kind]);
      return r && { job_id: Number(r.job_id), body: j(r.body) };
    },
    async liveJobs(roundId) { return all(db, "SELECT * FROM pro_jobs WHERE round_id=? AND status IN ('pendiente','reclamado','en_curso')", [roundId]); },
    // informes
    async addReport({ jobId, roundId, kind, body }) {
      await run(db, "INSERT INTO pro_reports (job_id,round_id,kind,body,created_at) VALUES (?,?,?,?,?)", [jobId, roundId, kind, JSON.stringify(body), now()]);
    },
    async reportsOfJob(jobId) { return (await all(db, "SELECT * FROM pro_reports WHERE job_id=? ORDER BY id", [jobId])).map((r) => ({ id: Number(r.id), kind: r.kind, body: j(r.body), created_at: Number(r.created_at) })); },
    async addUsage({ userId, engine, model, role, jobId, tokens_in = 0, tokens_out = 0 }) {
      const f = (x) => Math.max(0, Math.floor(Number(x) || 0));
      await run(db, "INSERT INTO ai_usage (user_id,day,engine,model,role,job_id,tokens_in,tokens_out,created_at) VALUES (?,?,?,?,?,?,?,?,?)", [userId, day(now()), engine, model, role, jobId, f(tokens_in), f(tokens_out), now()]);
    },
  };
  return self;
}
