import test from "node:test";
import assert from "node:assert/strict";
import { memDb, clock } from "./helpers.js";
import { buildContext } from "../server/context.js";
import { all, run } from "../server/db/client.js";
import { instante, local } from "../server/funciones/comun.js";
import { parseRecordatorio } from "../server/funciones/recordatorios.js";
import { parseNotas, necesaria, promedio } from "../server/funciones/notas.js";
import { parseComuna } from "../server/funciones/clima.js";
import { esBuenosDias } from "../server/funciones/index.js";
import { perdida } from "../server/rutinas.js";

const Z = "America/Santiago";
const AHORA = Date.UTC(2026, 10, 6, 21, 0, 0); // viernes 6 nov 2026, 18:00 en Santiago
const dicho = (t) => { const a = local(t, Z); return `${a.dia} ${String(a.h).padStart(2, "0")}:${String(a.min).padStart(2, "0")}`; };
const rec = (frase, ahora = AHORA) => parseRecordatorio(frase, ahora, Z);

test("recordatorios: fechas y horas habladas", () => {
  const casos = [
    ["recuérdame el jueves a las 5 llevar el libro", "2026-11-12 17:00", "llevar el libro"],
    ["Jarvis, recuérdame mañana a las 8 estudiar historia", "2026-11-07 08:00", "estudiar historia"],
    ["recuérdame en 20 minutos sacar la ropa", "2026-11-06 18:20", "sacar la ropa"],
    ["recuérdame el 3 de diciembre pagar la cuota", "2026-12-03 08:00", "pagar la cuota"],
    ["recuérdame a las 7 llamar a la abuela", "2026-11-06 19:00", "llamar a la abuela"],
    ["recuérdame a las 5 regar", "2026-11-07 17:00", "regar"],
    ["mañana a las 8 y media recuérdame que lleve el uniforme", "2026-11-07 08:30", "lleve el uniforme"],
    ["recuérdame llamar a Pedro el viernes a las 9 de la noche", "2026-11-06 21:00", "llamar a Pedro"],
    ["recuérdame el 2 de enero a las 17:15 volver", "2027-01-02 17:15", "volver"],
  ];
  for (const [frase, cuando, que] of casos) {
    const r = rec(frase);
    assert.equal(r?.op, "crear", frase);
    assert.deepEqual([dicho(r.due), r.que], [cuando, que], frase);
  }
  assert.equal(rec("recuérdame llevar el libro").op, "sin_hora");
  assert.equal(rec("recuérdame el 31 de febrero ir").op, "error");
  assert.equal(rec("recuérdame hoy a las 9 de la mañana ir").op, "error");
});

test("recordatorios: cambio de hora de Chile", () => {
  // Verano (UTC-3) e invierno (UTC-4).
  assert.equal(instante("2026-11-06", 8, 0, Z), Date.UTC(2026, 10, 6, 11));
  assert.equal(instante("2026-06-06", 8, 0, Z), Date.UTC(2026, 5, 6, 12));
  // "mañana a las 8" conserva las 8 locales aunque esa noche cambie la hora.
  for (const dia of ["2026-04-04", "2026-09-05"]) {
    const r = rec("recuérdame mañana a las 8 ir", instante(dia, 12, 0, Z));
    assert.equal(local(r.due, Z).h, 8, dia);
  }
  const t = instante("2026-09-06", 0, 30, Z); // esa hora no existe: se corre hacia adelante
  assert.equal(local(t, Z).h, 1);
});

test("recordatorios, notas, comuna y saludo: sin falsos positivos", () => {
  for (const f of [
    "recuérdame cómo se calcula el área de un círculo", "recuérdame qué dijo Newton", "recuérdame la fórmula del agua",
    "avísame si llueve mañana", "recuérdame en 5 minutos en el pc", "me recuerdas a mi profesor", "borra el archivo de recordatorios",
    "¿qué es un recordatorio?", "el jueves a las 5 tengo dentista",
  ]) assert.equal(rec(f), null, f);
  for (const f of [
    "me saqué un 7 en el juego", "me saqué un 10 en la prueba", "me saqué una foto", "me saqué un peso de encima",
    "cuál es el promedio de lluvia en Chile", "cuánto necesito para un viaje", "cuánto necesito para tener 6 hijos",
    "borra la última canción", "mis notas de voz suenan raras", "anota una nota: comprar pan",
    "cuánto necesito en la próxima para tener un 6 en el dado",
  ]) assert.equal(parseNotas(f), null, f);
  for (const f of ["mi comuna es muy bonita", "cuál es mi comuna"]) assert.equal(parseComuna(f), null, f);
  for (const f of ["buenos días, ¿cómo se dice en inglés?", "di buenos días en francés"]) assert.equal(esBuenosDias(f), false, f);
  for (const f of ["Buenos días, Jarvis", "buenos dias", "Jarvis, buenos días"]) assert.equal(esBuenosDias(f), true, f);
});

test("notas: frases y cálculos", () => {
  assert.deepEqual(parseNotas("me saqué un 5,8 en mate"), { op: "poner", nota: 5.8, materia: "Matemáticas", peso: null });
  assert.deepEqual(parseNotas("me saqué un cinco coma ocho en lenguaje que vale 30%"), { op: "poner", nota: 5.8, materia: "Lenguaje", peso: 30 });
  assert.equal(parseNotas("¿Cuál es mi promedio de mate?").materia, "Matemáticas");
  assert.equal(parseNotas("¿cuál es mi promedio?").op, "promedio");
  assert.deepEqual(parseNotas("¿cuánto necesito en la próxima para promediar 6?"), { op: "necesito", meta: 6, materia: null, peso: null });
  const l = [{ nota: 5, peso: null }, { nota: 6, peso: null }];
  assert.equal(promedio(l), 5.5);
  assert.equal(necesaria(l, 6).nota, 7); // (5+6+7)/3 = 6,0
  assert.equal(promedio([{ nota: 4, peso: 25 }, { nota: 6, peso: 75 }]), 5.5);
});

const SEMANA_LIBRE = { current: { temperature_2m: 18.4 }, daily: { weather_code: [0], temperature_2m_max: [25.2], temperature_2m_min: [11.7], precipitation_probability_max: [0] } };
async function levantar() {
  const reloj = clock(AHORA), pushes = [], urls = [];
  const { db } = await memDb();
  const fetch = async (url) => {
    urls.push(String(url));
    const body = String(url).includes("geocoding") ? { results: [{ latitude: -33, longitude: -70 }] }
      : String(url).includes("forecast") ? SEMANA_LIBRE : null;
    if (!body) throw new Error("sin red en pruebas");
    return { ok: true, status: 200, json: async () => body };
  };
  const webpush = { generateVAPIDKeys: () => ({ publicKey: "p", privateKey: "s" }), async sendNotification(_s, p) { pushes.push(JSON.parse(p)); } };
  const ctx = await buildContext({ db, env: { OWNER_PASSWORD: "prueba-123" }, now: reloj, webpush, fetch, providers: [] });
  await ctx.push.subscribe(ctx.ownerId, null, { endpoint: "https://push.invalid/x", keys: { p256dh: "a", auth: "b" } });
  return { ctx, db, reloj, pushes, urls, decir: (text, source) => ctx.chat.handle({ userId: ctx.ownerId, text, source }) };
}

test("por el chat: buenos días, recordatorios y notas sin modelo y en privado", async () => {
  const { db, decir, urls } = await levantar();
  assert.match((await decir("Buenos días, Jarvis")).reply, /mi comuna es.*Classroom.*Sin recordatorios/);
  assert.match((await decir("mi comuna es Valdivia")).reply, /Guardado/);
  assert.match((await decir("recuérdame hoy a las 9 de la noche llevar el libro")).reply, /hoy a las 21:00.*llevar el libro/);
  const r = await decir("Buenos días, Jarvis", "atajo");
  assert.match(r.reply, /Valdivia.*despejado.*21:00, llevar el libro/);
  assert.equal(r.private, true);
  assert.ok(urls.every((u) => /open-meteo\.com/.test(u)), urls.join(" "));
  assert.match((await decir("mis recordatorios")).reply, /1\. llevar el libro/);
  assert.match((await decir("borra el recordatorio 1")).reply, /Borré/);
  assert.match((await decir("mis recordatorios")).reply, /No tiene/);

  assert.match((await decir("me saqué un 5,0 en mate")).reply, /Promedio: 5,0/);
  assert.match((await decir("me saqué un 6,0 en matemáticas")).reply, /Promedio: 5,5/);
  assert.match((await decir("cuánto necesito en la próxima para promediar 6")).reply, /necesita un 7,0/);
  assert.match((await decir("corrige la última nota a 7,0")).reply, /de 6,0 a 7,0/);
  assert.match((await decir("borra la última nota")).reply, /7,0/);
  assert.match((await decir("¿cuál es mi promedio?")).reply, /Matemáticas 5,0/);
  const msgs = await all(db, "SELECT private FROM messages");
  assert.ok(msgs.length && msgs.every((m) => Number(m.private) === 1));
});

test("recordatorio atrasado: se entrega una sola vez y marcado", async () => {
  const { ctx, db, reloj, pushes } = await levantar();
  await run(db, "INSERT INTO reminders (user_id, text, due_at, created_at) VALUES (?,?,?,?)", [ctx.ownerId, "llevar el libro", AHORA + 60_000, AHORA]);
  assert.equal(await ctx.cron.recordatorios(), 0);
  reloj.advance(45 * 60_000);
  const [a, b] = await Promise.all([ctx.cron.recordatorios(), ctx.cron.recordatorios()]);
  assert.deepEqual([a, b], [1, 1]); // es la misma entrega
  assert.equal(await ctx.cron.recordatorios(), 0);
  assert.equal(pushes.length, 1);
  assert.match(pushes[0].title, /atrasado/);
});

test("rutina atrasada: solo avisa, una vez, sin ejecutar", async () => {
  const h = { dias: [5], hora: "18:00", zona: Z };
  assert.equal(perdida(h, AHORA + 5 * 60_000), null);
  assert.equal(perdida(h, AHORA + 60 * 60_000), AHORA);
  assert.equal(perdida(h, AHORA + 60 * 60_000, { ultima: AHORA + 1000 }), null);
  assert.equal(perdida(h, AHORA + 60 * 60_000, { desde: AHORA + 120_000 }), null);
});

test("tick de rutinas: la atrasada avisa una vez y no ejecuta", async () => {
  const { ctx, db, reloj, pushes } = await levantar();
  await ctx.rutinas.crear(ctx.ownerId, { nombre: "tarde", pasos: ["mis recordatorios"], horario: { dias: [5], hora: "19:00", zona: Z } });
  reloj.advance(3 * 3_600_000);
  await ctx.rutinas.tick(ctx.ownerId);
  await ctx.rutinas.tick(ctx.ownerId);
  assert.equal(pushes.length, 1);
  assert.match(pushes[0].body, /Atrasada.*No ejecuté nada/);
  assert.equal((await all(db, "SELECT id FROM messages")).length, 0);
});
