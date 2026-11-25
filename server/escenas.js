// Escenas: lista cerrada de varias acciones (config/escenas.json) que se encolan en las colas existentes del PC y del iPhone.
// Solo pasos automáticos: nada que pida aprobación, privado ni capturas. Se comprueba al cargar y otra vez al ejecutar.
// El tope de capturas no aplica (no se admiten); pc_acciones y "PC apagado" los aplica la propia cola del PC.
import { norm } from "../desktop/runner/pc-spec.js";

const MAX_PASOS = 10;
const ID = /^[a-z0-9_]{1,40}$/;
const PROHIBIDAS = new Set(["captura"]);

const limpia = (s) => norm(s).replace(/[¿?¡!.,;]/g, " ").replace(/\s+/g, " ").trim();
const esObjeto = (v) => !!v && typeof v === "object" && !Array.isArray(v);

// Devuelve null si el paso vale, o el motivo del rechazo.
export function motivoRechazo(paso, { pc, phone }) {
  if (!esObjeto(paso)) return "paso_invalido";
  const { destino, accion, params = {} } = paso;
  if (destino !== "pc" && destino !== "phone") return "destino_invalido";
  if (!esObjeto(params)) return "params_invalidos";
  if (PROHIBIDAS.has(accion)) return "captura_no_permitida";
  const cola = destino === "pc" ? pc : phone;
  const defs = cola.config.acciones || {};
  if (!Object.hasOwn(defs, accion)) return "accion_desconocida";
  const def = defs[accion];
  if (def.privado) return "accion_privada";
  const claves = destino === "pc" ? Object.keys(def.params || {}) : ["valor", ...Object.keys(def.extras || {})];
  if (Object.keys(params).some((k) => !claves.includes(k))) return "parametro_desconocido";
  const v = cola.validate(accion, params);
  if (!v.ok) return v.error;
  return (destino === "pc" ? v.aprobacion : v.necesitaAprobacion) ? "requiere_aprobacion" : null;
}

// Separa las escenas válidas de las rechazadas. Un solo paso malo descarta la escena entera (nunca se ejecuta a medias).
export function cargarEscenas(config, colas) {
  const escenas = [], rechazadas = [], ids = new Set(), frases = new Set();
  for (const e of Array.isArray(config?.escenas) ? config.escenas : []) {
    const id = String(e?.id ?? "");
    const no = (motivo) => rechazadas.push({ id, motivo });
    if (!ID.test(id) || ids.has(id) || typeof e.nombre !== "string" || !e.nombre.trim()) { no("escena_invalida"); continue; }
    if (!Array.isArray(e.pasos) || !e.pasos.length || e.pasos.length > MAX_PASOS) { no("pasos_invalidos"); continue; }
    const mal = e.pasos.map((p) => { const m = motivoRechazo(p, colas); return m && `${p?.accion}: ${m}`; }).find(Boolean);
    if (mal) { no(mal); continue; }
    const suyas = [...new Set([e.nombre, ...(Array.isArray(e.frases) ? e.frases : [])].map(limpia).filter(Boolean))];
    if (suyas.some((f) => frases.has(f))) { no("frase_repetida"); continue; }
    ids.add(id); suyas.forEach((f) => frases.add(f));
    escenas.push({ id, nombre: e.nombre.trim(), frases: suyas, pasos: e.pasos });
  }
  return { escenas, rechazadas };
}

// Solo la frase exacta de la escena (con "activa/pon..." opcional) para no secuestrar la charla normal.
export function parseEscenaIntent(text, escenas) {
  let t = limpia(text);
  if (!t || t.length > 80) return null;
  t = t.replace(/^jarvis /, "").replace(/^(por favor|porfa) /, "").replace(/ (por favor|porfa)$/, "").replace(/ jarvis$/, "");
  const sin = t.replace(/^(?:activa|activar|activame|pon|ponme|inicia|lanza|ejecuta)(?: (?:el|la))?(?: escena(?: de)?)? /, "");
  return escenas.find((e) => e.frases.includes(t) || e.frases.includes(sin)) || null;
}

const MOTIVOS = { pc_apagado: "el PC está apagado", accion_no_soportada: "actualice la app del PC" };
export function resumir(nombre, lanzadas, fallidas) {
  const partes = [`Escena «${nombre}»: ${lanzadas.length} de ${lanzadas.length + fallidas.length} en cola.`];
  if (lanzadas.length) partes.push(`Lancé: ${lanzadas.map((x) => x.nombre).join("; ")}.`);
  if (fallidas.length) partes.push(`No pude: ${fallidas.map((x) => `${x.nombre} (${MOTIVOS[x.error] || x.error})`).join("; ")}.`);
  return partes.join(" ");
}

export function createEscenas({ config, pc, phone, audit = null }) {
  const colas = { pc, phone };
  const { escenas, rechazadas } = cargarEscenas(config, colas);
  for (const r of rechazadas) console.warn(`[escenas] «${r.id}» rechazada: ${r.motivo}`);

  async function lanzar(paso, ctx) {
    const motivo = motivoRechazo(paso, colas);
    if (motivo) return { ok: false, error: motivo };
    const { destino, accion, params = {} } = paso;
    return destino === "pc" ? pc.create({ ...ctx, action: accion, params }) : phone.create({ ...ctx, action: accion, args: params });
  }

  return {
    rechazadas,
    list: () => escenas.map((e) => ({ id: e.id, nombre: e.nombre, pasos: e.pasos.length })),
    detectar: (text) => parseEscenaIntent(text, escenas),

    async ejecutar({ userId, id, source = "web", conversationId = null, deviceId = null }) {
      const e = escenas.find((x) => x.id === id);
      if (!e) return { ok: false, error: "escena_desconocida" };
      const lanzadas = [], fallidas = [];
      for (const paso of e.pasos) {
        const donde = paso.destino === "pc" ? "PC" : "iPhone";
        const def = colas[paso.destino].config.acciones[paso.accion];
        const item = { destino: paso.destino, accion: paso.accion, nombre: `${donde}: ${def?.nombre || def?.descripcion || paso.accion}` };
        let out;
        try { out = await lanzar(paso, { userId, source, conversationId, deviceId }); }
        catch (err) { console.error("[escenas]", err.message); out = { ok: false, error: "error_interno" }; }
        if (out.ok) lanzadas.push({ ...item, id: out.item.id });
        else fallidas.push({ ...item, error: out.error });
      }
      await audit?.log({ userId, action: "escena.lanzada", detail: `${e.id} (${source}) ok ${lanzadas.length} fallo ${fallidas.length}` });
      return { ok: lanzadas.length > 0, escena: e.id, lanzadas, fallidas, resumen: resumir(e.nombre, lanzadas, fallidas) };
    },
  };
}
