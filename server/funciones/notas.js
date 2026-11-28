// Notas del colegio (escala 1,0 a 7,0) y promedios, sin modelo. Se guardan en la tabla `calificaciones`.
import { all, run } from "../db/client.js";
import { limpiar, plegar } from "./comun.js";

const RAMOS = [
  ["Matemáticas", /^(?:mate|mates|matematicas?)$/], ["Lenguaje", /^(?:lenguaje|lengua(?: y literatura)?|literatura|castellano)$/],
  ["Historia", /^historia$/], ["Inglés", /^(?:ingles|english)$/], ["Física", /^fisica$/], ["Química", /^quimica$/], ["Biología", /^(?:biologia|bio)$/],
  ["Ciencias", /^ciencias(?: naturales)?$/], ["Filosofía", /^(?:filosofia|filo)$/], ["Música", /^musica$/], ["Artes", /^artes?(?: visuales)?$/],
  ["Educación Física", /^(?:educacion fisica|ed fisica)$/], ["Tecnología", /^(?:tecnologia|tecno)$/], ["Religión", /^religion$/], ["Francés", /^frances$/],
  ["Alemán", /^aleman$/], ["Economía", /^economia$/], ["Orientación", /^orientacion$/], ["Computación", /^(?:computacion|informatica)$/],
];
const NUM = { cero: 0, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9 };
const NOTA = "(\\d{1,2}(?:[,.]\\d{1,2})?|uno|dos|tres|cuatro|cinco|seis|siete)(?: (?:coma|punto) (\\d|cero|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve))?";
const PESO = "(?:,? (?:(?:que )?(?:vale|valia|pondera|ponderaba)(?: (?:un|el))?|con(?: (?:un|el))?(?: ponderacion(?: del?)?)?|al|ponderado al|de ponderacion) (\\d{1,3}) ?(?:%|por ciento))?";

const raiz = (s) => plegar(s).trim().replace(/^(?:el |la |ramo (?:de )?)/, "");
const canon = (s) => RAMOS.find(([, re]) => re.test(raiz(s)))?.[0] ?? null;
const bonito = (s) => canon(s) ?? s.trim().replace(/^./, (c) => c.toUpperCase());
export const fmt = (n) => n.toFixed(1).replace(".", ",");
const redondear = (n) => Math.round(n * 10 + 1e-7) / 10;

// "5,8", "cinco coma ocho" o "58" -> 5.8; null si no es una nota de 1,0 a 7,0.
function valor(a, b) {
  let s = String(NUM[a] ?? a).replace(",", ".");
  if (b != null) s = `${s}.${NUM[b] ?? b}`;
  let n = Number(s);
  if (/^\d\d$/.test(s) && n > 10) n /= 10;
  return n >= 1 && n <= 7 ? n : null;
}
const decimal = (a, b) => b != null || /[,.]/.test(a);

const DE = "(?:(?: en| de| para)(?: (?:el|la))?(?: (?:ramo|asignatura|prueba|control|trabajo|examen|disertacion|certamen|interrogacion)(?: (?:de|en)(?: (?:el|la))?)?)? ([a-z][a-z ]{0,40}?))?";
const PONER = new RegExp(`^(?:(?:(?:hoy |ayer )?(?:me )?saque|me pusieron|me fue con)(?: un| una)?|(?:anota|anotame|agrega|agregame|registra|guarda)(?: (?:un|una|la))?(?: nota(?: de)?)?) ${NOTA}${DE}( de nota)?${PESO}$`);
const PROMEDIO = /^(?:(?:cual es|cuanto es|como va|dime|dame|calcula|calculame) )?(?:mi promedio|mis promedios|el promedio de mis notas)(?: (?:general|de notas|actual))?(?: (?:en|de)(?: (?:el|la))? (.+?))?$|^(?:que|cuanto) (?:promedio (?:tengo|llevo)|(?:tengo|llevo) de promedio)(?: (?:en|de)(?: (?:el|la))? (.+?))?$/;
const NECESITO = new RegExp(`^(?:cuanto|que nota|cuanta nota) (?:necesito|me (?:falta|tengo que sacar)|tengo que sacar(?:me)?|debo sacar(?:me)?)(.*?) para (?:promediar|(?:tener|quedar con|llegar a|subir a|terminar con|dejar)(?: el| mi)?(?: promedio)?(?: (?:de|en|a))?|(pasar|aprobar))(?: un| una)?(?: ${NOTA})?(.*)$`);
const LISTAR = /^(?:(?:lista|listame|muestra|muestrame|ver|dime)(?: mis| las)? notas|mis notas|(?:que|cuales) (?:notas (?:tengo|llevo)|son mis notas))(?: (?:en|de)(?: (?:el|la))? (.+?))?$/;
const BORRAR = /^(?:borra|borrar|elimina|eliminar|quita) (?:la |mi )?ultima nota(?: (?:en|de)(?: (?:el|la))? (.+?))?$/;
const CORREGIR = new RegExp(`^(?:(?:corrige|corregir|cambia|cambiar) (?:la |mi )?ultima nota(?: (?:en|de)(?: (?:el|la))? (.+?))? (?:a|por)|(?:la |mi )?ultima nota (?:era|es|fue))(?: un| una)? ${NOTA}$`);

// conocidas = ramos que ya tienen notas (en minúsculas y sin tildes). null: la frase no es de notas.
export function parseNotas(text, conocidas = []) {
  const { orig, p } = limpiar(text);
  if (!orig || orig.length > 200) return null;
  const esRamo = (s) => !!s && (!!canon(s) || conocidas.includes(raiz(s)));
  // El ramo se toma del texto original para conservar tildes.
  const ramo = (s) => (s ? bonito(orig.slice(p.indexOf(s), p.indexOf(s) + s.length)) : null);
  let m;
  if ((m = BORRAR.exec(p))) return !m[1] || esRamo(m[1]) ? { op: "borrar", materia: ramo(m[1]) } : null;
  if ((m = CORREGIR.exec(p))) {
    const nota = valor(m[2], m[3]);
    return nota == null || (m[1] && !esRamo(m[1])) ? null : { op: "corregir", materia: ramo(m[1]), nota };
  }
  if ((m = LISTAR.exec(p))) return !m[1] || esRamo(m[1]) ? { op: "listar", materia: ramo(m[1]) } : null;
  if ((m = PROMEDIO.exec(p))) {
    const x = m[1] ?? m[2];
    return !x || esRamo(x) ? { op: "promedio", materia: ramo(x) } : null;
  }
  if ((m = NECESITO.exec(p))) {
    const [, medio, pasar, a, b, cola] = m;
    const meta = a ? valor(a, b) : pasar ? 4 : null;
    // Sin "promedio" ni "próxima/nota/prueba" no es de notas.
    if (meta == null || !/promedi|proxim|siguiente|prueba|nota/.test(p)) return null;
    const todo = `${medio} ${cola}`;
    const peso = /(\d{1,3}) ?(?:%|por ciento)/.exec(todo);
    const x = /\b(?:en|de) (?!(?:(?:el|la) )?(?:proxima|siguiente|prueba|nota)\b)(?:el |la )?([a-z]+(?: fisica| naturales| visuales| y literatura)?)/g;
    const dichos = [...todo.matchAll(x)].map((v) => v[1]);
    const dicho = dichos.find(esRamo);
    if (!dicho && dichos.length) return null;
    return { op: "necesito", meta, materia: ramo(dicho), peso: peso ? +peso[1] : null };
  }
  if ((m = PONER.exec(p))) {
    const [, a, b, materia, deNota, peso] = m;
    const nota = valor(a, b);
    if (nota == null) return null;
    const segura = decimal(a, b) || !!deNota || /\bnota\b/.test(p);
    if (!materia) return segura ? { op: "falta_ramo", nota } : null;
    // "me saqué un 7 en el juego" no es una nota.
    if (!esRamo(materia) && !(segura && materia.split(" ").length <= 3)) return null;
    if (peso != null && !(+peso > 0 && +peso <= 100)) return null;
    return { op: "poner", nota, materia: ramo(materia), peso: peso ? +peso : null };
  }
  return null;
}

// Con ponderaciones, las notas sin porcentaje se reparten lo que falta hasta 100.
function pesos(lista) {
  const con = lista.filter((x) => x.peso != null);
  if (!con.length) return lista.map((x) => ({ ...x, w: 1 }));
  const suma = con.reduce((s, x) => s + x.peso, 0);
  const sin = lista.length - con.length;
  const resto = sin ? Math.max(0, 100 - suma) / sin : 0;
  return lista.map((x) => ({ ...x, w: x.peso ?? resto }));
}
export function promedio(lista) {
  const l = pesos(lista), total = l.reduce((s, x) => s + x.w, 0);
  return total ? l.reduce((s, x) => s + x.nota * x.w, 0) / total : null;
}
// Nota que hace falta en la próxima para que el promedio llegue a `meta` sin contar con el redondeo.
export function necesaria(lista, meta, peso = null) {
  const ponderado = lista.some((x) => x.peso != null);
  const l = pesos(lista), total = l.reduce((s, x) => s + x.w, 0), suma = l.reduce((s, x) => s + x.nota * x.w, 0);
  let w = 1, supuesto = "";
  if (ponderado) {
    if (peso != null) w = peso;
    else if (total < 100) { w = 100 - total; supuesto = ` suponiendo que vale el ${w}% que falta`; }
    else return { falta_peso: true };
  } else if (peso != null) {
    if (!(peso < 100)) return { nota: meta, conMaxima: 7, supuesto };
    w = (total * peso) / (100 - peso);
  }
  const x = (meta * (total + w) - suma) / w;
  return { nota: Math.ceil(x * 10 - 1e-7) / 10, conMaxima: (suma + 7 * w) / (total + w), supuesto };
}

export function createNotas({ db, audit = null, now }) {
  const filas = async (userId) => (await all(db, "SELECT id, materia, nota, ponderacion FROM calificaciones WHERE user_id=? ORDER BY id", [userId]))
    .map((r) => ({ id: Number(r.id), materia: r.materia, nota: Number(r.nota), peso: r.ponderacion == null ? null : Number(r.ponderacion) }));
  const porRamo = (l) => l.reduce((m, x) => m.set(x.materia, [...(m.get(x.materia) || []), x]), new Map());
  const de = (l, materia) => l.filter((x) => plegar(x.materia) === plegar(materia));
  const item = (x) => `${fmt(x.nota)}${x.peso != null ? ` (${x.peso}%)` : ""}`;
  const prom = (l) => { const p = promedio(l); return p == null ? "sin calcular" : fmt(redondear(p)); };

  return {
    async intent(userId, text) {
      const todas = await filas(userId);
      const i = parseNotas(text, [...new Set(todas.map((x) => plegar(x.materia)))]);
      if (!i) return null;
      if (i.op === "falta_ramo") return `¿En qué ramo, señor? Dígame, por ejemplo, «me saqué un ${fmt(i.nota)} en mate».`;
      if (i.op === "poner") {
        await run(db, "INSERT INTO calificaciones (user_id, materia, nota, ponderacion, created_at) VALUES (?,?,?,?,?)", [userId, i.materia, i.nota, i.peso, now()]);
        await audit?.log({ userId, action: "nota.anotada", detail: "" });
        const l = de(await filas(userId), i.materia);
        return `Anotado, señor: ${fmt(i.nota)} en ${i.materia}${i.peso ? ` (${i.peso}%)` : ""}. Promedio: ${prom(l)}.`;
      }
      if (!todas.length) return "No tiene notas anotadas, señor. Dígame, por ejemplo, «me saqué un 5,8 en mate».";
      const lista = i.materia ? de(todas, i.materia) : todas;
      if (i.materia && !lista.length) return `No tengo notas de ${i.materia}, señor.`;
      if (i.op === "promedio") {
        if (i.materia) return `Su promedio de ${i.materia} es ${prom(lista)}, señor (${lista.length} ${lista.length === 1 ? "nota" : "notas"}).`;
        const ramos = [...porRamo(todas)];
        const vals = ramos.map(([, l]) => promedio(l)).filter((x) => x != null).map(redondear);
        const general = ramos.length > 1 && vals.length ? ` General: ${fmt(redondear(vals.reduce((a, b) => a + b, 0) / vals.length))}.` : "";
        return `Sus promedios, señor: ${ramos.map(([r, l]) => `${r} ${prom(l)}`).join("; ")}.${general}`;
      }
      if (i.op === "listar") return `Sus notas, señor:\n${[...porRamo(lista)].map(([r, l]) => `${r}: ${l.map(item).join("; ")}. Promedio ${prom(l)}.`).join("\n")}`;
      const ultima = lista.at(-1);
      if (i.op === "borrar") {
        await run(db, "DELETE FROM calificaciones WHERE id=? AND user_id=?", [ultima.id, userId]);
        await audit?.log({ userId, action: "nota.borrada", detail: "" });
        return `Borré la última nota, señor: ${fmt(ultima.nota)} en ${ultima.materia}.`;
      }
      if (i.op === "corregir") {
        await run(db, "UPDATE calificaciones SET nota=? WHERE id=? AND user_id=?", [i.nota, ultima.id, userId]);
        await audit?.log({ userId, action: "nota.corregida", detail: "" });
        return `Corregido, señor: ${ultima.materia}, de ${fmt(ultima.nota)} a ${fmt(i.nota)}.`;
      }
      const materia = i.materia ?? ultima.materia;
      const r = necesaria(de(todas, materia), i.meta, i.peso);
      if (r.falta_peso) return `Las ponderaciones de ${materia} ya suman 100%, señor. Dígame cuánto vale la próxima, por ejemplo «que vale 30%».`;
      if (r.nota > 7) return `En ${materia} no alcanza para ${fmt(i.meta)}, señor: ni con un 7,0 en la próxima (quedaría en ${fmt(redondear(r.conMaxima))}).`;
      if (r.nota <= 1) return `En ${materia}, señor, con cualquier nota en la próxima mantiene el ${fmt(i.meta)}.`;
      return `En ${materia} necesita un ${fmt(r.nota)} en la próxima para promediar ${fmt(i.meta)}, señor${r.supuesto}.`;
    },
  };
}
