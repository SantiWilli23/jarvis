import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createDb, all, get } from "../server/db/client.js";
import { buildContext, loadJson } from "../server/context.js";
import { createApp } from "../server/app.js";
import { cargarEscenas, parseEscenaIntent } from "../server/escenas.js";

let server, base, ctx, web, pcTk, phoneTk, now = Date.now();
const call = (path, { method = "GET", body, tk = web } = {}) =>
  fetch(base + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(tk ? { authorization: `Bearer ${tk}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
const json = async (p, o) => (await call(p, o)).json();
const disparar = (body, tk = phoneTk) => call("/api/phone/disparador", { method: "POST", body, tk });
const hello = (acciones = Object.keys(ctx.pc.config.acciones)) => call("/api/agent/hello", { method: "POST", body: { version: "1", host: "MI-PC", capabilities: { pc_acciones: acciones } }, tk: pcTk });

before(async () => {
  ctx = await buildContext({ db: createDb({ url: ":memory:" }), env: { OWNER_PASSWORD: "prueba-123" }, now: () => now });
  server = createServer(createApp(ctx));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  web = (await ctx.sessions.create(ctx.ownerId, { name: "t", kind: "web" })).token;
  pcTk = (await json("/api/devices", { method: "POST", body: { name: "PC", kind: "pc" } })).token;
  phoneTk = (await json("/api/devices", { method: "POST", body: { name: "iPhone", kind: "phone" } })).token;
});
after(() => server.close());

test("las escenas incluidas se cargan todas y no llevan capturas", () => {
  const cfg = loadJson("escenas.json");
  assert.deepEqual(ctx.escenas.rechazadas, []);
  assert.equal(ctx.escenas.list().length, cfg.escenas.length);
  for (const p of cfg.escenas.flatMap((e) => e.pasos)) assert.notEqual(p.accion, "captura");
});

test("al cargar se rechaza la escena entera con un paso sensible o inválido", () => {
  const ok = { destino: "pc", accion: "bloquear", params: {} };
  const malos = [
    { destino: "pc", accion: "apagar" }, { destino: "pc", accion: "suspender" }, { destino: "pc", accion: "reiniciar" },
    { destino: "pc", accion: "captura" }, { destino: "pc", accion: "portapapeles_leer" }, { destino: "pc", accion: "archivos_leer", params: { raiz: "a", ruta: "b.txt" } },
    { destino: "phone", accion: "wifi", params: { valor: "off" } }, { destino: "phone", accion: "modo_avion", params: { valor: "on" } },
    { destino: "phone", accion: "enviar_mensaje", params: { valor: "hola", para: "x" } }, { destino: "phone", accion: "llamar", params: { valor: "x" } },
    { destino: "phone", accion: "abrir_url", params: { valor: "https://example.org" } },
    { destino: "phone", accion: "brillo", params: { valor: 500 } }, { destino: "phone", accion: "brillo", params: { valor: 5, extra: 1 } },
    { destino: "otro", accion: "bloquear" }, { destino: "pc", accion: "formatear" }, { destino: "pc", accion: "toString" },
  ];
  for (const p of malos) {
    const r = cargarEscenas({ escenas: [{ id: "x", nombre: "X", pasos: [ok, p] }] }, ctx);
    assert.equal(r.escenas.length, 0, JSON.stringify(p));
    assert.equal(r.rechazadas.length, 1);
  }
  // Una acción privada se rechaza aunque la config la marcara automática.
  const pc = { config: { acciones: { secreto: { privado: true, params: {} } } }, validate: () => ({ ok: true, aprobacion: false }) };
  assert.match(cargarEscenas({ escenas: [{ id: "x", nombre: "X", pasos: [{ destino: "pc", accion: "secreto" }] }] }, { pc, phone: ctx.phone }).rechazadas[0].motivo, /accion_privada/);
});

test("intents: frase exacta, con o sin «activa»; la charla no se secuestra", () => {
  const es = cargarEscenas(loadJson("escenas.json"), ctx).escenas;
  for (const [f, id] of [["activa modo estudio", "modo_estudio"], ["Jarvis, pon el modo estudio por favor", "modo_estudio"], ["¡Modo buenas noches, Jarvis!", "buenas_noches"], ["llego a casa", "llego_a_casa"], ["ejecuta la escena llego a casa", "llego_a_casa"]]) {
    assert.equal(parseEscenaIntent(f, es)?.id, id, f);
  }
  for (const f of ["buenas noches, ¿qué tiempo hará mañana?", "qué es el modo estudio", "activa el modo trabajo", "no actives modo estudio", "buenas noches"]) assert.equal(parseEscenaIntent(f, es), null, f);
});

test("chat: con el PC apagado lanza lo del iPhone y dice lo que falló", async () => {
  const r = await json("/api/chat", { method: "POST", body: { text: "activa modo estudio" } });
  assert.equal(r.status, "escena");
  assert.deepEqual([r.escena.lanzadas, r.escena.fallidas], [2, 1]);
  assert.match(r.reply, /2 de 3/);
  assert.match(r.reply, /PC está apagado/);
  const filas = await all(ctx.db, "SELECT * FROM phone_actions ORDER BY id");
  assert.equal(filas.length, 2);
  for (const f of filas) { assert.equal(Number(f.conversation_id), r.conversationId); assert.ok(f.device_id != null); assert.equal(f.status, "lista"); }
  assert.equal((await all(ctx.db, "SELECT * FROM pc_actions")).length, 0);
});

test("web: botones con sesión web; el token del teléfono no entra", async () => {
  await hello();
  assert.equal((await json("/api/escenas")).escenas.length, 3);
  const r = await json("/api/escenas/buenas_noches", { method: "POST", body: {} });
  assert.deepEqual([r.lanzadas.length, r.fallidas.length], [4, 0]);
  assert.equal((await call("/api/escenas/nada", { method: "POST", body: {} })).status, 404);
  assert.equal((await call("/api/escenas", { tk: phoneTk })).status, 403);
  assert.equal((await call("/api/escenas/buenas_noches", { method: "POST", body: {}, tk: phoneTk })).status, 403);
  assert.equal((await all(ctx.db, "SELECT * FROM approvals")).length, 0);
});

test("pc_acciones: si la app del PC no admite una acción, se informa", async () => {
  await hello(["bloquear"]);
  const r = await json("/api/escenas/buenas_noches", { method: "POST", body: {} });
  assert.deepEqual(r.fallidas.map((f) => f.error), ["accion_no_soportada"]);
});

test("disparador: solo token phone y solo {escena} de la lista", async () => {
  assert.equal((await disparar({ escena: "llego_a_casa" }, null)).status, 401);
  assert.equal((await disparar({ escena: "llego_a_casa" }, web)).status, 403);
  assert.equal((await disparar({ escena: "llego_a_casa" }, pcTk)).status, 403);
  for (const b of [{}, { escena: "apagar" }, { escena: 1 }, { escena: "llego_a_casa", params: {} }, { accion: "bloquear" }, { escena: ["llego_a_casa"] }]) {
    assert.equal((await disparar(b)).status, 400, JSON.stringify(b));
  }
  await hello();
  const r = await (await disparar({ escena: "llego_a_casa" })).json();
  assert.equal(r.ok, true);
  assert.match(r.resumen, /4 de 4/);
  assert.deepEqual(Object.keys(r).sort(), ["escena", "ok", "resumen"]);
  const a = await get(ctx.db, "SELECT * FROM phone_actions ORDER BY id DESC LIMIT 1");
  assert.equal(a.source, "disparador");
});

test("disparador: 10 por hora, también en paralelo, con auditoría", async () => {
  now += 2 * 3600_000;
  const estados = (await Promise.all(Array.from({ length: 13 }, () => disparar({ escena: "modo_estudio" })))).map((r) => r.status);
  assert.equal(estados.filter((s) => s === 200).length, 10);
  assert.equal(estados.filter((s) => s === 429).length, 3);
  now += 3600_000 + 1;
  assert.equal((await disparar({ escena: "modo_estudio" })).status, 200);
  const acciones = (await all(ctx.db, "SELECT action FROM audit_log")).map((x) => x.action);
  for (const a of ["escena.disparador", "escena.disparador_tope", "escena.disparador_rechazado", "escena.lanzada"]) assert.ok(acciones.includes(a), a);
});
