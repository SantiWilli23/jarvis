// Cola de acciones del PC (Ola 0). Propia: no mezcla con las tareas de Claude. El PC la reclama con POST /api/agent/pc/next.
// Estados: aprobacion | lista | reclamada | hecha | fallida | rechazada | caducada.
// - PC apagado => no se encola nada (ni se despierta): { ok:false, error:"pc_apagado" }.
// - Todo se valida aquí con la lista blanca (config/pc-actions.json) y el PC lo valida otra vez (desktop/runner/pc-spec.js).
// - Nunca se ejecuta texto del usuario; el contenido de las acciones "privado" no se audita.
import { all, get, run } from "../db/client.js";
import { validateParams, SIEMPRE_APROBACION } from "../../desktop/runner/pc-spec.js";

const RECLAMADA_MAX_MS = 2 * 60_000; // si el PC reclama y no contesta, se da por fallida
const RESULT_MAX = 2000;
// Lo único que entienden las apps del PC que no informan capabilities.pc_acciones.
export const ACCIONES_ANTIGUAS = ["multimedia", "volumen", "bloquear", "temporizador", "abrir_app", "estado_sistema", "portapapeles_escribir", "suspender", "apagar", "reiniciar", "portapapeles_leer"];
const MSG_NO_SOPORTADA = "La app de su PC no admite esa acción, señor. Actualice la app del PC.";
// El día del tope es UTC, como el resto de contadores de uso del proyecto.
const diaDe = (t) => new Date(t).toISOString().slice(0, 10);

export function createPcQueue({ db, bus, approvals, audit, agent, config, now = () => Date.now() }) {
  const defs = config.acciones || {};
  const apps = config.apps || [];
  const minCad = (config.caducidad_minutos ?? 5) * 60_000;
  const minCadAprob = (config.caducidad_aprobacion_minutos ?? 30) * 60_000;
  const emit = (userId, extra = {}) => bus?.emit("pc.actions", { userId, ...extra });
  const log = (userId, action, detail = "") => audit?.log({ userId, action, detail });
  const pcOnline = () => { agent?.sweep?.(); return !!agent?.view?.().online; };
  const soporta = (action) => (agent?.accionesPc?.() ?? ACCIONES_ANTIGUAS).includes(action);
  const maxCapturas = config.capturas_por_dia ?? 20;
  const msgTope = `Ya se alcanzó el tope diario de capturas (${maxCapturas}), señor. Vuelva a intentarlo mañana.`;

  // Acciones no_guardar (texto tecleado): al terminar, caducar o rechazarse, sus params se borran.
  const noGuardar = Object.keys(defs).filter((id) => defs[id].no_guardar && /^[a-z_]+$/.test(id));
  const BORRAR = `params=CASE WHEN action IN (${["", ...noGuardar].map((id) => `'${id}'`).join(",")}) THEN '{}' ELSE params END`;

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
    // Con el PC apagado no se sabe qué admite: no se marca nada como no soportado.
    soportada: (action) => !pcOnline() || soporta(action),
    catalog() {
      return Object.entries(defs).map(([id, d]) => ({ id, descripcion: d.descripcion, nivel: d.nivel, privado: !!d.privado, ...(d.requiere ? { requiere: d.requiere } : {}), params: d.params }));
    },

    async sweep(userId = null) {
      const t = now(), f = userId != null ? " AND user_id=?" : "", a = userId != null ? [userId] : [];
      const c = await run(db, `UPDATE pc_actions SET status='caducada', done_at=?, ${BORRAR} WHERE status IN ('aprobacion','lista') AND expires_at < ?${f}`, [t, t, ...a]);
      const d = await run(db, `UPDATE pc_actions SET status='fallida', done_at=?, result=?, ${BORRAR} WHERE status='reclamada' AND claimed_at < ?${f}`,
        [t, JSON.stringify({ ok: false, texto: "El PC no contestó." }), t - RECLAMADA_MAX_MS, ...a]);
      if (d.changes) await run(db, "UPDATE claude_usage SET ok=0 WHERE tipo='captura' AND ok IS NULL AND action_id IN (SELECT id FROM pc_actions WHERE status='fallida')");
      if ((c.changes || d.changes) && userId != null) emit(userId);
    },

    // Encola una acción. No despierta ni espera al PC: si está apagado, se dice y no se guarda nada.
    async create({ userId, action, params: input = {}, source = "web", conversationId = null, deviceId = null, autorizada = false }) {
      const v = validate(action, input);
      if (!v.ok) return v;
      if (!pcOnline()) return { ok: false, error: "pc_apagado" };
      if (!soporta(action)) return { ok: false, error: "accion_no_soportada", mensaje: MSG_NO_SOPORTADA };
      await api.sweep(userId);
      const t = now();
      // La orden explícita autoriza SOLO esta fila, y solo las acciones con permiso propio (nunca apagar ni escribir).
      const porOrden = autorizada === true && v.aprobacion && !!v.def.requiere && !SIEMPRE_APROBACION.includes(action) && action !== "ui_escribir";
      const pide = v.aprobacion && !porOrden;
      const status = pide ? "aprobacion" : "lista";
      // Captura: el tope (usadas hoy + en espera) se comprueba en el mismo INSERT para que dos pedidos a la vez no lo salten.
      const tope = action === "captura";
      const r = await run(db, `INSERT INTO pc_actions (user_id, action, params, status, expires_at, created_at, conversation_id, device_id, source, approved) SELECT ?,?,?,?,?,?,?,?,?,?
        ${tope ? "WHERE (SELECT COUNT(*) FROM claude_usage WHERE user_id=? AND day=? AND tipo='captura') + (SELECT COUNT(*) FROM pc_actions WHERE user_id=? AND action='captura' AND status IN ('aprobacion','lista')) < ?" : ""}`,
        [userId, action, JSON.stringify(v.params), status, t + (pide ? minCadAprob : minCad), t, conversationId ?? null, deviceId ?? null, String(source).slice(0, 20), porOrden ? 1 : 0,
          ...(tope ? [userId, diaDe(t), userId, maxCapturas] : [])]);
      if (!r.changes) { await log(userId, "pc.tope", action); return { ok: false, error: "tope_capturas", mensaje: msgTope }; }
      if (porOrden) await log(userId, "pc.autorizada_orden", action);
      if (pide) {
        const resumen = action === "ui_escribir" ? `Escribir ${v.params.texto.length} caracteres en ${v.params.objetivo}` : v.def.descripcion;
        const a = await approvals.request({ userId, kind: `pc:${action}`, summary: `PC: ${resumen}`, detail: v.def.privado ? "Esta acción necesita su aprobación." : JSON.stringify(v.params) });
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
    async next(userId, { deviceId = null } = {}) {
      const t = now();
      await api.sweep(userId);
      for (let i = 0; i < 5; i++) {
        const rows = await all(db, `UPDATE pc_actions SET status='reclamada', claimed_at=?
          WHERE id=(SELECT id FROM pc_actions WHERE user_id=? AND status='lista' AND expires_at >= ? ORDER BY id LIMIT 1) AND status='lista' RETURNING *`, [t, userId, t]);
        const row = rows[0];
        if (!row) return null;
        let params = {}; try { params = JSON.parse(row.params || "{}"); } catch { /* vacío */ }
        const v = validate(row.action, params);
        if (!v.ok) { await run(db, `UPDATE pc_actions SET status='fallida', done_at=?, result=?, ${BORRAR} WHERE id=?`, [t, JSON.stringify({ ok: false, texto: "Acción no válida." }), row.id]); continue; }
        // Se encoló con otra app del PC (se cambió por una que no la admite).
        if (agent?.accionesPc?.() && !soporta(row.action)) { await descartar(userId, row, MSG_NO_SOPORTADA, t); continue; }
        // Uso de capturas: se apunta al entregarla (cuenta aunque falle). Segunda comprobación del tope, atómica.
        if (row.action === "captura") {
          const u = await run(db, `INSERT INTO claude_usage (user_id, day, tipo, device_id, action_id, created_at) SELECT ?,?,'captura',?,?,?
            WHERE (SELECT COUNT(*) FROM claude_usage WHERE user_id=? AND day=? AND tipo='captura') < ?`, [userId, diaDe(t), deviceId, row.id, t, userId, diaDe(t), maxCapturas]);
          if (!u.changes) { await descartar(userId, row, msgTope, t); continue; }
        }
        // `aprobada` solo es true si una aprobación real la dejó lista (o si la acción es automática).
        const aprobada = !v.aprobacion || !!Number(row.approved);
        await log(userId, "pc.reclamada", row.action);
        emit(userId);
        return { id: Number(row.id), accion: row.action, params: v.params, aprobada };
      }
      return null;
    },

    // Resultado del PC. Solo vale para acciones "reclamada". Si la acción es privada, la BD guarda "[privado]":
    // el contenido real solo viaja en vivo (evento pc.action.result -> accion.resultado -> WebSocket).
    async result(userId, id, { ok = true, texto = "", datos = null } = {}) {
      const row = await get(db, "SELECT * FROM pc_actions WHERE id=? AND user_id=?", [id, userId]);
      if (!row) return { ok: false, error: "no_encontrada" };
      const priv = !!defs[row.action]?.privado;
      const real = String(texto ?? "").slice(0, RESULT_MAX);
      const body = { ok: !!ok, texto: priv ? "[privado]" : real };
      if (!priv && datos && typeof datos === "object" && !Array.isArray(datos)) {
        const s = JSON.stringify(datos);
        if (s.length <= RESULT_MAX) body.datos = datos;
      }
      const r = await run(db, `UPDATE pc_actions SET status=?, result=?, done_at=?, ${BORRAR} WHERE id=? AND user_id=? AND status='reclamada'`, [ok ? "hecha" : "fallida", JSON.stringify(body), now(), id, userId]);
      if (!r.changes) return { ok: false, error: "estado_invalido", status: row.status };
      if (row.action === "captura") await run(db, "UPDATE claude_usage SET ok=? WHERE tipo='captura' AND action_id=? AND user_id=?", [ok ? 1 : 0, id, userId]);
      await log(userId, ok ? "pc.hecha" : "pc.fallida", row.action);
      emit(userId, { action: { id, status: ok ? "hecha" : "fallida" } });
      bus?.emit("pc.action.result", { userId, id, action: row.action, nombre: defs[row.action]?.descripcion || row.action, ok: !!ok, texto: real, privado: priv,
        conversationId: row.conversation_id == null ? null : Number(row.conversation_id), deviceId: row.device_id == null ? null : Number(row.device_id) });
      return { ok: true, item: view(await get(db, "SELECT * FROM pc_actions WHERE id=?", [id])) };
    },

    // Freno (todo lo pendiente) o permiso apagado (solo lo que lo requiere). Devuelve cuántas rechazó.
    async rechazarPendientes(userId, requiere = null) {
      const estados = requiere ? "('aprobacion','lista')" : "('aprobacion','lista','reclamada')";
      let n = 0;
      for (const row of await all(db, `SELECT id, action, approval_id FROM pc_actions WHERE user_id=? AND status IN ${estados}`, [userId])) {
        if (requiere && defs[row.action]?.requiere !== requiere) continue;
        const r = await run(db, `UPDATE pc_actions SET status='rechazada', done_at=?, ${BORRAR} WHERE id=? AND status IN ${estados}`, [now(), row.id]);
        n += r.changes;
        if (requiere && row.approval_id != null) await approvals.decide(userId, Number(row.approval_id), false);
      }
      if (n) emit(userId);
      return n;
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

  // El servidor la descarta antes de entregarla: queda fallida y el aviso vuelve al chat.
  async function descartar(userId, row, texto, t) {
    await run(db, `UPDATE pc_actions SET status='fallida', done_at=?, result=?, ${BORRAR} WHERE id=?`, [t, JSON.stringify({ ok: false, texto }), row.id]);
    emit(userId, { action: { id: Number(row.id), status: "fallida" } });
    bus?.emit("pc.action.result", { userId, id: Number(row.id), action: row.action, nombre: defs[row.action]?.descripcion || row.action, ok: false, texto, privado: false,
      conversationId: row.conversation_id == null ? null : Number(row.conversation_id), deviceId: row.device_id == null ? null : Number(row.device_id) });
  }

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
        await run(db, `UPDATE pc_actions SET status=?, done_at=?, ${BORRAR} WHERE id=? AND status='aprobacion'`, [approval.status === "aprobada" ? "caducada" : "rechazada", t, row.id]);
        await log(userId, approval.status === "aprobada" ? "pc.caducada" : "pc.rechazada", row.action);
      }
      emit(userId);
    } catch (e) { console.error("[pc]", e.message); }
  }
  bus?.on("approval.resolved", ({ userId, approval }) => onResolved(userId, approval)); // aprobada desde /api/approvals o Telegram
  return api;
}
