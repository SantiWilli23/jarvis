import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { EventEmitter } from "node:events";
import { createDb } from "../server/db/client.js";
import { buildContext } from "../server/context.js";
import { createApp } from "../server/app.js";
import { createHub } from "../server/ws-hub.js";
import { createResultados, textoResultado } from "../server/acciones/resultados.js";
import { filtrarDatos } from "../server/phone/queue.js";
import { clock } from "./helpers.js";

let server, base, ctx, webA, webB, pcTk, phoneTk, devA, devB, now = Date.now();
const pushes = [];
const fakeWebpush = { generateVAPIDKeys: () => ({ publicKey: "PUB", privateKey: "PRIV" }), async sendNotification(sub, payload) { pushes.push(JSON.parse(payload)); } };
const call = (path, { method = "GET", body, tk = webA } = {}) =>
  fetch(base + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(tk ? { authorization: `Bearer ${tk}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
const json = async (p, o) => (await call(p, o)).json();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Cliente WS que guarda los accion.resultado recibidos.
async function conectar(token) {
  const ws = new WebSocket(base.replace("http", "ws") + "/ws");
  const got = [];
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.type === "accion.resultado") got.push(m); };
  await new Promise((r) => (ws.onopen = r));
  const ok = new Promise((r) => { const f = ws.onmessage; ws.onmessage = (e) => { f(e); if (JSON.parse(e.data).type === "auth.ok") r(); }; });
  ws.send(JSON.stringify({ type: "auth", token }));
  await ok;
  return { ws, got };
}

before(async () => {
  ctx = await buildContext({ db: createDb({ url: ":memory:" }), env: { OWNER_PASSWORD: "prueba-123" }, now: () => now, webpush: fakeWebpush });
  server = createServer(createApp(ctx));
  ctx.hub = createHub({ server, sessions: ctx.sessions, bus: ctx.bus });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  const a = await ctx.sessions.create(ctx.ownerId, { name: "A", kind: "web" });
  const b = await ctx.sessions.create(ctx.ownerId, { name: "B", kind: "web" });
  webA = a.token; webB = b.token; devA = a.deviceId; devB = b.deviceId;
  pcTk = (await json("/api/devices", { method: "POST", body: { name: "PC", kind: "pc" } })).token;
  phoneTk = (await json("/api/devices", { method: "POST", body: { name: "iPhone", kind: "phone" } })).token;
  await call("/api/agent/hello", { method: "POST", body: { version: "1", host: "MI-PC" }, tk: pcTk });
});
after(() => { ctx.hub.close(); server.close(); });

test("textoResultado: corto, en español y sin saltos de línea", () => {
  assert.equal(textoResultado({ ok: true, texto: "", nombre: "Subir el volumen" }), "Hecho: Subir el volumen.");
  assert.match(textoResultado({ ok: false, texto: "", nombre: "Bloquear" }), /No pude completar/);
  assert.ok(textoResultado({ ok: true, texto: "a\n\nb".padEnd(900, "x") }).length <= 300);
  assert.ok(!/\n/.test(textoResultado({ ok: true, texto: "a\nb" })));
});

test("filtrarDatos: lista blanca y longitud limitada", () => {
  const d = filtrarDatos({ texto: "x".repeat(500), bateria: 80, token: "SECRETO", estado: true, otro: { a: 1 } });
  assert.equal(d.texto.length, 200);
  assert.equal(d.bateria, 80);
  assert.equal(d.estado, true);
  assert.ok(!("token" in d) && !("otro" in d));
  assert.deepEqual(filtrarDatos([1, 2]), {});
});

test("las columnas de origen existen en las dos colas", async () => {
  for (const t of ["pc_actions", "phone_actions"]) {
    const cols = (await ctx.db.execute(`PRAGMA table_info(${t})`)).rows.map((c) => c.name);
    for (const c of ["conversation_id", "device_id", "source"]) assert.ok(cols.includes(c), `${t}.${c}`);
  }
});

test("PC: el resultado vuelve solo al dispositivo que lo pidió y no se repite", async () => {
  const A = await conectar(webA), B = await conectar(webB);
  const r = await json("/api/pc/actions", { method: "POST", body: { accion: "volumen", params: { accion: "fijar", nivel: 30 } }, tk: webA });
  const id = r.action.id;
  const fila = (await ctx.db.execute({ sql: "SELECT * FROM pc_actions WHERE id=?", args: [id] })).rows[0];
  assert.equal(Number(fila.device_id), devA);
  assert.equal(fila.source, "web");
  const n = (await json("/api/agent/pc/next", { method: "POST", tk: pcTk })).accion;
  assert.equal(n.id, id);
  await call(`/api/agent/pc/${id}/result`, { method: "POST", tk: pcTk, body: { ok: true, texto: "Volumen al 30" } });
  await wait(80);
  assert.equal(A.got.length, 1);
  assert.equal(B.got.length, 0); // B no es el origen
  const m = A.got[0];
  assert.deepEqual(Object.keys(m).sort(), ["accion", "at", "conversationId", "deviceId", "hablar", "id", "ok", "origen", "privado", "texto", "type"].sort());
  assert.equal(m.origen, "pc"); assert.equal(m.id, id); assert.equal(m.accion, "volumen");
  assert.equal(m.ok, true); assert.equal(m.privado, false); assert.equal(m.hablar, true); assert.equal(m.texto, "Volumen al 30");
  assert.equal(m.deviceId, devA);
  // un segundo resultado para la misma acción se rechaza (409) y no emite otro evento
  const again = await call(`/api/agent/pc/${id}/result`, { method: "POST", tk: pcTk, body: { ok: true, texto: "otra vez" } });
  assert.equal(again.status, 409);
  await wait(40);
  assert.equal(A.got.length, 1);
  A.ws.close(); B.ws.close();
});

test("PC privado: el texto real viaja en vivo, la BD guarda [privado] y el búfer lo retiene 15 min", async () => {
  const A = await conectar(webA);
  const r = await json("/api/pc/actions", { method: "POST", body: { accion: "portapapeles_leer", params: {} }, tk: webA });
  const id = r.action.id;
  const ap = (await json("/api/approvals")).pendientes?.find?.((x) => x.kind === "pc:portapapeles_leer") ?? (await ctx.approvals.pending(ctx.ownerId)).find((x) => x.kind === "pc:portapapeles_leer");
  await ctx.pc.decide(ctx.ownerId, id, true);
  assert.ok(ap);
  await json("/api/agent/pc/next", { method: "POST", tk: pcTk });
  pushes.length = 0;
  await call(`/api/agent/pc/${id}/result`, { method: "POST", tk: pcTk, body: { ok: true, texto: "mi clave 1234 secreta", datos: { x: "mi clave 1234 secreta" } } });
  await wait(80);
  assert.equal(A.got.length, 1);
  assert.equal(A.got[0].texto, "mi clave 1234 secreta");
  assert.equal(A.got[0].privado, true);
  assert.equal(A.got[0].hablar, false);
  const fila = (await ctx.db.execute({ sql: "SELECT result FROM pc_actions WHERE id=?", args: [id] })).rows[0];
  assert.ok(!String(fila.result).includes("1234"));
  assert.equal(JSON.parse(fila.result).texto, "[privado]");
  const log = await ctx.db.execute("SELECT detail FROM audit_log");
  assert.ok(!log.rows.some((x) => String(x.detail).includes("1234")));
  // reconexión dentro de 15 min: lo recibe del búfer (sin voz); pasado el plazo, desaparece
  assert.equal(ctx.resultados.pendientes(ctx.ownerId).filter((x) => x.id === id).length, 1);
  assert.equal(ctx.resultados.pendientes(ctx.ownerId).find((x) => x.id === id).hablar, false);
  now += 14 * 60_000;
  assert.equal(ctx.resultados.pendientes(ctx.ownerId).filter((x) => x.id === id).length, 1);
  now += 2 * 60_000;
  assert.equal(ctx.resultados.pendientes(ctx.ownerId).filter((x) => x.id === id).length, 0);
  A.ws.close();
});

test("iPhone: done() emite el resultado; lo privado queda como [privado] en la BD", async () => {
  const A = await conectar(webA);
  const r = await json("/api/phone/actions", { method: "POST", body: { accion: "brillo", valor: 40 }, tk: webA });
  const id = r.action.id;
  assert.equal(Number((await ctx.db.execute({ sql: "SELECT device_id FROM phone_actions WHERE id=?", args: [id] })).rows[0].device_id), devA);
  const lote = (await json("/api/phone/next", { method: "POST", tk: phoneTk })).acciones;
  assert.ok(lote.some((x) => x.id === id));
  const d = await call(`/api/phone/actions/${id}/done`, { method: "POST", tk: phoneTk, body: { ok: true, datos: { texto: "Brillo al 40 %", token: "NO" } } });
  assert.equal(d.status, 200);
  await wait(80);
  const m = A.got.find((x) => x.origen === "phone" && x.id === id);
  assert.ok(m);
  assert.equal(m.texto, "Brillo al 40 %");
  assert.equal(m.ok, true);

  // privada: leer_portapapeles
  const p = await json("/api/phone/actions", { method: "POST", body: { accion: "leer_portapapeles" }, tk: webA });
  const pid = p.action.id;
  await ctx.phone.counts(ctx.ownerId);
  const ap = (await ctx.approvals.pending(ctx.ownerId)).find((x) => x.kind === "phone:leer_portapapeles");
  await ctx.approvals.decide(ctx.ownerId, ap.id, true);
  await wait(40);
  await json("/api/phone/next", { method: "POST", tk: phoneTk });
  pushes.length = 0;
  await call(`/api/phone/actions/${pid}/done`, { method: "POST", tk: phoneTk, body: { ok: true, result: "texto muy privado 9876" } });
  await wait(80);
  const fila = (await ctx.db.execute({ sql: "SELECT result FROM phone_actions WHERE id=?", args: [pid] })).rows[0];
  assert.equal(fila.result, "[privado]");
  const priv = A.got.find((x) => x.origen === "phone" && x.id === pid);
  assert.equal(priv.texto, "texto muy privado 9876");
  assert.equal(priv.privado, true);
  assert.equal(pushes.length, 0); // había un dispositivo conectado: sin push
  A.ws.close();
});

test("sin dispositivo conectado: push de respaldo; el privado dice solo «Resultado listo»", async () => {
  await call("/api/push/subscribe", { method: "POST", body: { subscription: { endpoint: "https://push.example/r1", keys: { p256dh: "p", auth: "a" } } } });
  pushes.length = 0;
  const bus = ctx.bus;
  bus.emit("pc.action.result", { userId: ctx.ownerId, id: 901, action: "volumen", nombre: "Volumen", ok: true, texto: "Volumen al 10", privado: false, conversationId: null, deviceId: devA });
  bus.emit("pc.action.result", { userId: ctx.ownerId, id: 902, action: "portapapeles_leer", nombre: "Leer el portapapeles", ok: true, texto: "contraseña 5555", privado: true, conversationId: null, deviceId: devA });
  await wait(120);
  const cuerpos = pushes.map((p) => p.body);
  assert.ok(cuerpos.includes("Volumen al 10"));
  assert.ok(cuerpos.includes("Resultado listo"));
  assert.ok(!JSON.stringify(pushes).includes("5555"));
});

test("módulo suelto: ruteo con hub falso, búfer con reloj falso y push solo si no hay nadie conectado", async () => {
  const bus = new EventEmitter();
  const t = clock();
  const avisos = [], tg = [], emitidos = [];
  let conectado = true;
  const res = createResultados({ bus, push: { notify: async (u, p) => avisos.push(p) }, notify: async (x) => tg.push(x), getHub: () => ({ hasDevice: () => conectado, hasUser: () => conectado }), now: t });
  bus.on("accion.resultado", (e) => emitidos.push(e));
  const ev = await res.emitir("phone", { userId: 1, id: 5, action: "linterna", nombre: "Linterna", ok: false, texto: "", privado: false, deviceId: 7, conversationId: 3 });
  assert.equal(ev.origen, "phone"); assert.equal(ev.conversationId, 3); assert.match(ev.texto, /No pude completar «Linterna»/);
  assert.equal(avisos.length, 0); assert.equal(tg.length, 0);
  conectado = false;
  await res.emitir("phone", { userId: 1, id: 6, action: "captura", nombre: "Captura", ok: true, texto: "datos privados", privado: true, deviceId: 7 });
  assert.equal(avisos.at(-1).body, "Resultado listo");
  assert.equal(tg.at(-1), "Resultado listo");
  assert.equal(emitidos.length, 2);
  assert.equal(res.pendientes(1).length, 1);
  t.advance(15 * 60_000 + 1);
  assert.equal(res.pendientes(1).length, 0);
});
