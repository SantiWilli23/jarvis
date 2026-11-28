// Utilidades de las funciones sin modelo (docs/FUNCIONES.md): texto plegado y fechas en una zona horaria.
export const ZONA = "America/Santiago";
export const DIA = 86_400_000;

// Minúsculas y sin tildes, carácter a carácter: las posiciones siguen valiendo en el texto original.
export const plegar = (s) => String(s).split("").map((c) => c.normalize("NFD")[0].toLowerCase()[0]).join("");

const PREFIJO = /^[\s¿¡]*(?:(?:oye |hey )?jarvis\b[\s,.:;!]*)?(?:por favor\b[\s,]*|porfa\b[\s,]*)?/;
const SUFIJO = /(?:[\s,]+(?:por favor|porfa|jarvis))*[\s.!?]*$/;
// { orig, p }: la orden sin "Jarvis", "por favor" ni puntuación de los extremos; p es la misma cadena plegada.
export function limpiar(text) {
  let orig = String(text ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
  orig = orig.slice(PREFIJO.exec(plegar(orig))[0].length);
  orig = orig.slice(0, SUFIJO.exec(plegar(orig)).index);
  return { orig, p: plegar(orig) };
}

const fmt = new Map();
function partes(t, zona) {
  if (!fmt.has(zona)) fmt.set(zona, new Intl.DateTimeFormat("en-US", { timeZone: zona, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }));
  const p = Object.fromEntries(fmt.get(zona).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute };
}
const dos = (n) => String(n).padStart(2, "0");
// Instante -> fecha y hora locales.
export function local(t, zona = ZONA) {
  const a = partes(t, zona);
  return { dia: `${a.y}-${dos(a.m)}-${dos(a.d)}`, h: a.h, min: a.min };
}
export const sumarDias = (dia, n) => new Date(Date.parse(`${dia}T00:00:00Z`) + n * DIA).toISOString().slice(0, 10);
export const diaSemana = (dia) => new Date(`${dia}T00:00:00Z`).getUTCDay();

// Fecha y hora locales -> instante. Hora repetida (fin del horario de verano): la primera.
// Hora que no existe (comienzo): se corre hacia adelante lo que saltó el reloj.
export function instante(dia, h, min, zona = ZONA) {
  const ingenuo = Date.parse(`${dia}T${dos(h)}:${dos(min)}:00Z`);
  const desfase = (t) => { const a = partes(t, zona); return Date.UTC(a.y, a.m - 1, a.d, a.h, a.min) - t; };
  const antes = desfase(ingenuo - DIA);
  const validos = [antes, desfase(ingenuo + DIA)].map((o) => ingenuo - o).filter((t) => ingenuo - t === desfase(t));
  return validos.length ? Math.min(...validos) : ingenuo - antes;
}

export const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
export const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const fechaCorta = (dia) => `${DIAS[diaSemana(dia)]} ${+dia.slice(8)} de ${MESES[+dia.slice(5, 7) - 1]}`;
export const horaTexto = (h, min) => `${dos(h)}:${dos(min)}`;
// "hoy a las 17:00", "mañana ... a las 08:00", "el jueves 3 de diciembre a las 17:00".
export function cuando(t, ahora, zona = ZONA) {
  const a = local(t, zona), hoy = local(ahora, zona).dia;
  const dia = a.dia === hoy ? "hoy"
    : a.dia === sumarDias(hoy, 1) ? `mañana ${fechaCorta(a.dia)}`
      : `el ${fechaCorta(a.dia)}${a.dia.slice(0, 4) !== hoy.slice(0, 4) ? ` de ${a.dia.slice(0, 4)}` : ""}`;
  return `${dia} a las ${horaTexto(a.h, a.min)}`;
}
