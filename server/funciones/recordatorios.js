// Recordatorios hablando normal, sin modelo. Usa la tabla `reminders`; el aviso lo entrega server/cron.js.
import { all, run } from "../db/client.js";
import { limpiar, local, instante, sumarDias, diaSemana, cuando, plegar, MESES, DIAS } from "./comun.js";

const NUM = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, quince: 15, veinte: 20, veinticinco: 25, treinta: 30, cuarenta: 40, cincuenta: 50 };
const PALABRAS = Object.keys(NUM).sort((a, b) => b.length - a.length).join("|");
const num = (s) => NUM[s] ?? Number(s);
const SEMANA = DIAS.map(plegar);
const MES = `${MESES.join("|")}|setiembre`;

const RELATIVO = new RegExp(`\\b(?:en|dentro de)(?: unos| unas)? (?:(media hora)|(\\d{1,4}|${PALABRAS}) (minutos?|min|horas?|dias?|semanas?)( y media)?)\\b`);
const HORA = new RegExp(`\\b(?:a eso de )?a (?:la|las) (\\d{1,2}|${PALABRAS})(?:[:.h](\\d{2}))?(?: y (media|cuarto|\\d{1,2})\\b| (menos cuarto)\\b)?(?: ?(?:hrs?|horas)\\b)?(?: (?:de|en|por) la (manana|tarde|noche|madrugada)\\b| ?(a\\.? ?m\\b\\.?|p\\.? ?m\\b\\.?))?`);
const MEDIODIA = /\b(?:a|al) (mediodia|medio dia|medianoche)\b/;
const TRAMO = /\b(?:(?:en|por|durante) la (manana|tarde|noche)|esta (manana|tarde|noche))\b/;
const FECHA = new RegExp(`\\b(?:(?:el|para el|este) )?(?:(?:${SEMANA.join("|")}),? )?(?:el )?(\\d{1,2}) de (${MES})(?: (?:de|del) (\\d{4}))?\\b`);
const FECHA_NUM = /\b(?:el|para el) (\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}))?\b/;
const FECHA_DIA = /\b(?:el|para el) dia (\d{1,2})\b/;
const RELDIA = /\b(?:para )?(pasado manana|manana|hoy)\b/;
const DIASEM = new RegExp(`(?:^|\\b(?:el|este|para el|el proximo|proximo) )(?:(proximo) )?(${SEMANA.join("|")})\\b(?: (que viene|proximo))?`);

// Hora sin am/pm: de 1 a 6 se entiende la tarde; de 7 a 10, la mañana o la noche, lo que venga antes.
function candidatas(h, franja) {
  if (franja === "tarde" || franja === "noche" || franja === "pm") return [h < 12 ? h + 12 : h];
  if (franja === "manana" || franja === "madrugada" || franja === "am") return [h === 12 ? 0 : h];
  if (h >= 1 && h <= 6) return [h + 12];
  if (h >= 7 && h <= 10) return [h, h + 12];
  return [h];
}

// Busca la expresión de tiempo. Devuelve { due, resto } | { error, resto } | null (no hay ninguna).
export function leerCuando(orig, ahora, zona) {
  let p = plegar(orig), o = orig;
  const quita = (re) => {
    const m = re.exec(p);
    if (!m) return null;
    const hueco = " ".repeat(m[0].length);
    p = p.slice(0, m.index) + hueco + p.slice(m.index + m[0].length);
    o = o.slice(0, m.index) + hueco + o.slice(m.index + m[0].length);
    return m;
  };
  const resto = () => o.replace(/\s+/g, " ").trim();

  const rel = quita(RELATIVO);
  if (rel) {
    const u = rel[3] || "", n = rel[1] ? 30 : num(rel[2]);
    const base = rel[1] || u.startsWith("min") ? 1 : u.startsWith("hora") ? 60 : u.startsWith("dia") ? 1440 : 10080;
    const min = n * base + (rel[4] ? base / 2 : 0);
    if (!min || min > 525_600) return { error: "Ese plazo no me sirve, señor.", resto: resto() };
    // Días y semanas conservan la hora local aunque cambie la hora oficial.
    if (base >= 1440) {
      const a = local(ahora, zona);
      return { due: instante(sumarDias(a.dia, Math.round(min / 1440)), a.h, a.min, zona), resto: resto() };
    }
    return { due: ahora + min * 60_000, resto: resto() };
  }

  const hm = quita(HORA);
  const medio = hm ? null : quita(MEDIODIA);
  const tramo = quita(TRAMO);
  const hoy = local(ahora, zona).dia;
  let dia = null, modo = null, m;
  const armar = (d, mes, anio) => {
    let y = anio ? +anio : +hoy.slice(0, 4);
    const iso = () => `${y}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const existe = () => { const t = new Date(`${iso()}T00:00:00Z`); return !Number.isNaN(t.getTime()) && t.getUTCDate() === +d; };
    if (!anio && existe() && iso() < hoy) y++;
    return existe() ? iso() : "mala";
  };
  if ((m = quita(FECHA))) [dia, modo] = [armar(+m[1], MESES.indexOf(m[2] === "setiembre" ? "septiembre" : m[2]) + 1, m[3]), "fecha"];
  else if ((m = quita(FECHA_NUM))) [dia, modo] = [armar(+m[1], +m[2], m[3]), "fecha"];
  else if ((m = quita(FECHA_DIA))) {
    let mes = +hoy.slice(5, 7), anio = +hoy.slice(0, 4);
    if (+m[1] < +hoy.slice(8)) { mes++; if (mes > 12) { mes = 1; anio++; } }
    [dia, modo] = [armar(+m[1], mes, anio), "fecha"];
  } else if ((m = quita(RELDIA))) [dia, modo] = [sumarDias(hoy, m[1] === "hoy" ? 0 : m[1] === "manana" ? 1 : 2), m[1] === "hoy" ? "hoy" : "fecha"];
  else if ((m = quita(DIASEM))) {
    let n = (SEMANA.indexOf(m[2]) - diaSemana(hoy) + 7) % 7;
    if (!n && (m[1] || m[3])) n = 7;
    [dia, modo] = [sumarDias(hoy, n), n ? "fecha" : "semana"];
  }
  if (!dia && tramo?.[2]) [dia, modo] = [hoy, "hoy"];
  if (!hm && !medio && !dia && !tramo) return null;
  if (dia === "mala") return { error: "Esa fecha no existe, señor.", resto: resto() };

  const franja = tramo?.[1] || tramo?.[2] || null;
  let horas, min = 0;
  if (hm) {
    let h = num(hm[1]);
    min = hm[2] ? +hm[2] : hm[3] === "media" ? 30 : hm[3] === "cuarto" ? 15 : hm[3] ? +hm[3] : 0;
    if (hm[4]) { h = h === 1 ? 12 : h - 1; min = 45; }
    if (h > 23 || min > 59) return { error: "Esa hora no existe, señor.", resto: resto() };
    const f = hm[5] || (hm[6] ? hm[6].replace(/[^apm]/g, "") : franja);
    if (f === "noche" && h === 12) { horas = [0]; if (!dia || modo === "hoy") dia = sumarDias(hoy, 1); }
    else horas = candidatas(h, f);
  } else if (medio) horas = [medio[1] === "medianoche" ? 0 : 12];
  else horas = [franja === "tarde" ? 16 : franja === "noche" ? 21 : dia === hoy && !franja ? 18 : 8];

  const elegir = (d) => horas.map((h) => instante(d, h, min, zona)).find((t) => t > ahora) ?? null;
  let due = elegir(dia || hoy);
  if (due == null && !dia) due = instante(sumarDias(hoy, 1), horas[0], min, zona);
  else if (due == null && modo === "semana") due = elegir(sumarDias(dia, 7));
  if (due == null) return { error: "Esa hora ya pasó, señor.", resto: resto() };
  return { due, resto: resto() };
}

const PEDIR = /^(?:(?:puedes|podrias) )?(?:recuerdame|recordarme|me (?:puedes |podrias )?(?:recuerdas|recordar)|avisame|(?:pon(?:me)?|crea(?:me)?|agrega(?:me)?|anota(?:me)?) (?:un )?(?:recordatorio|aviso)(?: para)?)\b[\s,:]*/;
const TRAS_TIEMPO = /^(.{3,60}?)[\s,]+(?:recuerdame|avisame)\b[\s,:]*/;
// "recuérdame cómo se hace" es una pregunta, no un recordatorio (con tilde en el original).
const PREGUNTA_ORIG = /^(?:qué|cómo|quién|quiénes|cuál|cuáles|cuándo|dónde|cuánto|cuánta|cuántos|cuántas|por qué)(?![\p{L}])/iu;
const PREGUNTA = /^(?:como|quien(?:es)?|cual(?:es)?|cuando|donde|cuant[oa]s?|por ?que|si|lo (?:que|de)|que (?:es|era|fue|paso|son|significa|dijo|dije|hicimos|habia))\b/;
// Sin hora solo se responde si claramente es un quehacer.
const QUEHACER = /^(?:que )?(?:tengo que |debo |hay que )?(?:llevar|traer|llamar|comprar|entregar|estudiar|hacer|sacar|enviar|mandar|pagar|devolver|imprimir|firmar|ir|tomar|terminar|avisar|preparar|regar|guardar|cargar|pedir)(?:le|lo|la|me)?\b/;
// Los avisos en el PC o el teléfono son de otros módulos.
const APARATO = /\b(?:en|al) (?:el |mi )?(?:pc|computador|computadora|ordenador|iphone|telefono|celular)$/;

const LISTAR = /^(?:(?:lista|listame|muestra|muestrame|ver|dime|leeme)(?: (?:mis|los|todos mis))? recordatorios|(?:que|cuales) (?:recordatorios (?:tengo|hay)|son mis recordatorios)|mis recordatorios|tengo recordatorios)(?: (?:para )?(hoy|manana))?(?: pendientes)?$/;
const BORRAR = /^(?:borra|borrar|elimina|eliminar|quita|cancela) (?:(todos)(?: (?:mis|los))? recordatorios|(?:(?:el|mi) )?(ultimo )?recordatorio(?: (?:numero |n )?(\d{1,2})| (?:de |del |para |sobre )(.+))?)$/;

// { op: "crear"|"sin_hora"|"error"|"listar"|"borrar", ... } o null.
export function parseRecordatorio(text, ahora, zona) {
  const { orig, p } = limpiar(text);
  if (!orig || orig.length > 300) return null;
  let m = LISTAR.exec(p);
  if (m) return { op: "listar", dia: m[1] || null };
  if ((m = BORRAR.exec(p))) return { op: "borrar", todos: !!m[1], ultimo: !!m[2], n: m[3] ? +m[3] : null, que: m[4] ? orig.slice(orig.length - m[4].length) : null };

  let cuerpo;
  if ((m = PEDIR.exec(p))) cuerpo = orig.slice(m[0].length);
  else if ((m = TRAS_TIEMPO.exec(p))) {
    // "mañana a las 8 recuérdame ...": lo de delante debe ser solo tiempo.
    const antes = leerCuando(orig.slice(0, m[1].length), ahora, zona);
    if (!antes || antes.resto) return null;
    cuerpo = `${orig.slice(0, m[1].length)} ${orig.slice(m[0].length)}`;
  } else return null;
  const pc = plegar(cuerpo);
  if (PREGUNTA_ORIG.test(cuerpo) || PREGUNTA.test(pc) || APARATO.test(pc)) return null;
  const c = leerCuando(cuerpo, ahora, zona);
  const que = (s) => {
    let t = s.replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, "");
    for (let i = 0; i < 2; i++) t = t.slice(/^(?:(?:que|de que|de|para|y) (?=\S))?/.exec(plegar(t))[0].length);
    return t.trim().slice(0, 200);
  };
  if (!c) return QUEHACER.test(pc) ? { op: "sin_hora", que: que(cuerpo) } : null;
  if (c.error) return { op: "error", mensaje: c.error };
  return { op: "crear", due: c.due, que: que(c.resto) };
}

export function createRecordatorios({ db, audit = null, zona, now }) {
  const pendientes = (userId) => all(db, "SELECT id, text, due_at FROM reminders WHERE user_id=? AND done=0 ORDER BY due_at, id", [userId]);
  const linea = (r, i) => `${i + 1}. ${r.text} (${cuando(Number(r.due_at), now(), zona)}${Number(r.due_at) < now() ? ", atrasado" : ""})`;

  async function atender(userId, i) {
    if (i.op === "error") return `${i.mensaje} Dígame, por ejemplo, «recuérdame mañana a las 8 llevar el libro».`;
    if (i.op === "sin_hora") return `¿Cuándo se lo recuerdo, señor? Repítalo con la hora, por ejemplo: «recuérdame mañana a las 8 ${i.que}».`;
    if (i.op === "crear") {
      if (!i.que) return "¿Qué quiere que le recuerde, señor? Dígalo todo junto, por ejemplo: «recuérdame mañana a las 8 llevar el libro».";
      await run(db, "INSERT INTO reminders (user_id, text, due_at, created_at) VALUES (?,?,?,?)", [userId, i.que, i.due, now()]);
      await audit?.log({ userId, action: "recordatorio.creado", detail: "" });
      return `Anotado, señor: ${cuando(i.due, now(), zona)} le recuerdo «${i.que}».`;
    }
    let lista = await pendientes(userId);
    if (i.op === "listar") {
      if (i.dia) {
        const d = i.dia === "hoy" ? local(now(), zona).dia : sumarDias(local(now(), zona).dia, 1);
        lista = lista.filter((r) => local(Number(r.due_at), zona).dia === d);
      }
      if (!lista.length) return `No tiene recordatorios pendientes${i.dia ? ` para ${i.dia === "hoy" ? "hoy" : "mañana"}` : ""}, señor.`;
      return `Sus recordatorios, señor:\n${lista.slice(0, 10).map(linea).join("\n")}${lista.length > 10 ? `\nY ${lista.length - 10} más.` : ""}`;
    }
    if (!lista.length) return "No tiene recordatorios pendientes, señor.";
    let fuera;
    if (i.todos) fuera = lista;
    else if (i.ultimo) fuera = [lista.reduce((a, b) => (Number(b.id) > Number(a.id) ? b : a))];
    else if (i.n) fuera = lista[i.n - 1] ? [lista[i.n - 1]] : [];
    else if (i.que) fuera = lista.filter((r) => plegar(r.text).includes(plegar(i.que)));
    else fuera = lista.length === 1 ? lista : [];
    if (!fuera.length) return "No sé cuál borrar, señor. Diga «mis recordatorios» y luego «borra el recordatorio 2».";
    if (fuera.length > 1 && !i.todos) return "Hay varios que coinciden, señor. Diga «mis recordatorios» y borre por número.";
    for (const r of fuera) await run(db, "DELETE FROM reminders WHERE id=? AND user_id=?", [r.id, userId]);
    await audit?.log({ userId, action: "recordatorio.borrado", detail: `${fuera.length}` });
    return i.todos ? `Borré ${fuera.length} recordatorios, señor.` : `Borré el recordatorio «${fuera[0].text}», señor.`;
  }
  return { atender, pendientes };
}
