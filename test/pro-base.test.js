import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { memDb, clock, spy } from "./helpers.js";
import { createDb, all } from "../server/db/client.js";
import { initSchema, migrate } from "../server/db/index.js";
import { createQuota } from "../server/router/quota.js";
import { createRouter } from "../server/router/chain.js";
import { createPrivacy } from "../server/router/privacy.js";
import { buildContext } from "../server/context.js";
import { createApp } from "../server/app.js";
import { createHub } from "../server/ws-hub.js";
import { proReasons } from "../server/pro/index.js";
import { loadProConfig } from "../server/pro/config.js";

test("migración: tablas Pro y approvals.pro_job_id, idempotente", async () => {
  const db = createDb({ url: ":memory:" });
  await initSchema(db); await initSchema(db); await migrate(db);
  const t = (await all(db, "SELECT name FROM sqlite_master WHERE type='table'")).map((r) => r.name);
  for (const n of ["pro_threads", "pro_messages", "pro_rounds", "pro_jobs", "pro_reports", "ai_usage"]) assert.ok(t.includes(n), n);
  assert.ok((await all(db, "PRAGMA table_info(approvals)")).some((c) => c.name === "pro_job_id"));
});

test("onUse recibe el id del proveedor y el usuario", async () => {
  const { db, userId } = await memDb();
  const uses = [];
  const router = createRouter({ providers: { a: spy("a") }, chain: ["a"], quota: createQuota({ db, limits: {}, now: clock() }), privacy: createPrivacy(), onUse: (id, o) => uses.push([id, o]) });
  await router.route({ userId, messages: [{ role: "user", content: "hola" }] });
  assert.deepEqual(uses, [["a", { userId }]]);
});

test("config/pro.json: correcciones máx 2 y sin modelos prohibidos", () => {
  const c = loadProConfig();
  assert.equal(c.limites.correcciones_max, 2);
  assert.ok(!/lite|2\.5-pro|argon|carbon|3.1-pro/.test(JSON.stringify(c.modelos.gemini)));
});

test("proReasons: motivos de no habilitado", () => {
  const cfg = loadProConfig();
  assert.deepEqual(proReasons({ pcOnline: false, caps: null, cfg }), ["pc_apagado", "claude_no_listo", "sin_repos_git"]);
  const caps = { claude: { ok: true, modelos: ["claude-opus-5-5", "claude-sonnet-5-5"] }, gemini_cli: { ok: true, login: "google" }, repos: ["C:/r"] };
  assert.deepEqual(proReasons({ pcOnline: true, caps, cfg }), []);
  assert.deepEqual(proReasons({ pcOnline: true, caps: { ...caps, claude: { ok: true, modelos: ["claude-opus-5-5"] } }, cfg }), ["claude_modelo_no_disponible"]);
  assert.deepEqual(proReasons({ pcOnline: true, caps: { ...caps, claude: { ok: false, error: "sin_login", modelos: [] } }, cfg }), ["claude_sin_login"]);
  // Solo Claude: sin Gemini no hay ningún motivo de bloqueo
  assert.deepEqual(proReasons({ pcOnline: true, caps: { ...caps, gemini_cli: { ok: false }, agy: { ok: false } }, cfg }), []);
});

test("status: conexiones {id,nombre,ok,usa}, Claude (PC), conn.using y status.pro", async () => {
  const db = createDb({ url: ":memory:" });
  const now = clock();
  const ctx = await buildContext({ db, env: { OWNER_PASSWORD: "x" }, now });
  const evs = []; ctx.bus.on("conn.using", (e) => evs.push(e));
  let s = await ctx.status(ctx.ownerId);
  const pc = s.connections.find((c) => c.id === "claude_pc");
  assert.deepEqual([pc.nombre, pc.ok, pc.usa], ["Claude (PC)", false, false]);
  for (const c of s.connections) assert.ok(c.id && c.nombre && typeof c.ok === "boolean" && typeof c.usa === "boolean");
  const { web: webPro, local_visible: lv, ...proBase } = s.pro; assert.equal(lv, false); assert.equal(webPro.habilitado, false); assert.deepEqual(proBase, { habilitado: false, motivos: ["pc_apagado", "claude_no_listo", "sin_repos_git"], avisos: ["gemini_apagado"], gemini: { activo: false, listo: false } });
  await ctx.router.route({ userId: ctx.ownerId, messages: [{ role: "user", content: "hola" }] });
  assert.equal(evs.length, 1);
  assert.equal(evs[0].userId, ctx.ownerId);
  now.advance(7000);
  assert.ok((await ctx.status(ctx.ownerId)).connections.every((c) => !c.usa));
  ctx.bus.emit("pc.using", { userId: ctx.ownerId });
  assert.equal((await ctx.status(ctx.ownerId)).connections.find((c) => c.id === "claude_pc").usa, true);
  ctx.config.motores_pc.gemini.activo = true; ctx.pro.config.local_visible = true; // encendido a mano
  await ctx.agent.hello(ctx.ownerId, { capabilities: { claude: { ok: true, modelos: ["claude-opus-5-5", "claude-sonnet-5-5"] }, gemini_cli: { ok: true, login: "google" }, repos: ["C:/r"] } });
  s = await ctx.status(ctx.ownerId);
  assert.equal(s.pro.habilitado, true);
  assert.equal(s.connections.find((c) => c.id === "claude_pc").ok, true);
});

test("usageToday incluye ai_usage; rutas /api/pro y /api/agent/pro montadas", async () => {
  const db = createDb({ url: ":memory:" });
  const ctx = await buildContext({ db, env: { OWNER_PASSWORD: "x" } }); ctx.config.motores_pc.gemini.activo = true; ctx.pro.config.local_visible = true;
  await db.execute({ sql: "INSERT INTO ai_usage (user_id, day, engine, model, tokens_in, tokens_out, created_at) VALUES (?,?,?,?,?,?,?)", args: [ctx.ownerId, new Date().toISOString().slice(0, 10), "gemini", "m", 3, 4, Date.now()] });
  assert.deepEqual((await ctx.agent.usageToday(ctx.ownerId)).ai, { gemini: { tokens: 7, llamadas: 1 } });
  const server = createServer(createApp(ctx));
  ctx.hub = createHub({ server, sessions: ctx.sessions, bus: ctx.bus });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = { "content-type": "application/json" };
  const tk = (await (await fetch(base + "/api/auth/login", { method: "POST", headers: json, body: JSON.stringify({ password: "x" }) })).json()).token;
  const pcTk = (await (await fetch(base + "/api/devices", { method: "POST", headers: { ...json, authorization: `Bearer ${tk}` }, body: JSON.stringify({ name: "PC", kind: "pc" }) })).json()).token;
  const h = (t) => ({ headers: { authorization: `Bearer ${t}` } });
  assert.equal((await fetch(base + "/api/pro/status")).status, 401);
  assert.equal((await fetch(base + "/api/pro/status", h(tk))).status, 200);
  assert.equal((await fetch(base + "/api/agent/pro/status", h(tk))).status, 403);
  assert.equal((await fetch(base + "/api/agent/pro/status", h(pcTk))).status, 200);
  ctx.hub.close(); server.close();
});
