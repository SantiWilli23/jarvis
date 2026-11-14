// Cola de acciones del PC (Ola 0). Propia: no mezcla con las tareas de Claude. El PC la reclama con POST /api/agent/pc/next.
// Estados: aprobacion | lista | reclamada | hecha | fallida | rechazada | caducada.
// - PC apagado => no se encola nada (ni se despierta): { ok:false, error:"pc_apagado" }.
// - Todo se valida aquí con la lista blanca (config/pc-actions.json) y el PC lo valida otra vez (desktop/runner/pc-spec.js).
// - Nunca se ejecuta texto del usuario; el contenido de las acciones "privado" no se audita.
import { all, get, run } from "../db/client.js";
import { validateParams } from "../../desktop/runner/pc-spec.js";

const RECLAMADA_MAX_MS = 2 * 60_000; // si el PC reclama y no contesta, se da por fallida
const RESULT_MAX = 2000;

export function createPcQueue({ db, bus, approvals, audit, agent, config, now = () => Date.now() }) {
  const defs = config.acciones || {};
  const apps = config.apps || [];
  const minCad = (config.caducidad_minutos ?? 5) * 60_000;
  const minCadAprob = (config.caducidad_aprobacion_minutos ?? 30) * 60_000;
  const emit = (userId, extra = {}) => bus?.emit("pc.actions", { userId, ...extra });
  const log = (userId, action, detail = "") => audit?.log({ userId, action, detail });
  const pcOnline = () => { agent?.sweep?.(); return !!agent?.view?.().online; };

  const validate = (action, input) => {
    const v = validateParams(String(action || ""), input, { defs, apps });
    return v.ok ? { ok: true, params: v.params, def: v.def, aprobacion: v.def.nivel === "aprobacion" } : v;
  };

  const view = (r) => {
    if (!r) return null;
    const def = defs[r.action];
    let params = {}, result = null;
    try { params = JSON.parse(r.params || "{}"); } catch { /* vacío */ }
    try { result = r.result == null ? null : JSON.parse(r.result); } catch { /* vacío */ }
    return { id: Number(r.id), action: r.action, descripcion: def?.descripcion || r.action, nivel: def?.nivel || "aprobacion", status: r.status, params: def?.privado ? undefined : params,
      privado: !!def?.privado, result, approved: !!Number(r.approved), approval_id: r.approval_id == null ? null : Number(r.approval_id),
      created_at: Number(r.created_at), claimed_at: r.claimed_at == null ? null : Number(r.claimed_at), done_at: r.done_at == null ? null : Number(r.done_at) };
  };

  const api = {
    config, validate, pcOnline,
    catalog() {
      return Object.entries(defs).map(([id, d]) => ({ id, descripcion: d.descripcion, nivel: d.nivel, privado: !!d.privado, params: d.params }));
    },

    async sweep(userId = null) {
      const t = now(), f = userId != null ? " AND user_id=?" : "", a = userId != null ? [userId] : [];
      const c = await run(db, `UPDATE pc_actions SET status='caducada', done_at=? WHERE status IN ('aprobacion','lista') AND expires_at < ?${f}`, [t, t, ...a]);
      const d = await run(db, `UPDATE pc_actions SET status='fallida', done_at=?, result=? WHERE status='reclamada' AND claimed_at < ?${f}`,
        [t, JSON.stringify({ ok: false, texto: "El PC no contestó." }), t - RECLAMADA_MAX_MS, ...a]);
      if ((c.changes || d.changes) && userId != null) emit(userId);
    },

    // Encola una acción. No despierta ni espera al PC: si está apagado, se dice y no se guarda nada.
    async create({ userId, action, params: input = {}, source = "web" }) {
      const v = validate(action, input);
      if (!v.ok) return v;
      if (!pcOnline()) return { ok: false, error: "pc_apagado" };
      const t = now();
      const status = v.aprobacion ? "aprobacion" : "lista";
      const r = await run(db, "INSERT INTO pc_actions (user_id, action, params, status, expires_at, created_at) VALUES (?,?,?,?,?,?)",
        [userId, action, JSON.stringify(v.params), status, t + (v.aprobacion ? minCadAprob : minCad), t]);
      if (v.aprobacion) {
        const a = await approvals.request({ userId, kind: `pc:${action}`, summary: `PC: ${v.def.descripcion}`, detail: v.def.privado ? "Esta acción necesita su aprobación." : JSON.stringify(v.params) });
        await run(db, "UPDATE pc_actions SET approval_id=? WHERE id=?", [a.id, r.id]);
      }
      await log(userId, "pc.creada", `${action} ${status} (${source})`);
      emit(userId, { action: { id: r.id, status } });
      return { ok: true, item: view(await get(db, "SELECT * FROM pc_actions WHERE id=?", [r.id])) };
    },

    async list(userId, { limit = 30 } = {}) {
      await api.sweep(userId);
      return (await all(db, "SELECT * FROM pc_actions WHERE user_id=? ORDER BY id DESC LIMIT ?", [userId, Math.min(100, Math.max(1, limit))])).map(view);
    },
    async get(userId, id) { await api.sweep(userId); return view(await get(db, "SELECT * FROM pc_actions WHERE id=? AND user_id=?", [id, userId])); },

    // El PC reclama la siguiente acción lista (reclamo atómico). Se revalida por si la lista blanca cambió.
    async next(userId) {
      const t = now();
      await api.sweep(userId);
      for (let i = 0; i < 5; i++) {
        const rows = await all(db, `UPDATE pc_actions SET status='reclamada', claimed_at=?
          WHERE id=(SELECT id FROM pc_actions WHERE user_id=? AND status='lista' AND expires_at >= ? ORDER BY id LIMIT 1) AND status='lista' RETURNING *`, [t, userId, t]);
        const row = rows[0];
        if (!row) return null;
        let params = {}; try { params = JSON.parse(row.params || "{}"); } catch { /* vacío */ }
        const v = validate(row.action, params);
        if (!v.ok) { await run(db, "UPDATE pc_actions SET status='fallida', done_at=?, result=? WHERE id=?", [t, JSON.stringify({ ok: false, texto: "Acción no válida." }), row.id]); continue; }
        // `aprobada` solo es true si una aprobación real la dejó lista (o si la acción es automática).
        const aprobada = !v.aprobacion || !!Number(row.approved);
        await log(userId, "pc.reclamada", row.action);
        emit(userId);
        return { id: Number(row.id), accion: row.action, params: v.params, aprobada };
      }
      return null;
    },

    // Resultado del PC. Solo vale para acciones "reclamada". El texto privado se guarda para el dueño pero no se audita.
    async result(userId, id, { ok = true, texto = "", datos = null } = {}) {
      const row = await get(db, "SELECT * FROM pc_actions WHERE id=? AND user_id=?", [id, userId]);
      if (!row) return { ok: false, error: "no_encontrada" };
      const body = { ok: !!ok, texto: String(texto ?? "").slice(0, RESULT_MAX) };
      if (datos && typeof datos === "object" && !Array.isArray(datos)) {
        const s = JSON.stringify(datos);
        if (s.length <= RESULT_MAX) body.datos = datos;
      }
      const r = await run(db, "UPDATE pc_actions SET status=?, result=?, done_at=? WHERE id=? AND user_id=? AND status='reclamada'", [ok ? "hecha" : "fallida", JSON.stringify(body), now(), id, userId]);
      if (!r.changes) return { ok: false, error: "estado_invalido", status: row.status };
      await log(userId, ok ? "pc.hecha" : "pc.fallida", row.action);
      emit(userId, { action: { id, status: ok ? "hecha" : "fallida" } });
      bus?.emit("pc.action.result", { userId, id, action: row.action, ok: !!ok });
      return { ok: true, item: view(await get(db, "SELECT * FROM pc_actions WHERE id=?", [id])) };
    },

    // Aprobar o rechazar desde el chat/web (equivale a /api/approvals/:id).
    async decide(userId, id, aprobar) {
      const row = await get(db, "SELECT * FROM pc_actions WHERE id=? AND user_id=?", [id, userId]);
      if (!row) return { ok: false, error: "no_encontrada" };
      if (row.status !== "aprobacion" || row.approval_id == null) return { ok: false, error: "estado_invalido", status: row.status };
      const a = await approvals.decide(userId, Number(row.approval_id), !!aprobar);
      if (!a) return { ok: false, error: "estado_invalido" };
      await onResolved(userId, a); // sin esperar al evento: la respuesta ya refleja el nuevo estado
      return { ok: true, item: view(await get(db, "SELECT * FROM pc_actions WHERE id=?", [id])) };
    },
  };

  // Aprobada -> "lista" con approved=1; rechazada -> "rechazada".
  async function onResolved(userId, approval) {
    if (!approval?.kind?.startsWith("pc:")) return;
    try {
      const row = await get(db, "SELECT * FROM pc_actions WHERE approval_id=? AND user_id=?", [approval.id, userId]);
      if (!row || row.status !== "aprobacion") return;
      const t = now();
      if (approval.status === "aprobada" && Number(row.expires_at) >= t && pcOnline()) {
        await run(db, "UPDATE pc_actions SET status='lista', approved=1, expires_at=? WHERE id=? AND status='aprobacion'", [t + minCad, row.id]);
        await log(userId, "pc.aprobada", row.action);
      } else {
        await run(db, "UPDATE pc_actions SET status=?, done_at=? WHERE id=? AND status='aprobacion'", [approval.status === "aprobada" ? "caducada" : "rechazada", t, row.id]);
        await log(userId, approval.status === "aprobada" ? "pc.caducada" : "pc.rechazada", row.action);
      }
      emit(userId);
    } catch (e) { console.error("[pc]", e.message); }
  }
  bus?.on("approval.resolved", ({ userId, approval }) => onResolved(userId, approval)); // aprobada desde /api/approvals o Telegram
  return api;
}
