// Cola de tareas para el PC. El texto crudo se guarda como BLOB (bytes UTF-8 exactos)
// junto con su sha256; la hora y demás metadatos van SOLO en header_json.
import { createHash } from "node:crypto";
import { all, get, run } from "../db/client.js";

export const MAX_FOTO_BYTES = 4 * 1024 * 1024;
export const MAX_FOTOS_POR_TAREA = 3;
const EDITABLES = ["pendiente", "por_revisar"];
export const ENGINES = ["claude"]; // lista cerrada de motores del PC

export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

function toTask(r) {
  if (!r) return null;
  const buf = Buffer.from(r.raw_text);
  return {
    id: Number(r.id), user_id: Number(r.user_id), seq: Number(r.seq), mode: r.mode, status: r.status, engine: r.engine || "claude",
    text: buf.toString("utf8"), sha256: r.raw_sha256,
    header: JSON.parse(r.header_json || "{}"),
    prepared: r.prepared_json ? JSON.parse(r.prepared_json) : null,
    review_first: !!r.review_first, claimed_by: r.claimed_by, result: r.result,
    created_at: Number(r.created_at), updated_at: Number(r.updated_at),
  };
}

export function createTasks({ db, bus, now = () => Date.now() }) {
  const emit = (t) => t && bus?.emit("task.update", { userId: t.user_id, task: { id: t.id, seq: t.seq, mode: t.mode, engine: t.engine, status: t.status, preview: t.text.slice(0, 140) } });

  const api = {
    // rawText se guarda tal cual: sin trim, sin normalizar saltos de línea ni Unicode.
    async create({ userId, rawText, mode, header = {}, prepared = null, reviewFirst = false, status, engine = "claude" }) {
      if (!ENGINES.includes(engine)) throw new Error("motor_invalido");
      const buf = Buffer.from(String(rawText), "utf8");
      const st = status || (reviewFirst ? "por_revisar" : "pendiente");
      const hdr = { dictated_at: new Date(now()).toISOString(), ...header };
      const t = now();
      const r = await run(db, `INSERT INTO tasks (user_id, seq, mode, status, engine, raw_text, raw_sha256, header_json, prepared_json, review_first, created_at, updated_at)
        VALUES (?, (SELECT COALESCE(MAX(seq),0)+1 FROM tasks WHERE user_id = ?), ?,?,?,?,?,?,?,?,?,?)`,
        [userId, userId, mode, st, engine, buf, sha256(buf), JSON.stringify(hdr), prepared ? JSON.stringify(prepared) : null, reviewFirst ? 1 : 0, t, t]);
      const task = await api.get(userId, r.id);
      emit(task);
      return task;
    },
    async get(userId, id) {
      return toTask(await get(db, "SELECT * FROM tasks WHERE id=? AND user_id=?", [id, userId]));
    },
    async list(userId, { status } = {}) {
      const rows = status
        ? await all(db, "SELECT * FROM tasks WHERE user_id=? AND status=? ORDER BY seq", [userId, status])
        : await all(db, "SELECT * FROM tasks WHERE user_id=? ORDER BY seq DESC LIMIT 100", [userId]);
      return rows.map(toTask);
    },
    // Solo editable mientras esté pendiente (o por revisar).
    async update(userId, id, { rawText, prepared }) {
      const sets = [], args = [];
      if (rawText !== undefined) {
        const buf = Buffer.from(String(rawText), "utf8");
        sets.push("raw_text=?", "raw_sha256=?"); args.push(buf, sha256(buf));
      }
      if (prepared !== undefined) { sets.push("prepared_json=?"); args.push(JSON.stringify(prepared)); }
      if (!sets.length) return { ok: false, reason: "nada" };
      const r = await run(db, `UPDATE tasks SET ${sets.join(", ")}, updated_at=? WHERE id=? AND user_id=? AND status IN ('pendiente','por_revisar')`,
        [...args, now(), id, userId]);
      if (!r.changes) return { ok: false, reason: "no_editable" };
      const task = await api.get(userId, id); emit(task);
      return { ok: true, task };
    },
    async remove(userId, id) {
      const task = await api.get(userId, id);
      const r = await run(db, "DELETE FROM tasks WHERE id=? AND user_id=? AND status IN ('pendiente','por_revisar')", [id, userId]);
      if (!r.changes) return { ok: false, reason: "no_borrable" };
      await run(db, "DELETE FROM task_attachments WHERE task_id=? AND user_id=?", [id, userId]);
      bus?.emit("task.update", { userId, task: { id, status: "borrada" } });
      return { ok: true, task };
    },
    // Pasa una tarea revisada a la cola real.
    async approveReview(userId, id) {
      const r = await run(db, "UPDATE tasks SET status='pendiente', updated_at=? WHERE id=? AND user_id=? AND status='por_revisar'", [now(), id, userId]);
      if (!r.changes) return { ok: false };
      const task = await api.get(userId, id); emit(task);
      return { ok: true, task };
    },
    // Entrega la siguiente tarea pendiente en orden de seq (atómico), solo de los motores que el PC puede atender.
    async claim(userId, claimedBy = "pc", engines = ["claude"]) {
      const ok = engines.filter((e) => ENGINES.includes(e));
      if (!ok.length) return null;
      const t = now();
      const r = await all(db, `UPDATE tasks SET status='reclamada', claimed_by=?, claimed_at=?, updated_at=?
        WHERE id = (SELECT id FROM tasks WHERE user_id=? AND status='pendiente' AND engine IN (${ok.map(() => "?").join(",")}) ORDER BY seq LIMIT 1) AND status='pendiente' RETURNING *`,
        [claimedBy, t, t, userId, ...ok]);
      const task = toTask(r[0]);
      emit(task);
      return task;
    },
    async setStatus(userId, id, status) {
      await run(db, "UPDATE tasks SET status=?, updated_at=? WHERE id=? AND user_id=?", [status, now(), id, userId]);
      const task = await api.get(userId, id); emit(task);
      return task;
    },
    async finish(userId, id, { status = "hecha", result = null }) {
      await run(db, "UPDATE tasks SET status=?, result=?, updated_at=? WHERE id=? AND user_id=?", [status, result, now(), id, userId]);
      const task = await api.get(userId, id); emit(task);
      return task;
    },
    async counts(userId) {
      const r = await all(db, "SELECT status, COUNT(*) AS n FROM tasks WHERE user_id=? GROUP BY status", [userId]);
      return Object.fromEntries(r.map((x) => [x.status, Number(x.n)]));
    },

    // Adjuntos: foto de hasta 4 MB, máximo 3 por tarea (solo mientras la tarea sea editable).
    async addAttachment({ userId, taskId, mime, data }) {
      if (!/^image\//.test(mime || "")) return { ok: false, reason: "solo_fotos" };
      const buf = Buffer.from(data);
      if (buf.length > MAX_FOTO_BYTES) return { ok: false, reason: "foto_grande" };
      const task = await api.get(userId, taskId);
      if (!task || !EDITABLES.includes(task.status)) return { ok: false, reason: "tarea_no_editable" };
      const n = await get(db, "SELECT COUNT(*) AS n FROM task_attachments WHERE task_id=? AND user_id=?", [taskId, userId]);
      if (Number(n.n) >= MAX_FOTOS_POR_TAREA) return { ok: false, reason: "demasiadas_fotos" };
      const r = await run(db, "INSERT INTO task_attachments (user_id, task_id, mime, size, data, created_at) VALUES (?,?,?,?,?,?)", [userId, taskId, mime, buf.length, buf, now()]);
      return { ok: true, id: r.id };
    },
    async listAttachments(userId, taskId) {
      return all(db, "SELECT id, mime, size FROM task_attachments WHERE task_id=? AND user_id=? ORDER BY id", [taskId, userId]);
    },
  };
  return api;
}
