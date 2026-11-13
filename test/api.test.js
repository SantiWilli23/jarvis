import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createDb } from "../server/db/client.js";
import { buildContext } from "../server/context.js";
import { createApp } from "../server/app.js";
import { createHub } from "../server/ws-hub.js";

let server, base, ctx, token;
const call = (path, { method = "GET", body, tk = token, headers = {} } = {}) =>
  fetch(base + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(tk ? { authorization: `Bearer ${tk}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });

before(async () => {
  const db = createDb({ url: ":memory:" });
  ctx = await buildContext({ db, env: { OWNER_PASSWORD: "prueba-123" } }); // sin claves: proveedor fake
  server = createServer(createApp(ctx));
  ctx.hub = createHub({ server, sessions: ctx.sessions, bus: ctx.bus });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { ctx.hub.close(); server.close(); });

test("health abierto; el resto exige token", async () => {
  assert.equal((await call("/health", { tk: null })).status, 200);
  assert.equal((await call("/api/status", { tk: null })).status, 401);
});

test("login, status, chat fake y tarea directa", async () => {
  assert.equal((await call("/api/auth/login", { method: "POST", body: { password: "mala" }, tk: null })).status, 401);
  const r = await call("/api/auth/login", { method: "POST", body: { password: "prueba-123" }, tk: null });
  assert.equal(r.status, 200);
  token = (await r.json()).token;
  const st = await (await call("/api/status")).json();
  assert.equal(st.keyless, true);
  assert.ok(st.providers.some((p) => p.id === "fake"));
  const chat = await (await call("/api/chat", { method: "POST", body: { text: "¿cómo estás?" } })).json();
  assert.equal(chat.status, "ok");
  assert.equal(chat.provider, "fake");
  const exact = "  tal cual\r\n🚀  ";
  const d = await (await call("/api/chat", { method: "POST", body: { text: "/claude " + exact } })).json();
  assert.equal(d.status, "tarea");
  const list = await (await call("/api/tasks")).json();
  assert.equal(list.tasks[0].text, exact);
  assert.equal((await call("/api/agent/claim", { method: "POST", tk: null })).status, 401);
});

test("nota secreta por la API no guarda nada; token de atajo solo sirve en /api/shortcut", async () => {
  const s = await (await call("/api/memory/notes", { method: "POST", body: { body: "pin", level: "secreta" } })).json();
  assert.equal(s.saved, false);
  const dev = await (await call("/api/devices", { method: "POST", body: { name: "Atajo", kind: "shortcut" } })).json();
  assert.equal((await call("/api/status", { tk: dev.token })).status, 403);
  const sc = await call("/api/shortcut", { method: "POST", body: { text: "hola" }, tk: dev.token });
  assert.equal(sc.status, 200);
  assert.equal((await call("/api/shortcut", { method: "POST", body: { text: "hola" } })).status, 403);
});

test("WebSocket: exige auth en el primer mensaje y recibe eventos", async () => {
  const url = base.replace("http", "ws") + "/ws";
  const ws = new WebSocket(url);
  const msgs = [];
  ws.onmessage = (e) => msgs.push(JSON.parse(e.data));
  await new Promise((r) => (ws.onopen = r));
  ws.send(JSON.stringify({ type: "auth", token }));
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(msgs[0].type, "auth.ok");
  await call("/api/approvals", { method: "POST", body: { kind: "git_push", summary: "git push origin main" } });
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(msgs.some((m) => m.type === "approval.request"));
  assert.ok(msgs.some((m) => m.type === "state" && m.state === "permiso"));
  ws.close();
  const bad = new WebSocket(url);
  const closed = new Promise((r) => (bad.onclose = (e) => r(e.code)));
  await new Promise((r) => (bad.onopen = r));
  bad.send(JSON.stringify({ type: "auth", token: "falso" }));
  assert.equal(await closed, 4401);
});

test("/api/tts exige auth y sin claves responde 204 para usar la voz del navegador", async () => {
  assert.equal((await call("/api/tts", { method: "POST", body: { text: "hola" }, tk: null })).status, 401);
  const r = await call("/api/tts", { method: "POST", body: { text: "Buenos días, señor." } });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("x-voice"), "browser");
  assert.equal((await call("/api/tts", { method: "POST", body: { text: "" } })).status, 400);
});
