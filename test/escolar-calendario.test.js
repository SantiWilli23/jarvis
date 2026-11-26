// Pruebas a Google Calendar (regla MDE). Datos inventados y fetch falso: sin red.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createDb } from "../server/db/client.js";
import { buildContext } from "../server/context.js";
import { createApp } from "../server/app.js";
import { createGoogle } from "../server/connectors/google.js";
import { proponer, leerFecha, parseCalendarioIntent } from "../server/escolar-calendario.js";
import { clock, spy } from "./helpers.js";

const HOY = "2026-01-01";
const prueba = (curso, fecha) => ({ curso, tipo: "evaluacion", titulo: "Unidad inventada", fecha, url: "", resumen: "" });
const json = (x) => ({ ok: true, status: 200, json: async () => x });

function googleFalso() {
  const g = { eventos: [], creados: [] };
  g.fetch = async (url, opts = {}) => {
    if (new URL(String(url)).hostname !== "www.googleapis.com") throw new Error("sin red");
    if (opts.method !== "POST") return json({ items: g.eventos });
    const e = JSON.parse(opts.body);
    g.creados.push(e);
    g.eventos.push(e);
    return json({ id: "x" });
  };
  return g;
}

test("regla MDE: 4 eventos, colores, hora o día completo, sin pasados ni repetidos", () => {
  const { eventos } = proponer([prueba("Matemáticas 8", "2026-01-10 10:15"), prueba("Matemática", "2026-01-10")], HOY);
  assert.deepEqual(eventos.map((e) => [e.titulo, e.inicio, e.fin, e.colorId]), [
    ["Repaso y Resumen - Matemáticas", "2026-01-07T17:00:00", "2026-01-07T18:00:00", "9"],
    ["Ejercitación - Matemáticas", "2026-01-08T17:00:00", "2026-01-08T18:00:00", "9"],
    ["Repaso Corto - Matemáticas", "2026-01-09T17:00:00", "2026-01-09T18:00:00", "9"],
    ["Matemáticas - Prueba", "2026-01-10T10:15:00", "2026-01-10T11:15:00", "9"],
  ]);
  const finales = proponer(["English", "Lengua y Literatura", "Historia", "Música"].map((c) => prueba(c, "2026-02-10")), HOY).eventos.filter((e) => e.titulo.endsWith("Prueba"));
  assert.deepEqual(Object.fromEntries(finales.map((e) => [e.titulo, e.colorId])), { "Inglés - Prueba": "5", "Lenguaje - Prueba": "11", "Historia - Prueba": "6", "Música - Prueba": undefined });
  assert.deepEqual([finales[0].inicio, finales[0].fin], ["2026-02-10", "2026-02-11"]);
  assert.deepEqual(proponer([prueba("Historia", "2026-01-02")], HOY).eventos.map((e) => e.titulo), ["Repaso Corto - Historia", "Historia - Prueba"]);
  const r = proponer([prueba("Historia", "2025-12-20"), prueba("Historia", ""), { ...prueba("Historia", "2026-02-01"), tipo: "anuncio", titulo: "Salida a terreno" }], HOY);
  assert.deepEqual(r, { eventos: [], sinFecha: 1 });
});

test("fechas en varios formatos", () => {
  assert.deepEqual(leerFecha("2026-03-05", HOY), { dia: "2026-03-05", hora: null });
  assert.deepEqual(leerFecha("2026-03-05T08:00", HOY), { dia: "2026-03-05", hora: "08:00" });
  assert.deepEqual(leerFecha("05/03 a las 9:30", HOY), { dia: "2026-03-05", hora: "09:30" });
  assert.deepEqual(leerFecha("jueves 5 de marzo de 2026, 2:00 p.m.", HOY), { dia: "2026-03-05", hora: "14:00" });
  assert.equal(leerFecha("5 de enero", "2026-12-20").dia, "2027-01-05");
  for (const f of ["", "mañana", "2026-02-31"]) assert.equal(leerFecha(f, HOY), null, f);
});

test("frases: crear, solo ver y nada más", () => {
  for (const t of ["pon mis pruebas en el calendario", "Jarvis, agrega las evaluaciones a Google Calendar por favor", "anota en mi calendario mis pruebas", "crea los eventos de mis pruebas"]) assert.equal(parseCalendarioIntent(t), "crear", t);
  for (const t of ["¿Qué pondrías en el calendario?", "muéstrame los eventos de mis pruebas", "ver eventos para Calendar"]) assert.equal(parseCalendarioIntent(t), "ver", t);
  for (const t of ["no pongas mis pruebas en el calendario", "pon música", "qué hay en mi calendario", "pon mis pruebas en el calendario y manda un correo"]) assert.equal(parseCalendarioIntent(t), null, t);
});

test("conector: color, día completo y zona; con offset queda igual", async () => {
  const g = googleFalso();
  const connections = { load: async () => ({ access_token: "t", expires_at: Date.now() + 3_600_000 }) };
  const google = createGoogle({ env: { GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "s" }, fetch: g.fetch, connections, crypto: { enabled: true } });
  await google.createEvent(1, { summary: "a", start: "2026-01-10", end: "2026-01-11", colorId: "5" });
  await google.createEvent(1, { summary: "b", start: "2026-01-10T17:00:00", end: "2026-01-10T18:00:00" });
  await google.createEvent(1, { summary: "c", start: "2026-01-10T17:00:00-03:00", end: "2026-01-10T21:00:00Z" });
  assert.deepEqual(g.creados.map((e) => [e.start, e.colorId]), [
    [{ date: "2026-01-10" }, "5"],
    [{ dateTime: "2026-01-10T17:00:00", timeZone: "America/Santiago" }, undefined],
    [{ dateTime: "2026-01-10T17:00:00-03:00" }, undefined],
  ]);
  g.eventos = [{ summary: "d", start: { dateTime: "2026-01-11T01:00:00Z" } }];
  assert.deepEqual(await google.findEvents(1, { desde: "2026-01-10", hasta: "2026-01-10" }), [{ summary: "d", dia: "2026-01-10" }]);
});

test("rutas y chat: vista previa, crear sin duplicar, freno, modo Chat, sin conexión y privacidad", async (t) => {
  const g = googleFalso(), now = clock(), groq = spy("groq");
  const db = createDb({ url: ":memory:" });
  const env = { OWNER_PASSWORD: "clave-de-prueba", CONNECTIONS_KEY: "clave-de-prueba-larga-123", GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "s" };
  const ctx = await buildContext({ db, env, fetch: g.fetch, now, providers: { groq } });
  const userId = ctx.ownerId;
  const server = createServer(createApp(ctx));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const { token } = await (await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: env.OWNER_PASSWORD }) })).json();
  const pedir = async (body) => {
    const r = await fetch(`${base}/escolar/calendario`, { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${token}`, "x-requested-with": "jarvis", "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { http: r.status, ...(await r.json()) };
  };
  const chat = (text, extra = {}) => ctx.chat.handle({ userId, text, source: "voz", ...extra });
  assert.equal((await fetch(`${base}/escolar/calendario`)).status, 401);
  await ctx.escolar.recibir({ user_id: userId, sitio: "lirmi" }, { estado: "ok", items: [prueba("Ramo Secreto", "2026-01-20")] });

  // Sin Google conectado: se muestra, pero no se crea.
  const sin = await pedir();
  assert.equal(sin.eventos.length, 4);
  assert.equal(sin.conectado, false);
  assert.match(sin.mensaje, /Conectar Google/);
  assert.match((await chat("pon mis pruebas en el calendario")).reply, /no está conectado/);
  await ctx.connections.save(userId, "google", { access_token: "t", refresh_token: "r", expires_at: now() + 3_600_000 });

  const ver = await chat("qué pondrías en el calendario");
  assert.match(ver.reply, /Ramo Secreto - Prueba/);
  assert.equal(ver.private, true);
  assert.equal(ver.guardar, undefined);
  assert.ok(!/Ramo/.test((await chat("qué pondrías en el calendario", { source: "atajo" })).reply));
  assert.equal(g.creados.length, 0);

  await ctx.control.freno(userId);
  assert.match((await chat("pon mis pruebas en el calendario")).reply, /freno/);
  assert.equal((await pedir({ ids: sin.eventos.map((e) => e.id) })).error, "frenado");
  await ctx.control.reanudar(userId);
  await db.execute({ sql: "INSERT INTO settings (user_id, key, value, created_at) VALUES (?,'modo','chat',?) ON CONFLICT(user_id, key) DO UPDATE SET value='chat'", args: [userId, now()] });
  assert.match((await chat("pon mis pruebas en el calendario")).reply, /modo Chat/);
  await db.execute("DELETE FROM settings WHERE key='modo'");
  assert.equal(g.creados.length, 0);

  assert.equal((await pedir({})).http, 400);
  g.eventos.push({ summary: "ramo secreto - prueba", start: { date: "2026-01-20" } });
  const uno = await pedir({ ids: [sin.eventos[0].id] });
  assert.deepEqual([uno.creados, uno.omitidos], [1, 0]);
  assert.match((await chat("pon mis pruebas en el calendario")).reply, /Creé 2 eventos.*2 ya estaban/);
  assert.match((await chat("pon mis pruebas en el calendario")).reply, /Creé 0 eventos.*4 ya estaban/);
  assert.equal(g.creados.length, 3);
  assert.ok((await pedir()).eventos.every((e) => e.existe));

  assert.equal(groq.calls, 0);
  for (const tabla of ["messages", "audit_log"]) assert.ok(!/Ramo Secreto/i.test(JSON.stringify((await db.execute(`SELECT * FROM ${tabla}`)).rows)), tabla);
});
