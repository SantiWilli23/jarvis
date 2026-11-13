// Aprobaciones: acciones sensibles que esperan el "sí" del señor en el teléfono.
import { all, get, run } from "./db/client.js";

export function createApprovals({ db, bus, audit, now = () => Date.now() }) {
  const view = (r) => r && { id: Number(r.id), task_id: r.task_id == null ? null : Number(r.task_id), kind: r.kind, summary: r.summary, detail: r.detail, status: r.status, created_at: Number(r.created_at) };
  return {
    async request({ userId, taskId = null, kind, summary, detail = "" }) {
      const r = await run(db, "INSERT INTO approvals (user_id, task_id, kind, summary, detail, created_at) VALUES (?,?,?,?,?,?)", [userId, taskId, kind, summary, detail, now()]);
      const a = view(await get(db, "SELECT * FROM approvals WHERE id=?", [r.id]));
      await audit?.log({ userId, action: "aprobacion.pedida", detail: `${kind}: ${summary}` });
      bus?.emit("approval.request", { userId, approval: a });
      return a;
    },
    async pending(userId) {
      return (await all(db, "SELECT * FROM approvals WHERE user_id=? AND status='pendiente' ORDER BY id", [userId])).map(view);
    },
    async decide(userId, id, approve) {
      const status = approve ? "aprobada" : "rechazada";
      const r = await run(db, "UPDATE approvals SET status=?, decided_at=? WHERE id=? AND user_id=? AND status='pendiente'", [status, now(), id, userId]);
      if (!r.changes) return null;
      const a = view(await get(db, "SELECT * FROM approvals WHERE id=?", [id]));
      await audit?.log({ userId, action: `aprobacion.${status}`, detail: a.summary });
      bus?.emit("approval.resolved", { userId, approval: a });
      return a;
    },
  };
}
