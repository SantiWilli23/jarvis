// Cola de acciones para el iPhone. El Atajo "Jarvis Puente" las recoge (POST /api/phone/next) y las ejecuta.
// Estados: aprobacion | lista | entregada | hecha | fallida | rechazada | caducada.
// Nunca se guardan tokens; el contenido de las acciones marcadas "privado" ni se audita ni se guarda su resultado.
import { all, get, run } from "../db/client.js";

const MAX_LOTE = 5;
const HORA = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export function createPhoneQueue({ db, bus, approvals, audit, config, now = () => Date.now() }) {
  const acciones = config.acciones || {};
  const minCad = (config.caducidad_minutos ?? 10) * 60_000;
  const minCadAprob = (config.caducidad_aprobacion_minutos ?? 30) * 60_000;
  const emit = (userId, extra = {}) => bus?.emit("phone.update", { userId, ...extra });
  const log = (userId, action, detail = "") => audit?.log({ userId, action, detail });

  function checkSpec(spec, v, nombre) {
    const vacio = v === undefined || v === null || v === "";
    if (spec.tipo === "ninguno") return { ok: true, value: undefined };
    if (vacio) return spec.opcional ? { ok: true, value: undefined } : { ok: false, error: `falta_${nombre}` };
    switch (spec.tipo) {
      case "enum": {
        const s = String(v).toLowerCase();
        return spec.valores.includes(s) ? { ok: true, value: s } : { ok: false, error: `${nombre}_invalido` };
      }
      case "rango": {
        const n = Number(v);
        return Number.isFinite(n) && n >= spec.min && n <= spec.max ? { ok: true, value: Math.round(n) } : { ok: false, error: `${nombre}_fuera_de_rango` };
      }
      case "texto": {
        const s = String(v).trim();
        return s && s.length <= spec.max ? { ok: true, value: s } : { ok: false, error: `${nombre}_invalido` };
      }
      case "hora": {
        const m = HORA.exec(String(v).trim());
        return m ? { ok: true, value: `${m[1].padStart(2, "0")}:${m[2]}` } : { ok: false, error: `${nombre}_invalido` };
      }
      case "app": {
        const app = (config.apps_permitidas || []).find((a) => norm(a) === norm(v));
        return app ? { ok: true, value: app } : { ok: false, error: "app_no_permitida" };
      }
      case "url": {
        try {
          const u = new URL(String(v));
          if (!["https:", "http:"].includes(u.protocol)) return { ok: false, error: "url_invalida" };
          return { ok: true, value: u.href.slice(0, 500) };
        } catch { return { ok: false, error: "url_invalida" }; }
      }
      default: return { ok: false, error: "tipo_desconocido" };
    }
  }
  const dominioPermitido = (href) => {
    const h = new URL(href).hostname.toLowerCase();
    return (config.dominios_permitidos || []).some((d) => h === d || h.endsWith("." + d));
  };

  // Devuelve { ok, args, necesitaAprobacion, def } o { ok:false, error }.
  function validate(accion, input = {}) {
    const def = acciones[accion];
    if (!def) return { ok: false, error: "accion_desconocida" };
    const args = {};
    const v = checkSpec(def.valor, input.valor, "valor");
    if (!v.ok) return v;
    if (v.value !== undefined) args.valor = v.value;
    for (const [k, spec] of Object.entries(def.extras || {})) {
      const e = checkSpec(spec, input[k], k);
      if (!e.ok) return e;
      if (e.value !== undefined) args[k] = e.value;
    }
    let necesita = def.modo === "aprobacion" || (def.aprobacion_valores || []).includes(args.valor);
    if (def.modo === "lista" && def.valor.tipo === "url") necesita = !dominioPermitido(args.valor);
    return { ok: true, args, necesitaAprobacion: necesita, def };
  }

  const view = (r) => {
    if (!r) return null;
    const def = acciones[r.action];
    const priv = !!def?.privado;
    let args = {};
    try { args = JSON.parse(r.args_json || "{}"); } catch { /* vacío */ }
    return {
      id: Number(r.id), action: r.action, nombre: def?.nombre || r.action, status: r.status, approval_id: r.approval_id == null ? null : Number(r.approval_id),
      args: priv ? undefined : args, privado: priv, result: r.result, expires_at: Number(r.expires_at), created_at: Number(r.created_at),
      delivered_at: r.delivered_at == null ? null : Number(r.delivered_at), done_at: r.done_at == null ? null : Number(r.done_at),
    };
  };

  const api = {
    config, validate,
    catalog() {
      return Object.entries(acciones).map(([id, d]) => ({ id, nombre: d.nombre, modo: d.modo, aprobacion_valores: d.aprobacion_valores || [], privado: !!d.privado, valor: d.valor, extras: d.extras || {} }));
    },

    // Marca como caducadas las acciones vivas pasadas de hora.
    async sweep(userId = null) {
      const t = now();
      const r = await run(db, `UPDATE phone_actions SET status='caducada', done_at=? WHERE status IN ('aprobacion','lista','entregada') AND expires_at < ?${userId != null ? " AND user_id=?" : ""}`,
        userId != null ? [t, t, userId] : [t, t]);
      if (r.changes && userId != null) emit(userId);
      return r.changes;
    },

    async create({ userId, action, args: input = {}, source = "web" }) {
      const v = validate(action, input);
      if (!v.ok) return v;
      const t = now();
      const status = v.necesitaAprobacion ? "aprobacion" : "lista";
      const expires = t + (v.necesitaAprobacion ? minCadAprob : minCad);
      const r = await run(db, "INSERT INTO phone_actions (user_id, action, args_json, status, expires_at, created_at) VALUES (?,?,?,?,?,?)",
        [userId, action, JSON.stringify(v.args), status, expires, t]);
      if (v.necesitaAprobacion) {
        const detalle = v.def.privado ? [v.args.para && `Para: ${v.args.para}`, v.args.valor && String(v.args.valor).slice(0, 200)].filter(Boolean).join("\n") : JSON.stringify(v.args);
        const a = await approvals.request({ userId, kind: `phone:${action}`, summary: `Teléfono: ${v.def.nombre}`, detail: detalle || "Esta acción necesita su aprobación." });
        await run(db, "UPDATE phone_actions SET approval_id=? WHERE id=?", [a.id, r.id]);
      }
      await log(userId, "phone.creada", `${action} ${status} (${source})`);
      emit(userId, { action: { id: r.id, status } });
      if (status === "lista") bus?.emit("phone.lista", { userId, id: r.id });
      return { ok: true, item: view(await get(db, "SELECT * FROM phone_actions WHERE id=?", [r.id])) };
    },

    async list(userId, { limit = 30 } = {}) {
      await api.sweep(userId);
      return (await all(db, "SELECT * FROM phone_actions WHERE user_id=? ORDER BY id DESC LIMIT ?", [userId, Math.min(100, limit)])).map(view);
    },
    async counts(userId) {
      await api.sweep(userId);
      const r = await all(db, "SELECT status, COUNT(*) AS n FROM phone_actions WHERE user_id=? AND status IN ('aprobacion','lista','entregada') GROUP BY status", [userId]);
      return Object.fromEntries(r.map((x) => [x.status, Number(x.n)]));
    },

    // Reclamo atómico (como tasks.claim): hasta 5 acciones "lista" pasan a "entregada" de una vez.
    async next(userId, max = MAX_LOTE) {
      const t = now();
      await api.sweep(userId);
      const rows = await all(db, `UPDATE phone_actions SET status='entregada', delivered_at=?
        WHERE id IN (SELECT id FROM phone_actions WHERE user_id=? AND status='lista' AND expires_at >= ? ORDER BY id LIMIT ?) AND status='lista' RETURNING *`,
        [t, userId, t, Math.min(MAX_LOTE, Math.max(1, max))]);
      rows.sort((a, b) => Number(a.id) - Number(b.id));
      if (rows.length) { await log(userId, "phone.entregada", `${rows.length} acciones`); emit(userId); }
      return rows.map((r) => {
        let args = {}; try { args = JSON.parse(r.args_json || "{}"); } catch { /* vacío */ }
        const { valor, ...extras } = args;
        return { id: Number(r.id), accion: r.action, valor: valor ?? "", ...extras };
      });
    },

    // El Atajo informa el resultado. Solo vale para acciones "entregada".
    async done(userId, id, { ok = true, result = null } = {}) {
      const row = await get(db, "SELECT * FROM phone_actions WHERE id=? AND user_id=?", [id, userId]);
      if (!row) return { ok: false, error: "no_encontrada" };
      const priv = !!acciones[row.action]?.privado;
      const text = result == null ? null : priv ? "[omitido]" : String(result).slice(0, 300);
      const status = ok ? "hecha" : "fallida";
      const r = await run(db, "UPDATE phone_actions SET status=?, result=?, done_at=? WHERE id=? AND user_id=? AND status='entregada'", [status, text, now(), id, userId]);
      if (!r.changes) return { ok: false, error: "estado_invalido", status: row.status };
      await log(userId, ok ? "phone.hecha" : "phone.fallida", row.action);
      emit(userId, { action: { id, status } });
      return { ok: true, item: view(await get(db, "SELECT * FROM phone_actions WHERE id=?", [id])) };
    },
  };

  // Aprobada -> "lista"; rechazada -> "rechazada".
  bus?.on("approval.resolved", async ({ userId, approval }) => {
    if (!approval?.kind?.startsWith("phone:")) return;
    try {
      const row = await get(db, "SELECT * FROM phone_actions WHERE approval_id=? AND user_id=?", [approval.id, userId]);
      if (!row || row.status !== "aprobacion") return;
      if (approval.status === "aprobada") {
        const t = now();
        const vivo = Number(row.expires_at) >= t;
        if (vivo) await run(db, "UPDATE phone_actions SET status='lista', expires_at=? WHERE id=? AND status='aprobacion'", [t + minCad, row.id]);
        else await run(db, "UPDATE phone_actions SET status='caducada', done_at=? WHERE id=? AND status='aprobacion'", [t, row.id]);
        await log(userId, "phone.aprobada", row.action);
        if (vivo) bus?.emit("phone.lista", { userId, id: row.id });
      } else {
        await run(db, "UPDATE phone_actions SET status='rechazada', done_at=? WHERE id=? AND status='aprobacion'", [now(), row.id]);
        await log(userId, "phone.rechazada", row.action);
      }
      emit(userId);
    } catch (e) { console.error("[phone]", e.message); }
  });
  return api;
}
