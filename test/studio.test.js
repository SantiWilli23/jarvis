import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createDb } from "../server/db/client.js";
import { buildContext } from "../server/context.js";
import { createApp } from "../server/app.js";
import { buildProviders } from "../server/providers/index.js";
import { ProviderError } from "../server/providers/base.js";
import { partes, renderRespuesta, renderOpciones, codigosDe, AI_STUDIO_URL, esc } from "../web/js/estudio.js";

let server, base, ctx, token, llamadas, falla;
const call = (path, { method = "GET", body, tk = token } = {}) =>
  fetch(base + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(tk ? { authorization: `Bearer ${tk}` } : {}) }, body: body ? JSON.stringify(body) : undefined });

before(async () => {
  llamadas = []; falla = null;
  const providers = buildProviders({ env: {}, config: { proveedores: {} } });
  // Gemini simulado: sin red. Registra qué modelo y qué texto recibe.
  providers.gemini = { id: "gemini", enabled: true, apiKey: "x", async chat({ messages, model }) { if (falla) throw falla; llamadas.push({ model, messages }); return { text: "Aquí:\n```js\nconsole.log(1)\n```", tokens: 3, headers: {} }; } };
  const db = createDb({ url: ":memory:" });
  ctx = await buildContext({ db, env: { OWNER_PASSWORD: "prueba-123" }, providers });
  server = createServer(createApp(ctx));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  token = (await (await call("/api/auth/login", { method: "POST", body: { password: "prueba-123" }, tk: null })).json()).token;
});
after(() => { server.close(); });

test("el Estudio exige sesión y lista modelos con los sin nivel gratis marcados", async () => {
  assert.equal((await call("/api/studio/models", { tk: null })).status, 401);
  const m = await (await call("/api/studio/models")).json();
  assert.equal(m.por_defecto, "gemini-3.8-flash");
  assert.match(m.aviso, /entrenar/);
  for (const id of ["gemini-4-hydrogen", "gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"]) assert.equal(m.modelos.find((x) => x.id === id).gratis, true, id);
  for (const id of ["gemini-4-carbon", "gemini-4-argon", "gemini-3.1-pro"]) assert.equal(m.modelos.find((x) => x.id === id).gratis, false, id);
  assert.ok(!JSON.stringify(m).includes("apiKey"));
});

test("chat usa el modelo elegido, guarda historial y lo reenvía", async () => {
  const r = await (await call("/api/studio/chat", { method: "POST", body: { text: "hazme un log", model: "gemini-4-hydrogen", session: "t1" } })).json();
  assert.equal(r.model, "gemini-4-hydrogen");
  assert.match(r.reply, /console\.log/);
  assert.equal(llamadas.at(-1).model, "gemini-4-hydrogen");
  await call("/api/studio/chat", { method: "POST", body: { text: "otro", session: "t1" } });
  assert.equal(llamadas.at(-1).model, "gemini-3.8-flash");
  assert.equal(llamadas.at(-1).messages.length, 3); // pregunta + respuesta + pregunta nueva
  const h = await (await call("/api/studio/history?session=t1")).json();
  assert.equal(h.messages.length, 4);
  assert.equal((await call("/api/studio/history?session=t1", { method: "DELETE" })).status, 200);
  assert.equal((await (await call("/api/studio/history?session=t1")).json()).messages.length, 0);
});

test("modelo sin nivel gratis o desconocido: se rechaza sin llamar a Gemini", async () => {
  const n = llamadas.length;
  const a = await call("/api/studio/chat", { method: "POST", body: { text: "hola", model: "gemini-3.1-pro", session: "t2" } });
  assert.equal(a.status, 400); assert.equal((await a.json()).error, "sin_nivel_gratis");
  assert.equal((await call("/api/studio/chat", { method: "POST", body: { text: "hola", model: "inventado", session: "t2" } })).status, 400);
  assert.equal(llamadas.length, n);
});

test("mensaje privado (marca o clasificador) nunca llega a Gemini ni se guarda", async () => {
  const n = llamadas.length;
  const a = await call("/api/studio/chat", { method: "POST", body: { text: "hola", private: true, session: "t3" } });
  assert.equal(a.status, 403); assert.equal((await a.json()).error, "privado_no_gemini");
  const b = await call("/api/studio/chat", { method: "POST", body: { text: "mi contraseña es 1234, guárdala", session: "t3" } });
  if (b.status === 403) assert.equal((await b.json()).error, "privado_no_gemini");
  assert.equal(llamadas.length, n + (b.status === 403 ? 0 : 1));
  assert.equal((await (await call("/api/studio/history?session=t3")).json()).messages.length, b.status === 403 ? 0 : 2);
  assert.equal(llamadas.slice(n).some((l) => l.messages.some((m) => m.content === "hola")), false);
});

test("validaciones: texto vacío, largo, sesión inválida, 429 de Gemini y fallo", async () => {
  const p = (body) => call("/api/studio/chat", { method: "POST", body });
  assert.equal((await p({ text: " ", session: "t4" })).status, 400);
  assert.equal((await p({ text: "x".repeat(13000), session: "t4" })).status, 413);
  assert.equal((await p({ text: "hola", session: "../x" })).status, 400);
  falla = new ProviderError("límite", { status: 429 });
  assert.equal((await p({ text: "hola", session: "t4" })).status, 429);
  falla = new ProviderError("caído", { status: 500 });
  assert.equal((await p({ text: "hola", session: "t4" })).status, 502);
  falla = null;
  assert.equal((await (await call("/api/studio/history?session=t4")).json()).messages.length, 0);
});

test("tope diario del Estudio", async () => {
  ctx.studio = undefined; // no se usa: probamos con un servicio nuevo
  const { createStudio } = await import("../server/studio.js");
  const s = createStudio({ db: ctx.db, config: { ...ctx.config.estudio, tope_dia: 1 }, providers: ctx.providers, chat: ctx.chat, privacy: ctx.privacy });
  await s.send({ userId: ctx.ownerId, text: "uno", session: "t5" });
  await assert.rejects(s.send({ userId: ctx.ownerId, text: "dos", session: "t5" }), (e) => e.error === "tope_diario");
});

test("render web: bloques de código con Copiar, HTML escapado, botón AI Studio", () => {
  const t = "Mira <b>esto</b>\n```python\nprint('<x>')\n```\nfin";
  assert.deepEqual(partes(t).map((p) => p.tipo), ["texto", "codigo", "texto"]);
  const h = renderRespuesta(t, 5);
  assert.ok(h.includes('data-copiar="5"') && h.includes("&lt;x&gt;") && !h.includes("<b>esto"));
  assert.deepEqual(codigosDe(t), ["print('<x>')"]);
  assert.equal(codigosDe("```js\nsin cerrar").length, 1);
  assert.equal(AI_STUDIO_URL, "https://aistudio.google.com");
  const o = renderOpciones([{ id: "a", nombre: "A", gratis: true }, { id: "b", nombre: "B", gratis: false }], "a");
  assert.ok(o.includes("selected") && o.includes("disabled") && o.includes("sin nivel gratis"));
  assert.equal(esc("<&>"), "&lt;&amp;&gt;");
});
