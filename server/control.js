// Freno (botón de emergencia) y estado del control del PC (docs/CONTROL.md).
// Con freno puesto no se encola ni se reparte nada al PC. Solo la web con sesión puede reanudar.
import express, { Router } from "express";
import { all, get, run } from "./db/client.js";
import { ProError } from "./pro/orchestrator.js";
import { getRatonLista, setRatonLista } from "./settings.js";
import { entradaValida, MAX_LISTA } from "../desktop/runner/pc-reglas.js";

export const MENSAJE_FRENO = "El freno está puesto, señor. Reanude desde la web cuando quiera.";
const MIN_DEF = 30, MIN_MAX = 240;
const RONDAS_FINALES = ["hecha", "fallida", "cancelada"];
const MSG_APAGADO = {
  amplio: "El control amplio está apagado, señor. Enciéndalo desde la web (Control del PC) y repítamelo.",
  raton: "El control de ratón y teclado está apagado, señor. Enciéndalo desde la web (Control del PC) y repítamelo.",
};
const hostDe = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; } };
const frenadoErr = () => ({ status: 409, error: "frenado", mensaje: MENSAJE_FRENO });

export function createControl({ db, bus, audit, approvals, tasks, agent, pc, nav = null, browser = null, pro = null, env = {}, now = () => Date.now() }) {
  const propios = [env.PUBLIC_URL, env.RENDER_EXTERNAL_URL].map(hostDe).filter(Boolean);
  const lista = (userId) => getRatonLista(db, userId, { negados: propios });
  async function estado(userId) {
    const r = await get(db, "SELECT * FROM control_estado WHERE user_id=?", [userId]);
    const t = now(), frenado = !!Number(r?.frenado || 0);
    const vivo = (v) => (!frenado && v != null && Number(v) > t ? Number(v) : null);
    const amplio = vivo(r?.amplio_hasta), raton = vivo(r?.raton_hasta);
    return { frenado, frenado_at: frenado ? Number(r.frenado_at) : null, amplio: !!amplio, raton: !!raton, amplio_hasta: amplio, raton_hasta: raton };
  }
  const frenado = async (userId) => (await estado(userId)).frenado;
  const paraPc = async (userId) => { const e = await estado(userId); return { freno: e.frenado, amplio: e.amplio, raton: e.raton, ...(e.raton ? { lista: await lista(userId) } : {}) }; };
  const guardar = (userId, f, at, amplio, raton) => run(db, `INSERT INTO control_estado (user_id, frenado, frenado_at, amplio_hasta, raton_hasta) VALUES (?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET frenado=excluded.frenado, frenado_at=excluded.frenado_at, amplio_hasta=excluded.amplio_hasta, raton_hasta=excluded.raton_hasta`,
    [userId, f ? 1 : 0, at, amplio, raton]);
  const avisar = async (userId) => bus?.emit("control.estado", { userId, ...(await estado(userId)) });

  // Primero se marca el freno (nada nuevo entra) y después se cancela lo que había.
  // Cada paso va aparte: uno que falle no detiene a los demás.
  async function freno(userId, { origen = "web" } = {}) {
    await guardar(userId, true, now(), null, null);
    const n = {}, fallos = [];
    const paso = async (nombre, fn) => { try { n[nombre] = await fn(); } catch (e) { fallos.push(nombre); console.error("[freno]", nombre, e?.message); } };
    const cada = async (sql, args, fn) => {
      let c = 0;
      for (const f of await all(db, sql, args)) { try { await fn(Number(f.id)); c++; } catch (e) { if (e?.status !== 409) throw e; } }
      return c;
    };
    const sql = async (q, args) => (await run(db, q, args)).changes;
    const t = now();
    await paso("tareas", () => cada("SELECT id FROM tasks WHERE user_id=? AND status IN ('pendiente','por_revisar','reclamada','en_curso')", [userId], (id) => tasks.cancel(userId, id)));
    if (nav) await paso("nav", () => cada("SELECT id FROM nav_tasks WHERE user_id=? AND estado IN ('pendiente','en_curso')", [userId], (id) => nav.cancel(userId, id)));
    if (pc) await paso("pc", () => pc.rechazarPendientes(userId));
    if (pro) await paso("pro", () => cada(`SELECT id FROM pro_rounds WHERE user_id=? AND status NOT IN (${RONDAS_FINALES.map(() => "?").join(",")})`, [userId, ...RONDAS_FINALES], (id) => pro.orch.cancel(userId, id)));
    if (browser) await paso("navegador", () => cada("SELECT id FROM browser_tasks WHERE user_id=? AND status IN ('pendiente','preparando','esperando_usuario')", [userId], (id) => browser.cancel(userId, id)));
    await paso("textos", () => sql("UPDATE claude_textos SET estado='cancelado', terminado=? WHERE user_id=? AND terminado IS NULL", [t, userId]));
    await paso("repartos", () => sql("UPDATE memoria_repartos SET estado='cancelado', terminado=? WHERE user_id=? AND terminado IS NULL", [t, userId]));
    await paso("aprobaciones", async () => { let c = 0; for (const a of await approvals.pending(userId)) if (await approvals.decide(userId, a.id, false)) c++; return c; });
    const detalle = Object.entries(n).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(", ") || "nada en marcha";
    await audit?.log({ userId, action: "control.freno", detail: `${origen === "pc" ? "desde el PC" : "desde la web"}; ${detalle}${fallos.length ? `; no pude cancelar: ${fallos.join(", ")}` : ""}` });
    bus?.emit("pc.actions", { userId });
    await avisar(userId);
    return { ...(await estado(userId)), cancelado: n, fallos };
  }

  async function reanudar(userId) {
    await guardar(userId, false, null, null, null);
    await audit?.log({ userId, action: "control.reanudar", detail: "desde la web" });
    await avisar(userId);
    return estado(userId);
  }

  // Control amplio y de ratón: apagados por defecto y siempre con caducidad.
  async function activar(userId, { amplio, raton, minutos } = {}) {
    const e = await estado(userId);
    if (e.frenado) { if (amplio === true || raton === true) throw frenadoErr(); return e; }
    const hasta = now() + Math.min(MIN_MAX, Math.max(1, Math.round(Number(minutos)) || MIN_DEF)) * 60_000;
    const nuevo = (v, antes) => (v === true ? hasta : v === false ? null : antes);
    await guardar(userId, false, null, nuevo(amplio, e.amplio_hasta), nuevo(raton, e.raton_hasta));
    const s = await estado(userId);
    for (const [k, v] of [["amplio", amplio], ["raton", raton]]) if (v === false) await pc?.rechazarPendientes?.(userId, k);
    await audit?.log({ userId, action: "control.activar", detail: `amplio: ${s.amplio ? "sí" : "no"}, ratón: ${s.raton ? "sí" : "no"}` });
    await avisar(userId);
    return s;
  }

  // Guarda la lista autorizada (solo sesión web). Una sola entrada mala rechaza el cambio entero.
  async function guardarLista(userId, entradas, negados = []) {
    if (!Array.isArray(entradas) || entradas.length > MAX_LISTA) throw { status: 400, error: "lista_invalida", mensaje: `Máximo ${MAX_LISTA} entradas.` };
    const limpias = entradas.map((e) => {
      const v = entradaValida(e, { negados: [...propios, ...negados] });
      if (!v) throw { status: 400, error: "entrada_no_permitida", mensaje: `No se puede autorizar «${String(e?.valor ?? "").slice(0, 60)}».` };
      return v;
    });
    const unicas = [...new Map(limpias.map((e) => [`${e.tipo} ${e.valor}`, e])).values()];
    await setRatonLista(db, userId, unicas, now());
    await audit?.log({ userId, action: "control.lista", detail: `${unicas.length} entradas` });
    return unicas;
  }

  // ---------- acciones con permiso propio ("requiere") ----------
  const requiereDe = (accion) => pc?.config?.acciones?.[accion]?.requiere;
  const crear = pc?.create, siguiente = pc?.next;
  if (crear) pc.create = async (o = {}) => {
    const r = requiereDe(o.action);
    if (r) {
      if (!(await estado(o.userId))[r]) return { ok: false, error: `${r}_apagado`, mensaje: MSG_APAGADO[r] };
      if (r === "raton") {
        const objetivo = String(o.params?.objetivo ?? "").trim().toLowerCase();
        if (!(await lista(o.userId)).some((e) => e.valor === objetivo)) return { ok: false, error: "objetivo_no_permitido", mensaje: "Ese objetivo no está en la lista autorizada, señor." };
      }
    }
    return crear.call(pc, o);
  };
  if (siguiente) pc.next = async (userId, o) => {
    const accion = await siguiente.call(pc, userId, o);
    const r = accion && requiereDe(accion.accion);
    if (!r || (await estado(userId))[r]) return accion;
    await pc.result(userId, accion.id, { ok: false, texto: "control apagado" });
    return null;
  };

  // ---------- con freno puesto no entra ni sale nada ----------
  function cerrar(obj, metodo, siFrenado) {
    const original = obj?.[metodo];
    if (typeof original !== "function") return;
    obj[metodo] = async (...args) => {
      const userId = typeof args[0] === "object" && args[0] ? args[0].userId : args[0];
      return (await frenado(userId)) ? siFrenado() : original.apply(obj, args);
    };
  }
  const lanzar = (e) => () => { throw e(); };
  cerrar(tasks, "create", lanzar(frenadoErr));
  cerrar(tasks, "approveReview", () => ({ ok: false, reason: "frenado" }));
  cerrar(tasks, "claim", () => null);
  cerrar(pc, "create", () => ({ ok: false, error: "frenado", mensaje: MENSAJE_FRENO }));
  cerrar(pc, "next", () => null);
  cerrar(nav, "enqueue", lanzar(frenadoErr));
  cerrar(nav, "claim", () => ({ task: null }));
  cerrar(browser, "enqueue", lanzar(frenadoErr));
  cerrar(browser, "claim", () => ({ task: null, reason: "frenado" }));
  for (const m of ["send", "iniciar", "reintentar", "reenqueue"]) cerrar(pro?.orch, m, lanzar(() => new ProError(409, "frenado")));
  cerrar(pro?.orch, "claim", () => ({ job: null }));
  const decide = pro?.orch?.decide;
  if (decide) pro.orch.decide = async (userId, roundId, o = {}) => {
    if (o.accion !== "rechazar" && (await frenado(userId))) throw new ProError(409, "frenado");
    return decide.call(pro.orch, userId, roundId, o);
  };

  const wrap = (fn) => async (req, res, next) => {
    try { await fn(req, res, Number(req.user.id)); }
    catch (e) { if (e?.error) res.status(e.status || 400).json({ error: e.error, mensaje: e.mensaje }); else next(e); }
  };
  const body = (req) => (req.body && typeof req.body === "object" ? req.body : {});

  return {
    estado, frenado, paraPc, freno, reanudar, activar,
    // /api/control (solo sesión web)
    routes() {
      const r = Router();
      r.use(express.json({ limit: "4kb" }));
      r.get(["/", "/estado"], wrap(async (req, res, uid) => res.json(await estado(uid))));
      r.post("/freno", wrap(async (req, res, uid) => res.json(await freno(uid))));
      r.post("/reanudar", wrap(async (req, res, uid) => res.json(await reanudar(uid))));
      r.put("/activar", wrap(async (req, res, uid) => res.json(await activar(uid, body(req)))));
      r.get("/lista", wrap(async (req, res, uid) => res.json({ lista: await lista(uid) })));
      r.put("/lista", wrap(async (req, res, uid) => res.json({ lista: await guardarLista(uid, body(req).lista, [hostDe(`https://${req.get("host")}`)].filter(Boolean)) })));
      return r;
    },
    // /api/agent/control (solo token "pc"): registrar, frenar y apagar permisos. Nunca reanudar ni encender.
    agentRoutes() {
      const r = Router();
      r.use(express.json({ limit: "4kb" }));
      r.post("/log", wrap(async (req, res, uid) => {
        const b = body(req);
        const accion = String(b.accion || "").toLowerCase().replace(/[^a-z0-9_.-]/g, "").slice(0, 40);
        if (!accion) return res.status(400).json({ error: "faltan_datos" });
        // Solo "detalle": cualquier otro campo (texto tecleado, capturas) se descarta.
        await audit?.log({ userId: uid, action: `pc.control.${accion}`, detail: typeof b.detalle === "string" ? b.detalle.slice(0, 200) : "" });
        res.json({ ok: true, frenado: await frenado(uid) });
      }));
      r.post("/freno", wrap(async (req, res, uid) => {
        if (!(await frenado(uid))) await freno(uid, { origen: "pc" });
        res.json({ ok: true, control: await paraPc(uid) });
      }));
      r.post("/apagar", wrap(async (req, res, uid) => {
        await activar(uid, { amplio: false, raton: false });
        res.json({ ok: true, control: await paraPc(uid) });
      }));
      return r;
    },
  };
}
