// Cola del PC para Claude sin herramientas (docs/CONTROL.md). carga y resultado van cifrados.
// El servidor es la autoridad de estados: pendiente -> en_curso -> ok | error | vencida | cancelado.
// Lo que devuelve Claude es DATO: solo lo recibe el manejador del tipo; nunca se interpreta como orden.
import express, { Router } from "express";
import { all, get, run } from "./db/client.js";
import { MENSAJE_FRENO } from "./control.js";

const MIN = 60_000, DIA = 86_400_000;
export const ESPERA_MS = 30 * MIN; // sin que el PC la tome
export const CURSO_MS = 7 * MIN; // el PC corta a los 5 min
export const RETENCION_MS = 30 * DIA;
const POR_DIA = 40, MAX_CARGA = 60_000, MAX_RESULTADO = 40_000;
const ABIERTOS = "estado IN ('pendiente','en_curso')";
const ERRORES = ["sin_claude", "sin_cuota", "sin_login", "saturado", "tiempo", "herramienta", "error"];

export function createClaudeTextos({ db, crypto, bus, agent, audit = null, getControl = () => null, now = () => Date.now() }) {
  const err = (status, error, mensaje) => Object.assign(new Error(error), { status, error, mensaje });
  const frenado = async (userId) => !!(await getControl()?.frenado(userId));
  const manejadores = new Map(); // tipo -> fn({id,userId,tipo,meta,estado,texto,error}); false o excepción = resultado inservible
  const abrir = (blob) => { try { return crypto.decrypt(blob); } catch { return null; } };
  const conPc = () => { agent.sweep(); const v = agent.view(); return !!v.online && !v.paused; };

  async function entregar(t, estado, texto = "", error = null) {
    const h = manejadores.get(t.tipo);
    const meta = abrir(t.carga)?.meta || {};
    try {
      return !h || (await h({ id: Number(t.id), userId: Number(t.user_id), tipo: t.tipo, meta, estado, texto, error })) !== false;
    } catch {
      await audit?.log({ userId: Number(t.user_id), action: "textos.manejador_fallo", detail: `#${t.id}` }); // sin detalle: podría llevar contenido
      return false;
    }
  }

  async function barrer(userId) {
    const t = now();
    const viejas = await all(db, "SELECT * FROM claude_textos WHERE user_id=? AND ((estado='pendiente' AND expira<?) OR (estado='en_curso' AND tomado<?))", [userId, t, t - CURSO_MS]);
    for (const f of viejas) {
      const u = await run(db, `UPDATE claude_textos SET estado='vencida', terminado=? WHERE id=? AND ${ABIERTOS}`, [t, f.id]);
      if (u.changes) await entregar(f, "vencida");
    }
  }

  // Para otros módulos. `texto` viaja por stdin a Claude; `meta` vuelve al manejador y no sale del servidor.
  async function encolar({ userId, tipo, texto, meta = {} }) {
    if (await frenado(userId)) throw err(409, "frenado", MENSAJE_FRENO);
    if (!crypto.enabled) throw err(409, "sin_cifrado", "Falta la clave de cifrado (CONNECTIONS_KEY) en el servidor, señor.");
    if (!manejadores.has(tipo)) throw err(400, "tipo_desconocido", "No sé preparar eso, señor.");
    if (typeof texto !== "string" || !texto.trim()) throw err(400, "texto_vacio", "No hay nada que preparar, señor.");
    if (texto.length > MAX_CARGA) throw err(413, "texto_largo", "Es demasiado largo, señor.");
    if (!conPc()) throw err(409, "pc_apagado", "Su PC está apagado o Jarvis está en pausa allí, señor: esto solo lo hace Claude en el PC y no encolé nada. Enciéndalo y vuelva a pedírmelo.");
    await barrer(userId);
    const t = now();
    const n = Number((await get(db, "SELECT COUNT(*) AS n FROM claude_textos WHERE user_id=? AND creado>=?", [userId, t - DIA])).n);
    if (n >= POR_DIA) throw err(429, "tope_dia", `Llegué al tope de ${POR_DIA} pedidos de texto por día, señor.`);
    const r = await run(db, "INSERT INTO claude_textos (user_id, tipo, carga, estado, creado, expira) VALUES (?,?,?,'pendiente',?,?)",
      [userId, tipo, crypto.encrypt({ texto, meta }), t, t + ESPERA_MS]);
    await audit?.log({ userId, action: "textos.encolar", detail: `${tipo} #${r.id}` });
    return { id: Number(r.id), estado: "pendiente" };
  }

  async function claim(userId, deviceId) {
    if (await frenado(userId)) return { task: null, reason: "frenado" };
    await barrer(userId);
    const t = await get(db, "SELECT * FROM claude_textos WHERE user_id=? AND estado='pendiente' ORDER BY id LIMIT 1", [userId]);
    if (!t) return { task: null };
    const carga = abrir(t.carga);
    if (!carga) {
      await run(db, "UPDATE claude_textos SET estado='error', error='error', terminado=? WHERE id=?", [now(), t.id]);
      return { task: null };
    }
    // Una a la vez por dispositivo, en la misma sentencia.
    const u = await run(db, "UPDATE claude_textos SET estado='en_curso', tomado=?, device_id=? WHERE id=? AND estado='pendiente' AND NOT EXISTS (SELECT 1 FROM claude_textos WHERE device_id=? AND estado='en_curso')", [now(), deviceId, t.id, deviceId]);
    return u.changes ? { task: { id: Number(t.id), tipo: t.tipo, texto: carga.texto } } : { task: null };
  }

  async function result(userId, deviceId, id, { estado, texto, error } = {}) {
    if (await frenado(userId)) throw err(409, "frenado", MENSAJE_FRENO);
    if (!["ok", "error"].includes(estado)) throw err(400, "estado_invalido");
    await barrer(userId);
    const t = await get(db, "SELECT * FROM claude_textos WHERE id=? AND user_id=?", [id, userId]);
    if (!t || Number(t.device_id) !== Number(deviceId)) throw err(404, "no_existe");
    const cuerpo = typeof texto === "string" ? texto.trim().slice(0, MAX_RESULTADO) : "";
    let final = estado === "ok" && cuerpo ? "ok" : "error";
    const motivo = final === "ok" ? null : ERRORES.includes(error) ? error : "error";
    const u = await run(db, "UPDATE claude_textos SET estado=?, resultado=?, error=?, terminado=? WHERE id=? AND estado='en_curso'",
      [final, final === "ok" ? crypto.encrypt(cuerpo) : null, motivo, now(), id]);
    if (!u.changes) throw err(409, "tarea_cerrada");
    if (!(await entregar(t, final, final === "ok" ? cuerpo : "", motivo)) && final === "ok") {
      final = "error";
      await run(db, "UPDATE claude_textos SET estado='error', error='respuesta_invalida' WHERE id=?", [id]);
    }
    await audit?.log({ userId, action: "textos.resultado", detail: `#${id} ${final}` });
    return { ok: true };
  }

  // Sin contenido: estados y meta de los últimos pedidos.
  async function lista(userId) {
    await barrer(userId);
    const rows = await all(db, "SELECT id, tipo, carga, estado, error, creado FROM claude_textos WHERE user_id=? ORDER BY id DESC LIMIT 20", [userId]);
    return rows.map((r) => ({ id: Number(r.id), tipo: r.tipo, estado: r.estado, error: r.error || null, creado: Number(r.creado), meta: abrir(r.carga)?.meta || {} }));
  }

  async function cancelar(userId, id) {
    const u = await run(db, `UPDATE claude_textos SET estado='cancelado', terminado=? WHERE id=? AND user_id=? AND ${ABIERTOS}`, [now(), id, userId]);
    if (!u.changes) throw err(409, "tarea_cerrada");
    return { ok: true };
  }

  const wrap = (fn) => async (req, res, next) => {
    try { res.json(await fn(req, Number(req.user.id))); }
    catch (e) { if (e?.error) res.status(e.status || 400).json({ error: e.error, mensaje: e.mensaje }); else next(e); }
  };

  return {
    encolar, claim, result, lista, cancelar, conPc,
    registrar(tipo, fn) { manejadores.set(tipo, fn); },
    async tick(userId) {
      await barrer(userId);
      await run(db, "DELETE FROM claude_textos WHERE creado<?", [now() - RETENCION_MS]);
    },
    routes() {
      const r = Router();
      r.get("/", wrap(async (_req, uid) => ({ tareas: (await lista(uid)).map(({ meta: _m, ...t }) => t) })));
      r.post("/:id/cancel", wrap((req, uid) => cancelar(uid, Number(req.params.id) || 0)));
      return r;
    },
    // Solo token "pc".
    agentRoutes() {
      const r = Router();
      r.use(express.json({ limit: "256kb" }));
      r.post("/claim", wrap((req, uid) => claim(uid, req.device.id)));
      r.post("/:id/result", wrap((req, uid) => result(uid, req.device.id, Number(req.params.id) || 0, req.body || {})));
      return r;
    },
  };
}
