// Pruebas a Google Calendar, regla MDE (docs/NAV.md). Sin modelos: las materias y fechas salen de lo escolar guardado.
// Se muestran antes de crear (botón en Estudiar) salvo pedido explícito en el chat. Nada escolar va a messages ni a audit.
import { Router } from "express";
import { plano } from "./escolar-intents.js";
import { MENSAJE_FRENO } from "./control.js";

const COLORES = { "Inglés": "5", "Matemáticas": "9", "Lenguaje": "11", "Historia": "6" };
const MATERIAS = [["Inglés", /\b(ingles|english)\b/], ["Matemáticas", /\bmat(e|ematicas?)?\b/], ["Lenguaje", /\b(lenguaje|lengua y literatura|literatura)\b/], ["Historia", /\bhistoria\b/]];
const PREVIOS = [["Repaso y Resumen", 3], ["Ejercitación", 2], ["Repaso Corto", 1]];
const ES_PRUEBA = /\b(prueba|pruebas|evaluacion|examen|certamen|control|test|quiz|assessment)\b/;
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DIA = 86_400_000;
const GUARDADO = "(Aquí le mostré al señor eventos de sus pruebas. No se guardan en la conversación.)";
const SIN_PRUEBAS = "No encuentro pruebas con fecha por venir, señor. Pídame «revisa mi classroom» o «revisa lirmi» y vuelva a intentarlo.";
const SIN_SERVIDOR = "Google no está configurado en el servidor, señor: faltan GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET o CONNECTIONS_KEY (guía del usuario, sección 14).";
const SIN_CONEXION = "Google no está conectado, señor. En el teléfono (/m), abra el menú Más, pulse «Conectar Google», acepte el permiso de Calendar y vuelva a pedírmelo.";
const FALLO_GOOGLE = "Google Calendar no respondió bien, señor. Si se repite, vuelva a conectar Google desde el menú Más.";

// ---------- frases ----------
const INICIO = "^(?:(?:oye )?jarvis )?(?:(?:por favor|porfa) )?(?:(?:puedes|podrias) )?";
const FIN = "(?: por favor| porfa)?$";
const PONER = "(?:pon|ponme|poner|agrega|agregame|agregar|anade|anademe|anadir|anota|anotame|anotar|agenda|agendame|agendar|crea|creame|crear|mete|meteme|meter|pasa|pasame|pasar)";
const COSAS = "(?:(?:todas |todos )?(?:mis |las |los )?(?:eventos (?:de|para) (?:mis |las )?)?(?:pruebas|evaluaciones))(?: del colegio)?";
const CAL = "(?:en|a|al) (?:(?:el|mi) )?(?:google )?(?:calendar|calendario)";
const CREAR = [`${PONER} ${COSAS} ${CAL}`, `${PONER} ${CAL} ${COSAS}`, "(?:crea|creame|crear) (?:los )?eventos (?:de|para) (?:mis |las )?(?:pruebas|evaluaciones)"].map((r) => new RegExp(INICIO + r + FIN));
const VER = [
  "que (?:eventos )?(?:pondrias|crearias|agregarias|anotarias) (?:en|a) (?:(?:el|mi) )?(?:google )?(?:calendar|calendario)",
  `(?:muestrame|muestra|ver|quiero ver) (?:los )?eventos (?:(?:de|para) (?:mis |las )?(?:pruebas|evaluaciones)(?: ${CAL})?|para (?:el |mi )?(?:google )?(?:calendar|calendario))`,
].map((r) => new RegExp(INICIO + r + FIN));

export function parseCalendarioIntent(text) {
  const p = plano(text);
  return CREAR.some((r) => r.test(p)) ? "crear" : VER.some((r) => r.test(p)) ? "ver" : null;
}

// ---------- fechas y eventos ----------
const sumar = (dia, n) => new Date(Date.parse(`${dia}T00:00:00Z`) + n * DIA).toISOString().slice(0, 10);
const hoyEn = (zona, t) => new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));

// "2026-12-03 10:00", "03/12", "3 de diciembre"... -> {dia, hora|null} o null. Sin año: el más cercano que no quede muy atrás.
export function leerFecha(texto, hoy) {
  const s = String(texto ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  let m, a, me, d;
  if ((m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) [a, me, d] = [+m[1], +m[2], +m[3]];
  else if ((m = /\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}|\d{2}))?\b/.exec(s))) [d, me, a] = [+m[1], +m[2], m[3] ? +m[3] : null];
  else if ((m = /\b(\d{1,2})(?: de)? (ene|feb|mar|abr|may|jun|jul|ago|sep|set|oct|nov|dic)[a-z]*\.?(?:(?: de| del)? (\d{4}))?/.exec(s))) [d, me, a] = [+m[1], MESES.indexOf(m[2] === "set" ? "sep" : m[2]) + 1, m[3] ? +m[3] : null];
  else return null;
  const armar = (anio) => {
    const t = new Date(Date.UTC(anio, me - 1, d));
    return t.getUTCMonth() === me - 1 && t.getUTCDate() === d ? t.toISOString().slice(0, 10) : null;
  };
  if (a != null && a < 100) a += 2000;
  const anio = +hoy.slice(0, 4);
  let dia = armar(a ?? anio);
  if (a == null && dia && dia < sumar(hoy, -180)) dia = armar(anio + 1);
  if (!dia) return null;
  const resto = s.slice(0, m.index) + " " + s.slice(m.index + m[0].length);
  const h = /(?:^|[^\d])([01]?\d|2[0-3]):([0-5]\d)(?:\s*([ap])\.?\s?m\b)?/.exec(resto.replace(/(\d)t(\d)/, "$1 $2"));
  let hora = null;
  if (h) {
    const hh = h[3] ? (+h[1] % 12) + (h[3] === "p" ? 12 : 0) : +h[1];
    hora = `${String(hh).padStart(2, "0")}:${h[2]}`;
  }
  return { dia, hora };
}

function materia(item) {
  for (const t of [item.curso, item.titulo]) {
    const p = plano(t);
    const m = MATERIAS.find(([, re]) => re.test(p));
    if (m) return m[0];
  }
  return String(item.curso ?? "").replace(/\s+/g, " ").trim().slice(0, 80) || "Materia sin nombre";
}

const esPrueba = (i) => /evaluaci|prueba|examen|test|quiz|assessment/.test(plano(i.tipo)) || ES_PRUEBA.test(plano(i.titulo));

function evento(titulo, dia, hora, color) {
  let inicio = dia, fin = sumar(dia, 1); // día completo: el fin es exclusivo
  if (hora) {
    const [h, m] = hora.split(":");
    inicio = `${dia}T${hora}:00`;
    fin = +h === 23 ? `${dia}T23:59:00` : `${dia}T${String(+h + 1).padStart(2, "0")}:${m}:00`;
  }
  return { id: `${dia}|${plano(titulo)}`, titulo, dia, inicio, fin, ...(color ? { colorId: color } : {}) };
}

// Regla MDE: 4 eventos por prueba de hoy en adelante; nunca en días pasados ni repetidos.
export function proponer(items, hoy) {
  const pruebas = new Map();
  let sinFecha = 0;
  for (const i of items) {
    if (!esPrueba(i)) continue;
    const f = leerFecha(i.fecha, hoy);
    if (!f) { sinFecha++; continue; }
    if (f.dia < hoy) continue;
    const m = materia(i), k = `${f.dia}|${plano(m)}`;
    if (!pruebas.has(k) || (f.hora && !pruebas.get(k).hora)) pruebas.set(k, { ...f, materia: m });
  }
  const eventos = new Map();
  for (const p of pruebas.values()) {
    const color = Object.hasOwn(COLORES, p.materia) ? COLORES[p.materia] : null;
    const lista = [...PREVIOS.map(([n, antes]) => evento(`${n} - ${p.materia}`, sumar(p.dia, -antes), "17:00", color)), evento(`${p.materia} - Prueba`, p.dia, p.hora, color)];
    for (const e of lista) if (e.dia >= hoy) eventos.set(e.id, e);
  }
  return { eventos: [...eventos.values()].sort((a, b) => a.inicio.localeCompare(b.inicio)), sinFecha };
}

const linea = (e) => `- ${e.dia} ${e.inicio.length > 10 ? e.inicio.slice(11, 16) : "(día completo)"}: ${e.titulo}${e.existe ? " (ya está)" : ""}`;
const resumen = (n) => `Creé ${n.creados} ${n.creados === 1 ? "evento" : "eventos"} en Calendar, señor.${n.omitidos ? ` ${n.omitidos} ya estaban.` : ""}${n.fallidos ? ` ${n.fallidos} fallaron: puede pedírmelo otra vez, no se duplican.` : ""}`;

export function createEscolarCalendario({ escolar, audit = null, getGoogle, getControl = () => null, now = () => Date.now() }) {
  const err = (status, error, mensaje) => Object.assign(new Error(error), { status, error, mensaje });
  const frenado = async (userId) => !!(await getControl()?.frenado(userId));
  const enCurso = new Map(); // por usuario: dos pedidos a la vez no deben duplicar

  async function propuesta(userId) {
    const zona = getGoogle()?.zona || "America/Santiago";
    return proponer((await escolar.resumen(userId)).items, hoyEn(zona, now()));
  }
  // null si se puede usar; si no, qué decirle al señor.
  async function falta(userId) {
    const g = getGoogle();
    if (!g?.enabled) return SIN_SERVIDOR;
    return (await g.connected(userId)) ? null : SIN_CONEXION;
  }
  async function marcar(userId, eventos) {
    if (!eventos.length) return eventos;
    const dias = eventos.map((e) => e.dia).sort();
    const hay = new Set((await getGoogle().findEvents(userId, { desde: dias[0], hasta: dias.at(-1) })).map((e) => `${e.dia}|${plano(e.summary)}`));
    return eventos.map((e) => ({ ...e, existe: hay.has(e.id) }));
  }

  async function vista(userId) {
    const p = await propuesta(userId);
    let aviso = await falta(userId), eventos = p.eventos;
    const conectado = !aviso;
    if (conectado) {
      try { eventos = await marcar(userId, eventos); }
      catch (e) { console.error("[calendario]", e.message); aviso = FALLO_GOOGLE; }
    }
    return { conectado, eventos, sinFecha: p.sinFecha, mensaje: aviso || (eventos.length ? "" : SIN_PRUEBAS) };
  }

  async function ejecutar(userId, ids) {
    if (await frenado(userId)) throw err(409, "frenado", MENSAJE_FRENO);
    const aviso = await falta(userId);
    if (aviso) throw err(409, "google_sin_conexion", aviso);
    let { eventos } = await propuesta(userId);
    if (ids) eventos = eventos.filter((e) => ids.includes(e.id)); // solo lo que se le mostró
    const n = { creados: 0, omitidos: 0, fallidos: 0 };
    if (!eventos.length) return { ...n, mensaje: SIN_PRUEBAS };
    try { eventos = await marcar(userId, eventos); } // sin poder mirar el calendario no se crea (se duplicaría)
    catch (e) { console.error("[calendario]", e.message); throw err(502, "google_error", FALLO_GOOGLE); }
    let freno = false;
    for (const e of eventos) {
      if (e.existe) { n.omitidos++; continue; }
      if ((freno = await frenado(userId))) break;
      try {
        await getGoogle().createEvent(userId, { summary: e.titulo, start: e.inicio, end: e.fin, colorId: e.colorId, description: "Creado por Jarvis." });
        n.creados++;
      } catch (x) { console.error("[calendario]", x.message); n.fallidos++; }
    }
    await audit?.log({ userId, action: "escolar.calendario", detail: `creados: ${n.creados}, ya estaban: ${n.omitidos}, fallidos: ${n.fallidos}${freno ? ", frenado" : ""}` });
    return { ...n, mensaje: freno ? `${resumen(n)} ${MENSAJE_FRENO}` : resumen(n) };
  }
  function crear(userId, ids = null) {
    const p = (enCurso.get(userId) || Promise.resolve()).catch(() => {}).then(() => ejecutar(userId, ids));
    enCurso.set(userId, p);
    return p;
  }

  // Para el chat: `reply` se muestra; `guardar` es lo único que va a messages (server/chat-service.js).
  async function intent({ userId, text, chatSolo = false, source = "texto" }) {
    const accion = parseCalendarioIntent(text);
    if (!accion) return null;
    const salida = (reply, guardar) => ({ status: "escolar", private: true, reply, guardar });
    const fijo = (reply) => salida(reply, reply); // avisos sin contenido escolar
    if (chatSolo) return fijo("En modo Chat no hago acciones, señor. Cambie a modo IA y vuelva a pedírmelo.");
    if (accion === "crear") {
      try { return fijo((await crear(userId)).mensaje); }
      catch (e) { if (!e?.error) throw e; return fijo(e.mensaje); }
    }
    // Al Atajo y a Telegram no viaja contenido escolar.
    if (source === "atajo" || source === "telegram") return fijo("Véalo en Jarvis, en Estudiar, señor.");
    const v = await vista(userId);
    if (!v.eventos.length) return fijo(v.mensaje);
    const resto = v.eventos.length > 20 ? `\nY ${v.eventos.length - 20} más en Estudiar.` : "";
    return salida(`Esto pondría en su calendario, señor (todavía no creé nada):\n${v.eventos.slice(0, 20).map(linea).join("\n")}${resto}${v.mensaje ? `\n${v.mensaje}` : ""}\nSi está de acuerdo, diga «pon mis pruebas en el calendario».`, GUARDADO);
  }

  const h = (fn) => async (req, res, next) => {
    try { res.set("Cache-Control", "no-store").json(await fn(req, Number(req.user.id))); }
    catch (x) { if (x?.error) res.status(x.status || 400).json({ error: x.error, mensaje: x.mensaje }); else next(x); }
  };

  return {
    vista, crear, intent,
    // /api/escolar/calendario (solo sesión web): GET = vista previa; POST {ids} = crear lo que se mostró.
    routes() {
      const r = Router();
      r.get("/", h((_req, uid) => vista(uid)));
      r.post("/", h((req, uid) => {
        const ids = req.body?.ids;
        if (!Array.isArray(ids) || !ids.length || ids.some((x) => typeof x !== "string")) throw err(400, "faltan_eventos", "Primero mire la lista de eventos, señor.");
        return crear(uid, ids);
      }));
      return r;
    },
  };
}
