import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createDb } from "../server/db/client.js";
import { buildContext } from "../server/context.js";
import { createApp } from "../server/app.js";
import { createHub } from "../server/ws-hub.js";
import { spy } from "./helpers.js";

// "/gemini ..." ya no encola nada ni dice "apagado": contesta el router normal con el proveedor gemini (API) primero.
let server, base, ctx, token, gem, groq;
const call = (path, { method = "GET", body, tk = token } = {}) =>
  fetch(base + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(tk ? { authorization: `Bearer ${tk}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
const chat = async (body) => (await call("/api/chat", { method: "POST", body })).json();
const nTareas = async () => (await (await call("/api/tasks")).json()).tasks.length;

before(async () => {
  ctx = await buildContext({ db: createDb({ url: ":memory:" }), env: { OWNER_PASSWORD: "prueba-123" } });
  gem = spy("gemini"); groq = spy("groq");
  ctx.providers.gemini = gem; ctx.providers.groq = groq; // proveedores falsos (sin claves ni red)
  server = createServer(createApp(ctx));
  ctx.hub = createHub({ server, sessions: ctx.sessions, bus: ctx.bus });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  token = (await (await call("/api/auth/login", { method: "POST", body: { password: "prueba-123" }, tk: null })).json()).token;
});
after(() => { ctx.hub.close(); server.close(); });

test("'/gemini hola' responde con el proveedor gemini y no crea tarea", async () => {
  const antes = await nTareas();
  for (const text of ["/gemini hola", "díselo a Gemini: hola", "directo a Gemini: hola", "Jarvis, /gemini hola"]) {
    const r = await chat({ text });
    assert.equal(r.status, "ok", text);
    assert.equal(r.provider, "gemini", text);
    assert.doesNotMatch(r.reply, /apagado/i);
  }
  assert.equal(await nTareas(), antes);
  assert.equal(groq.calls, 0);
});

test("'/gemini' con una orden de PC tampoco encola: se contesta como charla", async () => {
  const antes = await nTareas();
  const r = await chat({ text: "/gemini abre el proyecto en mi pc y compila" });
  assert.equal(r.status, "ok");
  assert.equal(r.provider, "gemini");
  assert.equal(await nTareas(), antes);
});

test("'/gemini' con texto privado lo contesta Groq (Gemini nunca recibe lo privado)", async () => {
  const llamadas = gem.calls;
  const r = await chat({ text: "/gemini mi contraseña del banco es 1234, guárdala", private: true });
  assert.equal(r.status, "ok");
  assert.equal(r.provider, "groq");
  assert.equal(r.private, true);
  assert.equal(gem.calls, llamadas);
});

test("'/gemini' sin texto pide el mensaje y no llama a nadie", async () => {
  const llamadas = gem.calls;
  const r = await chat({ text: "/gemini" });
  assert.equal(r.status, "vacio");
  assert.equal(gem.calls, llamadas);
});

test("/status ya no lista el puesto ni la conexión gemini_pc", async () => {
  const st = await (await call("/api/status")).json();
  assert.ok(!st.puestos.some((p) => p.id === "gemini_pc"));
  assert.ok(!st.connections.some((c) => c.id === "gemini_pc"));
  assert.ok(st.puestos.some((p) => p.id === "claude"));
  assert.equal("gemini_activo" in st.pc, false);
});

test("el motor 'gemini' de tareas ya no existe", async () => {
  const r = await call("/api/tasks", { method: "POST", body: { text: "hazlo", engine: "gemini" } });
  assert.equal(r.status, 400);
  assert.equal((await call("/api/tasks/1/pass-to-claude", { method: "POST", body: {} })).status, 404);
});

// ---- Groq primero: Gemini solo bajo pedido ----
test("frases naturales de pedido a Gemini lo activan; en mitad de frase no", async () => {
  const { detectPedidoGemini } = await import("../server/router/pedido.js");
  assert.deepEqual(detectPedidoGemini("Jarvis, pregúntale a Gemini: qué hora es en Tokio"), { pedido: true, text: "qué hora es en Tokio" });
  assert.equal(detectPedidoGemini("dile a Google que resuma esto").pedido, true);
  assert.deepEqual(detectPedidoGemini("resume este texto con Gemini."), { pedido: true, text: "resume este texto" });
  assert.equal(detectPedidoGemini("qué es Google Maps").pedido, false);
  assert.equal(detectPedidoGemini("dile a Gemini").pedido, false);
  assert.equal(detectPedidoGemini("usa Gemini para esto y luego sigue").pedido, false);
});

test("'pregúntale a Gemini' y el motor gemini usan Gemini; el chat normal nunca", async () => {
  gem.calls = 0; groq.calls = 0;
  let r = await chat({ text: "pregúntale a Gemini, cuánto es 2+2" });
  assert.equal(r.provider, "gemini");
  r = await chat({ text: "cuánto es 3+3", engine: "gemini" });
  assert.equal(r.provider, "gemini");
  const g = gem.calls;
  r = await chat({ text: "cuánto es 4+4" });
  assert.equal(r.provider, "groq");
  assert.equal(gem.calls, g);
});

test("privado con 'pregúntale a Gemini' lo contesta Groq", async () => {
  const g = gem.calls;
  const r = await chat({ text: "pregúntale a Gemini mi contraseña del banco es 1234", private: true });
  assert.equal(r.provider, "groq");
  assert.equal(gem.calls, g);
});

test("sin pedido, si Groq falla nunca se llama a Gemini", async () => {
  const g = gem.calls, oldFail = groq.fail;
  groq.fail = Object.assign(new Error("boom"), { status: 500 });
  try {
    const r = await chat({ text: "dime un dato curioso" });
    assert.notEqual(r.provider, "gemini");
    assert.equal(gem.calls, g);
    if (r.status === "sin_cuota") assert.match(r.reply, /\/gemini/);
  } finally { groq.fail = oldFail; }
});
