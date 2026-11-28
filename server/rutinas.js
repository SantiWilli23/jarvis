// Rutinas (docs/CONTROL.md): pasos escritos como frases que pasan por el chat de siempre, así que cada uno
// sigue las mismas reglas (preguntas, aprobaciones, freno) que si se escribiera a mano.
// Por horario no hay autorización explícita: solo se ejecuta solo lo que lee; lo demás pide permiso antes.
import express, { Router } from "express";
import { all, get, run } from "./db/client.js";
import { getModo } from "./settings.js";
import { classify } from "./router/classify.js";
import { detectDirect } from "./queue/direct.js";
import { plano, parseEscolarIntent } from "./escolar-intents.js";
import { instante, sumarDias, diaSemana, cuando } from "./funciones/comun.js";
import { parseNavIntent } from "./nav-intents.js";
import { parsePhoneIntent } from "./phone/intents.js";
import { detectDestino, stripDestino, parsePcIntent } from "./pc/intents.js";

export const ZONA = "America/Santiago";
export const MAX_RUTINAS = 20;
export const MAX_PASOS = 8;
export const MAX_DIARIAS = 30;
const MAX_PASO = 200;
const GRACIA_MIN = 10; // margen si el servidor despierta tarde
const VIGENCIA_PERMISO = 12 * 3_600_000;
const SOURCE = "rutina";
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const SENSIBLE = /contrase|password|\bclaves?\b|\bpin\b|\btoken\b|\bbanco\b|\btarjetas?\b|\bpag(a|ar|o|os|ue)\b|transfier|transferencia/i;
const REVISAR_TAREAS = /^(?:revisa|revisar|mira|lee|dime)(?: mis)? (?:tareas|pendientes)(?: pendientes)?$/;
const MSG_CHAT = "Está en modo Chat, señor: las rutinas no se ejecutan ni se cambian. Páselo a IA en Configuración.";
const MSG_FRENO = "El freno está puesto, señor: no ejecuté la rutina.";

const err = (status, error, mensaje) => ({ status, error, mensaje });
const limpia = (s) => plano(s).replace(/^(?:oye )?jarvis /, "").replace(/^(?:por favor|porfa) /, "").replace(/ (?:por favor|porfa)$/, "").replace(/ jarvis$/, "");

// ---------- horario ----------
export function zonaValida(z) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: z }); return true; } catch { return false; }
}
function local(t, zona) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zona, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { fecha: `${p.year}-${p.month}-${p.day}`, dia: new Date(Date.UTC(+p.year, +p.month - 1, +p.day)).getUTCDay(), min: +p.hour * 60 + +p.minute };
}
// ¿Toca ahora? Una sola vez por día y hora; un horario recién puesto no dispara una hora ya pasada.
export function toca(horario, t, { ultima = null, desde = 0 } = {}) {
  if (!horario) return false;
  const a = local(t, horario.zona);
  const [h, m] = horario.hora.split(":").map(Number);
  const meta = h * 60 + m, atraso = a.min - meta;
  if (!horario.dias.includes(a.dia) || atraso < 0 || atraso >= GRACIA_MIN) return false;
  if (desde >= t - (t % 60_000) - atraso * 60_000 + 60_000) return false;
  if (ultima == null) return true;
  const u = local(ultima, horario.zona);
  return !(u.fecha === a.fecha && u.min >= meta);
}
// Última ocasión (en 7 días) que pasó el margen sin correr: el servidor estaba dormido. null si no hay.
export function perdida(horario, t, { ultima = null, desde = 0 } = {}) {
  if (!horario) return null;
  const [h, m] = horario.hora.split(":").map(Number);
  const { fecha } = local(t, horario.zona);
  for (let n = 0; n <= 7; n++) {
    const dia = sumarDias(fecha, -n);
    if (!horario.dias.includes(diaSemana(dia))) continue;
    const occ = instante(dia, h, m, horario.zona);
    if (occ > t) continue;
    if (t - occ < GRACIA_MIN * 60_000) return null; // todavía a tiempo: la corre toca()
    return desde >= occ + 60_000 || (ultima != null && ultima >= occ) ? null : occ;
  }
  return null;
}
function validarHorario(h, zonaDef) {
  if (h == null) return null;
  const dias = [...new Set(Array.isArray(h.dias) ? h.dias.map(Number) : [])].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort();
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(h.hora ?? ""));
  const zona = String(h.zona || zonaDef);
  if (!dias.length || !m || !zonaValida(zona)) throw err(400, "horario_invalido", "El horario necesita días y una hora válida, señor.");
  return { dias, hora: `${m[1].padStart(2, "0")}:${m[2]}`, zona };
}
export function textoHorario(h) {
  if (!h) return "sin horario";
  return `${h.dias.length === 7 ? "todos los días" : h.dias.map((d) => DIAS[d]).join(", ")} a las ${h.hora}`;
}

// ---------- frases del chat ----------
const DIA_RE = "(?:lunes|martes|miercoles|jueves|viernes|sabados?|domingos?)";
const CUANDO = new RegExp(`^(?:(?:cada|todos los|los) )?(dias?|dia de semana|fines? de semana|de lunes a viernes|${DIA_RE}(?:(?:\\s*,\\s*| y )(?:los )?${DIA_RE})*) a las? (\\d{1,2})(?:[:.h](\\d{2}))?(?: ?(?:hrs?|horas))?( de la (?:manana|tarde|noche))?(?=[\\s,:]|$)`);
function diasDe(s) {
  if (/^dias?$/.test(s)) return [0, 1, 2, 3, 4, 5, 6];
  if (s === "dia de semana" || s === "de lunes a viernes") return [1, 2, 3, 4, 5];
  if (s.includes("de semana")) return [0, 6];
  return DIAS.map((d, i) => (new RegExp(`\\b${plano(d).replace(/s$/, "")}s?\\b`).test(s) ? i : -1)).filter((i) => i >= 0);
}
// Sin tildes ni mayúsculas y con las mismas posiciones, para cortar sobre el texto original.
const plegado = (s) => s.split("").map((c) => c.normalize("NFD")[0].toLowerCase()[0]).join("");

const CREAR = /^\s*(?:(?:oye )?jarvis[,.:]? )?(?:por favor,? )?(?:crea|creame|crear|nueva|agrega|programa)(?: una| otra)?(?: nueva)? rutina\b/;
const DISPARO = /^(?:cuando (?:yo )?diga|al decir|con la frase) +/i;

// "crea una rutina [llamada X]: cada viernes a las 18 revisa mis tareas y avísame". Devuelve { nombre, frase, horario, pasos } o null.
export function parseCrear(text) {
  const orig = String(text ?? "").normalize("NFC").trim();
  const p = plegado(orig);
  const m = CREAR.exec(p);
  let i = m ? m[0].length : 0;
  // Sin "crea una rutina" solo vale "cada viernes a las 18 ... y avísame".
  if (!m && !(/^cada /.test(p) && CUANDO.test(p) && /\by avisame[.!]*$/.test(p))) return null;
  const salta = () => { i += /^[\s,:;.]*/.exec(p.slice(i))[0].length; };
  const toma = (re) => { const x = re.exec(p.slice(i)); if (!x) return null; const desde = i; i += x[0].length; return { x, trozo: orig.slice(desde, i) }; };
  let nombre = "", frase = "", horario = null, x;
  salta();
  if ((x = toma(/^(?:llamada|que se llame) +["“']?[^:,"”']+?["”']?(?=\s*[:,]| (?:cada|cuando|al decir|con la frase)\b)/))) nombre = x.trozo.replace(/^(?:llamada|que se llame) +/i, "").replace(/["“”']/g, "").trim();
  for (let n = 0; n < 2; n++) {
    salta();
    // Tras ":" ya empiezan los pasos: «qué tengo en classroom» no pierde el «qué».
    if (!/:s*$/.test(p.slice(0, i)) && !/^qué /i.test(orig.slice(i))) toma(/^(?:que |para que )/);
    if (!horario && (x = toma(CUANDO))) {
      let h = Number(x.x[2]);
      if (/tarde|noche/.test(x.x[4] || "") && h < 12) h += 12;
      horario = { dias: diasDe(x.x[1]), hora: `${h}:${x.x[3] || "00"}` };
    } else if (!frase && (x = toma(/^(?:cuando (?:yo )?diga|al decir|con la frase) +(?:["“'][^"”']+["”']|[^:,]+)/))) {
      frase = x.trozo.replace(DISPARO, "").replace(/["“”']/g, "").trim();
    }
  }
  salta();
  const pasos = orig.slice(i).split(/\s*(?:;|\n|,?\s+(?:y\s+)?(?:luego|despu[eé]s)\s+|,?\s+y\s+(?=av[ií]same))\s*/i)
    .map((s) => s.replace(/^(?:y )?(?:luego|despu[eé]s),? +/i, "").replace(/[.!\s]+$/, "").trim()).filter((s) => s && !/^av[ií]same$/i.test(s));
  return { nombre, frase, horario, pasos };
}

const LISTAR = /^(?:(?:lista|listame|muestra|muestrame|ver|dime)(?: (?:mis|las))? rutinas|(?:que|cuales) (?:rutinas (?:tengo|hay)|son mis rutinas)|mis rutinas)$/;
const ORDEN = /^(borra|elimina|pausa|desactiva|reanuda|activa|lanza|ejecuta|prueba|corre)(?: (?:la|mi))? rutina (?:(?:numero|n) )?(?:de )?(.+)$/;

export function createRutinas({ db, bus = null, audit = null, approvals = null, escenas = null, pc = null, phone = null, getChat, getControl = () => null, getPush = () => null, getNotify = () => null, zona = ZONA, now = () => Date.now() }) {
  const zonaDef = zona && zonaValida(zona) ? zona : ZONA;
  const enMarcha = new Set();
  const pendientes = new Set(); // trabajo lanzado por una aprobación
  const log = (userId, action, detail) => audit?.log({ userId, action, detail });
  const frenado = async (userId) => !!(await getControl()?.frenado(userId));
  const modoChat = async (userId) => (await getModo(db, userId)) === "chat";

  const json = (s, d) => { try { return JSON.parse(s) ?? d; } catch { return d; } };
  const view = (r) => r && { id: Number(r.id), nombre: r.nombre, frase: r.frase || "", pasos: json(r.pasos, []), horario: json(r.horario, null), activa: !!Number(r.activa), ultima: r.ultima == null ? null : Number(r.ultima), actualizado: Number(r.actualizado) };
  const lista = async (userId) => (await all(db, "SELECT * FROM rutinas WHERE user_id=? ORDER BY id", [userId])).map(view);
  const una = async (userId, id) => view(await get(db, "SELECT * FROM rutinas WHERE id=? AND user_id=?", [id, userId]));

  async function validar(userId, datos, id = null) {
    const pasos = (Array.isArray(datos.pasos) ? datos.pasos : []).map((s) => String(s ?? "").trim()).filter(Boolean);
    if (!pasos.length) throw err(400, "sin_pasos", "La rutina necesita al menos un paso, señor.");
    if (pasos.length > MAX_PASOS || pasos.some((s) => s.length > MAX_PASO)) throw err(400, "demasiados_pasos", `Como mucho ${MAX_PASOS} pasos de ${MAX_PASO} caracteres, señor.`);
    const frase = String(datos.frase ?? "").trim().slice(0, 80);
    const nombre = (String(datos.nombre ?? "").trim() || frase || pasos[0]).slice(0, 60);
    if ([nombre, frase, ...pasos].some((s) => SENSIBLE.test(s) || classify(s).private)) throw err(400, "privado", "No guardo en rutinas nada privado, de claves ni de pagos, señor.");
    const otras = (await lista(userId)).filter((r) => r.id !== id);
    const frases = new Set([...otras.map((r) => r.frase), frase].map(limpia).filter(Boolean));
    if (pasos.some((s) => /\brutinas?\b/.test(plano(s)) || frases.has(limpia(s)))) throw err(400, "recursion", "Una rutina no puede crear ni lanzar otra, señor.");
    if (frase && (limpia(frase).length < 4 || escenas?.detectar(frase) || otras.some((r) => limpia(r.frase) === limpia(frase) || r.pasos.some((s) => limpia(s) === limpia(frase))))) {
      throw err(400, "frase_no_valida", "Esa frase es muy corta o ya está en uso, señor.");
    }
    return { nombre, frase, pasos, horario: validarHorario(datos.horario, zonaDef) };
  }

  async function crear(userId, datos) {
    if ((await lista(userId)).length >= MAX_RUTINAS) throw err(409, "tope", `Ya tiene ${MAX_RUTINAS} rutinas, señor. Borre alguna.`);
    const v = await validar(userId, datos);
    const t = now();
    const r = await run(db, "INSERT INTO rutinas (user_id, nombre, frase, pasos, horario, activa, creado, actualizado) VALUES (?,?,?,?,?,1,?,?)",
      [userId, v.nombre, v.frase || null, JSON.stringify(v.pasos), v.horario && JSON.stringify(v.horario), t, t]);
    await log(userId, "rutina.creada", `id ${r.id}`);
    return una(userId, r.id);
  }
  async function cambiar(userId, id, datos) {
    const antes = await una(userId, id);
    if (!antes) throw err(404, "no_encontrada", "No encuentro esa rutina, señor.");
    const activa = typeof datos.activa === "boolean" ? datos.activa : antes.activa;
    const v = await validar(userId, { ...antes, ...datos }, id);
    await run(db, "UPDATE rutinas SET nombre=?, frase=?, pasos=?, horario=?, activa=?, actualizado=? WHERE id=? AND user_id=?",
      [v.nombre, v.frase || null, JSON.stringify(v.pasos), v.horario && JSON.stringify(v.horario), activa ? 1 : 0, now(), id, userId]);
    await log(userId, "rutina.cambiada", `id ${id}${activa ? "" : " pausada"}`);
    return una(userId, id);
  }
  async function borrar(userId, id) {
    const r = await run(db, "DELETE FROM rutinas WHERE id=? AND user_id=?", [id, userId]);
    if (r.changes) await log(userId, "rutina.borrada", `id ${id}`);
    return !!r.changes;
  }

  // ¿El paso solo lee? Ante la duda, no (se pedirá permiso).
  function soloLee(paso) {
    if (detectDirect(paso).direct || escenas?.detectar(paso)) return false;
    if (parseEscolarIntent(paso)) return true;
    if (parseNavIntent(paso)) return false;
    const destino = detectDestino(paso);
    const texto = destino ? stripDestino(paso) : paso;
    const a = destino !== "telefono" && pc ? parsePcIntent(texto, { apps: pc.config.apps || [], destino }) : null;
    const b = destino !== "pc" && phone ? parsePhoneIntent(texto, phone.config, { destino, original: paso }) : null;
    if (!a && !b) return false;
    return (!a || a.action === "estado_sistema") && (!b || b.action === "estado");
  }
  const frasePaso = (paso) => (REVISAR_TAREAS.test(limpia(paso)) ? "qué tareas tengo" : paso);

  // Un paso por el chat normal. Devuelve { estado, texto }; lo privado nunca se copia al resumen.
  async function darPaso(userId, paso, ctx) {
    if (await frenado(userId)) return { estado: "frenado" };
    try {
      const r = await getChat().handle({ userId, text: frasePaso(paso), conversationId: ctx.conversationId, source: SOURCE, deviceId: ctx.deviceId ?? null });
      ctx.conversationId = r.conversationId ?? ctx.conversationId;
      const texto = r.private ? "" : String(r.reply ?? "").replace(/\s+/g, " ").slice(0, 160);
      if (r.status === "frenado") return { estado: "frenado" };
      if (r.status === "sin_cuota" || r.status === "vacio" || r.pc?.error || r.nav?.error) return { estado: "fallo", texto };
      if (r.status === "tarea" || r.pc?.status === "aprobacion" || r.phone?.status === "aprobacion") return { estado: "espera", texto };
      return { estado: "hecho", texto };
    } catch (e) {
      console.error("[rutinas]", e?.message);
      return { estado: "fallo" };
    }
  }

  const NOMBRES = { hecho: "hecho", espera: "espera su visto bueno", fallo: "no se pudo", permiso: "le pedí permiso", frenado: "frenado" };
  async function avisar(userId, hechos) {
    const n = (e) => hechos.filter((h) => h.estado === e).length;
    const falta = n("permiso") + n("espera");
    // Sin nombres ni contenido: el aviso puede verse con la pantalla bloqueada.
    const body = `Terminó una rutina. Pasos listos: ${n("hecho")} de ${hechos.length}.${falta ? ` Esperan su visto bueno: ${falta}.` : ""}${n("fallo") ? ` Fallaron: ${n("fallo")}.` : ""}`;
    try { await getPush()?.notify(userId, { title: "Jarvis", body }); } catch (e) { console.error("[rutinas] push", e?.message); }
  }

  async function pedirPermiso(userId, rutina, paso) {
    const kind = `rutina:${rutina.id}`;
    if ((await approvals.pending(userId)).some((a) => a.kind === kind && a.detail === paso)) return;
    await approvals.request({ userId, kind, summary: "Rutina programada: ¿ejecuto este paso?", detail: paso });
  }

  // origen: "horario" (sin autorización), "frase", "chat" o "probar" (lo pidió el señor).
  async function ejecutar(userId, rutina, { origen, conversationId = null, deviceId = null } = {}) {
    if (await modoChat(userId)) return { ok: false, mensaje: MSG_CHAT };
    if (await frenado(userId)) return { ok: false, mensaje: MSG_FRENO };
    if (enMarcha.has(userId)) return { ok: false, mensaje: "Ya hay una rutina en marcha, señor." };
    enMarcha.add(userId);
    try {
      const n = await get(db, "SELECT COUNT(*) AS n FROM audit_log WHERE user_id=? AND action='rutina.ejecutada' AND created_at>?", [userId, now() - 86_400_000]);
      if (Number(n.n) >= MAX_DIARIAS) return { ok: false, mensaje: `Llegó el tope de ${MAX_DIARIAS} ejecuciones en un día, señor.` };
      const ctx = { conversationId, deviceId }, hechos = [];
      for (const paso of rutina.pasos.slice(0, MAX_PASOS)) {
        if (origen === "horario" && !soloLee(frasePaso(paso))) {
          if (await frenado(userId)) break;
          await pedirPermiso(userId, rutina, paso);
          hechos.push({ paso, estado: "permiso" });
          continue;
        }
        const r = await darPaso(userId, paso, ctx);
        hechos.push({ paso, ...r });
        if (r.estado === "frenado") break;
      }
      await log(userId, "rutina.ejecutada", `id ${rutina.id} (${origen}) ${hechos.map((h) => h.estado).join(",")}`);
      if (origen === "horario") await avisar(userId, hechos);
      const mensaje = [`Rutina «${rutina.nombre}»:`, ...hechos.map((h, i) => `${i + 1}. ${h.paso}: ${NOMBRES[h.estado]}.${h.texto ? ` ${h.texto}` : ""}`)].join("\n");
      return { ok: true, pasos: hechos, mensaje };
    } finally { enMarcha.delete(userId); }
  }

  // Una ocasión atrasada no ejecuta nada ni pide permisos: solo se avisa, una vez. Sin nombres ni contenido.
  async function avisarAtrasada(userId, r, occ) {
    await audit?.log({ userId, action: "rutina.atrasada", detail: `id ${r.id}` });
    if ((await modoChat(userId)) || (await frenado(userId))) return;
    const body = `Atrasada: una rutina de ${cuando(occ, now(), r.horario.zona || zona)} no corrió porque yo estaba dormido. No ejecuté nada; si la quiere, diga «lanza la rutina ${r.id}».`;
    try { await getPush()?.notify(userId, { title: "Jarvis", body, tag: `jarvis-rutina-${r.id}` }); } catch (e) { console.error("[rutinas] push", e?.message); }
    try { await getNotify()?.(body); } catch (e) { console.error("[rutinas] telegram", e?.message); }
  }

  async function tick(userId) {
    if (userId == null) return;
    for (const r of await lista(userId)) {
      const t = now();
      if (!r.activa) continue;
      const ya = toca(r.horario, t, { ultima: r.ultima, desde: r.actualizado });
      const atrasada = ya ? null : perdida(r.horario, t, { ultima: r.ultima, desde: r.actualizado });
      if (!ya && atrasada == null) continue;
      // Reclamo atómico: dos tick a la vez no repiten la misma ocasión.
      const c = await run(db, "UPDATE rutinas SET ultima=? WHERE id=? AND user_id=? AND activa=1 AND ultima IS ?", [t, r.id, userId, r.ultima]);
      if (!c.changes) continue;
      if (atrasada != null) { await avisarAtrasada(userId, r, atrasada); continue; }
      const out = await ejecutar(userId, r, { origen: "horario" });
      if (!out.ok) await log(userId, "rutina.omitida", `id ${r.id}`);
    }
  }

  // El "sí" a un paso programado: se ejecuta ese paso, una vez, con las reglas de siempre.
  async function aprobado(userId, a) {
    const r = await una(userId, Number(a.kind.slice("rutina:".length)));
    if (!r?.activa || !r.pasos.includes(a.detail) || now() - a.created_at > VIGENCIA_PERMISO) return log(userId, "rutina.permiso_vencido", a.kind);
    if (await modoChat(userId)) return;
    const h = await darPaso(userId, a.detail, {});
    await log(userId, "rutina.paso", `id ${r.id} ${h.estado}`);
    await avisar(userId, [h]);
  }
  bus?.on("approval.resolved", ({ userId, approval }) => {
    if (approval?.status !== "aprobada" || !/^rutina:\d+$/.test(approval.kind || "")) return;
    const p = aprobado(userId, approval).catch((e) => console.error("[rutinas]", e?.message)).finally(() => pendientes.delete(p));
    pendientes.add(p);
  });

  // Enganche del chat (docs/CONTROL.md).
  async function intent({ userId, conversationId, text, flagPrivate = false, chatSolo = false, source, deviceId = null }) {
    const t = limpia(text);
    if (!t) return null;
    const nueva = parseCrear(text);
    const orden = ORDEN.exec(t);
    const listar = LISTAR.test(t);
    const todas = await lista(userId);
    const porFrase = todas.find((r) => r.frase && limpia(r.frase) === t);
    if (!nueva && !orden && !listar && !porFrase) return null;
    const out = (reply) => ({ status: "rutina", reply });
    if (source === SOURCE) return out("Una rutina no puede crear ni lanzar otra, señor.");
    if (chatSolo) return out(MSG_CHAT);
    if (flagPrivate) return out("Las rutinas no admiten mensajes privados, señor.");
    try {
      if (nueva) {
        const r = await crear(userId, nueva);
        const como = [r.horario ? textoHorario(r.horario) : null, r.frase ? `cuando diga «${r.frase}»` : null].filter(Boolean).join(" y ") || `cuando diga «lanza la rutina ${r.nombre}»`;
        return out(`Rutina «${r.nombre}» creada, señor: ${como}. Pasos: ${r.pasos.join("; ")}.${r.horario ? " A su hora, antes de cambiar algo le pediré permiso." : ""}`);
      }
      if (listar) {
        return out(todas.length ? `Sus rutinas, señor:\n${todas.map((r) => `${r.id}. ${r.nombre} (${textoHorario(r.horario)}${r.activa ? "" : ", pausada"})`).join("\n")}` : "No tiene rutinas, señor.");
      }
      let r = porFrase, verbo = "lanza";
      if (!r) {
        const [, v, quien] = orden;
        verbo = v;
        r = todas.find((x) => String(x.id) === quien || limpia(x.nombre) === quien || (x.frase && limpia(x.frase) === quien));
        if (!r) return out("No encuentro esa rutina, señor. Dígame «mis rutinas» para verlas.");
      }
      if (verbo === "borra" || verbo === "elimina") { await borrar(userId, r.id); return out(`Borré la rutina «${r.nombre}», señor.`); }
      if (["pausa", "desactiva", "reanuda", "activa"].includes(verbo)) {
        const activa = verbo === "reanuda" || verbo === "activa";
        await cambiar(userId, r.id, { activa });
        return out(`Rutina «${r.nombre}» ${activa ? "activada" : "en pausa"}, señor.`);
      }
      if (!r.activa) return out(`La rutina «${r.nombre}» está en pausa, señor.`);
      return out((await ejecutar(userId, r, { origen: porFrase ? "frase" : "chat", conversationId, deviceId })).mensaje);
    } catch (e) {
      if (!e?.error) throw e;
      return out(e.mensaje);
    }
  }

  const wrap = (fn) => async (req, res, next) => {
    try { await fn(req, res, Number(req.user.id)); }
    catch (e) { if (e?.error) res.status(e.status || 400).json({ error: e.error, mensaje: e.mensaje }); else next(e); }
  };
  const body = (req) => (req.body && typeof req.body === "object" ? req.body : {});

  return {
    crear, cambiar, borrar, lista, ejecutar, tick, intent,
    esperar: () => Promise.all([...pendientes]),
    // /api/rutinas (solo sesión web)
    routes() {
      const r = Router();
      r.use(express.json({ limit: "8kb" }));
      const existe = async (uid, id) => { const x = await una(uid, Number(id)); if (!x) throw err(404, "no_encontrada", "No encuentro esa rutina, señor."); return x; };
      r.get("/", wrap(async (req, res, uid) => res.json({ zona: zonaDef, rutinas: (await lista(uid)).map((x) => ({ ...x, cuando: textoHorario(x.horario) })) })));
      r.post("/", wrap(async (req, res, uid) => res.status(201).json({ rutina: await crear(uid, body(req)) })));
      r.patch("/:id", wrap(async (req, res, uid) => res.json({ rutina: await cambiar(uid, Number(req.params.id), body(req)) })));
      r.delete("/:id", wrap(async (req, res, uid) => { await existe(uid, req.params.id); await borrar(uid, Number(req.params.id)); res.json({ ok: true }); }));
      r.post("/:id/probar", wrap(async (req, res, uid) => res.json(await ejecutar(uid, await existe(uid, req.params.id), { origen: "probar", deviceId: req.device?.id ?? null }))));
      return r;
    },
  };
}
