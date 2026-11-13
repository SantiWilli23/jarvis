import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createDb } from "../server/db/client.js";
import { buildContext } from "../server/context.js";
import { createApp } from "../server/app.js";
import { createHub } from "../server/ws-hub.js";
import { getModo, setModo } from "../server/settings.js";

let server, base, ctx, token;
const call = (path, { method = "GET", body, tk = token } = {}) =>
  fetch(base + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(tk ? { authorization: `Bearer ${tk}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
const put = (modo) => call("/api/settings", { method: "PUT", body: { modo } });
const nTareas = async () => (await (await call("/api/tasks")).json()).tasks.length;

before(async () => {
  const db = createDb({ url: ":memory:" });
  ctx = await buildContext({ db, env: { OWNER_PASSWORD: "prueba-123" } });
  server = createServer(createApp(ctx));
  ctx.hub = createHub({ server, sessions: ctx.sessions, bus: ctx.bus });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  token = (await (await call("/api/auth/login", { method: "POST", body: { password: "prueba-123" }, tk: null })).json()).token;
});
after(() => { ctx.hub.close(); server.close(); });

test("el modo por defecto es ia y PUT valida", async () => {
  assert.equal((await call("/api/settings", { tk: null })).status, 401);
  assert.deepEqual(await (await call("/api/settings")).json(), { modo: "ia" });
  for (const malo of ["", "IA", "otro", 1, null, undefined, ["chat"]]) assert.equal((await put(malo)).status, 400, String(malo));
  assert.equal((await call("/api/settings", { method: "PUT", body: {} })).status, 400);
  assert.deepEqual(await (await call("/api/settings")).json(), { modo: "ia" });
  assert.deepEqual(await (await put("chat")).json(), { modo: "chat" });
  assert.deepEqual(await (await call("/api/settings")).json(), { modo: "chat" });
  assert.deepEqual(await (await put("ia")).json(), { modo: "ia" });
});

test("modo ia: encola y prepara como siempre", async () => {
  await put("ia");
  const antes = await nTareas();
  const d = await (await call("/api/chat", { method: "POST", body: { text: "/claude haz algo" } })).json();
  assert.equal(d.status, "tarea");
  const a = await (await call("/api/chat", { method: "POST", body: { text: "abre el proyecto en mi pc y compila" } })).json();
  assert.equal(a.status, "tarea");
  assert.equal(await nTareas(), antes + 2);
});

test("modo chat: nada de tareas, ni herramientas, y el prompt pide solo conversar", async () => {
  await put("chat");
  const antes = await nTareas();
  const visto = { system: [], web: 0, phone: 0 };
  const route = ctx.router.route.bind(ctx.router), search = ctx.websearch.search, create = ctx.phone.create;
  ctx.router.route = (a) => { visto.system.push(a.system); visto.kind = a.kind; return route(a); };
  ctx.websearch.search = async (...a) => { visto.web++; return search(...a); };
  ctx.phone.create = async (...a) => { visto.phone++; return create(...a); };
  try {
    for (const text of ["/claude haz algo", "/gemini haz algo", "abre el proyecto en mi pc y compila", "busca en internet las últimas noticias de fútbol", "enciende la linterna"]) {
      const r = await (await call("/api/chat", { method: "POST", body: { text } })).json();
      assert.equal(r.status, "ok", text);
    }
  } finally { ctx.router.route = route; ctx.websearch.search = search; ctx.phone.create = create; }
  assert.equal(await nTareas(), antes);
  assert.equal(visto.web, 0);
  assert.equal(visto.phone, 0);
  assert.equal(visto.kind, "charla");
  assert.equal(visto.system.length, 5);
  assert.ok(visto.system.every((s) => /MODO CHAT/.test(s)));
  await put("ia");
});

test("el ajuste es por usuario", async () => {
  const r = await ctx.db.execute({ sql: "INSERT INTO users (name, role, created_at) VALUES ('otro','invitado',?)", args: [Date.now()] });
  const otro = Number(r.lastInsertRowid);
  await setModo(ctx.db, 1, "chat");
  assert.equal(await getModo(ctx.db, 1), "chat");
  assert.equal(await getModo(ctx.db, otro), "ia");
  await setModo(ctx.db, otro, "chat");
  await setModo(ctx.db, 1, "ia");
  assert.equal(await getModo(ctx.db, otro), "chat");
  assert.equal(await getModo(ctx.db, 1), "ia");
  await assert.rejects(() => setModo(ctx.db, 1, "xx"));
});
