import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createDb } from "../server/db/client.js";
import { buildContext } from "../server/context.js";
import { createApp } from "../server/app.js";
import { createHub } from "../server/ws-hub.js";

let server, base, ctx, web, clock = Date.now();
const sent = [], failWith = new Map();
const fakeWebpush = {
  generateVAPIDKeys: () => ({ publicKey: "PUB" + Math.random(), privateKey: "PRIV" }),
  async sendNotification(sub, payload, opts) {
    if (failWith.has(sub.endpoint)) throw Object.assign(new Error("gone"), { statusCode: failWith.get(sub.endpoint) });
    sent.push({ sub, payload: JSON.parse(payload), opts });
  },
};
const call = (path, { method = "GET", body, tk = web } = {}) =>
  fetch(base + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(tk ? { authorization: `Bearer ${tk}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const sub = (n) => ({ endpoint: `https://push.example/${n}`, keys: { p256dh: "p" + n, auth: "a" + n } });

before(async () => {
  ctx = await buildContext({ db: createDb({ url: ":memory:" }), env: { OWNER_PASSWORD: "prueba-123" }, now: () => clock, webpush: fakeWebpush });
  server = createServer(createApp(ctx));
  ctx.hub = createHub({ server, sessions: ctx.sessions, bus: ctx.bus });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  web = (await ctx.sessions.create(ctx.ownerId, { name: "t", kind: "web" })).token;
});
after(() => { ctx.hub.close(); server.close(); });

test("VAPID se genera una vez y se reutiliza; requiere sesión web", async () => {
  assert.equal((await call("/api/push/vapid", { tk: null })).status, 401);
  const a = await (await call("/api/push/vapid")).json();
  const b = await (await call("/api/push/vapid")).json();
  assert.ok(a.publicKey.startsWith("PUB"));
  assert.equal(a.publicKey, b.publicKey);
  const phoneTk = (await ctx.sessions.create(ctx.ownerId, { name: "p", kind: "phone" })).token;
  assert.equal((await call("/api/push/vapid", { tk: phoneTk })).status, 403);
});

test("suscribir, validar y borrar", async () => {
  assert.equal((await call("/api/push/subscribe", { method: "POST", body: { subscription: { endpoint: "http://x" } } })).status, 400);
  assert.equal((await call("/api/push/subscribe", { method: "POST", body: { subscription: sub(1) } })).status, 201);
  assert.equal((await call("/api/push/subscribe", { method: "POST", body: { subscription: sub(1) } })).status, 201); // sin duplicar
  assert.equal(await ctx.push.count(ctx.ownerId), 1);
  const d = await (await call("/api/push/subscribe", { method: "DELETE", body: { endpoint: sub(1).endpoint } })).json();
  assert.equal(d.borradas, 1);
  assert.equal(await ctx.push.count(ctx.ownerId), 0);
});

test("una aprobación pendiente envía push sin contenido privado; 410 borra la suscripción", async () => {
  await call("/api/push/subscribe", { method: "POST", body: { subscription: sub(2) } });
  await call("/api/push/subscribe", { method: "POST", body: { subscription: sub(3) } });
  failWith.set(sub(3).endpoint, 410);
  sent.length = 0;
  await ctx.approvals.request({ userId: ctx.ownerId, kind: "x", summary: "SECRETO privado", detail: "detalle privado" });
  await wait(80);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.body, "Aprobación pendiente");
  assert.ok(!JSON.stringify(sent[0].payload).includes("SECRETO"));
  assert.equal(sent[0].opts.vapidDetails.subject, "mailto:jarvis@localhost");
  assert.equal(await ctx.push.count(ctx.ownerId), 1); // la 410 se limpió
});

test("una acción del teléfono que pide aprobación también avisa", async () => {
  sent.length = 0;
  const r = await ctx.phone.create({ userId: ctx.ownerId, action: "modo_avion", args: { valor: "on" } });
  assert.equal(r.item.status, "aprobacion");
  await wait(80);
  assert.equal(sent.length, 1);
});

// ---- despertador ----
async function nudgeCtx(env, { connected = true, fail = false } = {}) {
  const mails = [];
  const c = await buildContext({ db: createDb({ url: ":memory:" }), env: { OWNER_PASSWORD: "x", ...env }, now: () => clock, webpush: null });
  c.google.connected = async () => connected;
  c.google.sendEmail = async (_u, m) => { if (fail) throw new Error("boom"); mails.push(m); return {}; };
  return { c, mails };
}
const audits = async (c, a) => (await c.db.execute({ sql: "SELECT detail FROM audit_log WHERE action=?", args: [a] })).rows;

test("despertador: asunto JARVIS·nonce, cuerpo sin datos, solo a PHONE_NUDGE_EMAIL; agrupa en 60 s", async () => {
  const { c, mails } = await nudgeCtx({ PHONE_NUDGE_EMAIL: "yo@icloud.com" });
  assert.equal(await c.despertador.configurado(c.ownerId), true);
  const r = await c.phone.create({ userId: c.ownerId, action: "linterna", args: { valor: "on" } });
  assert.equal(r.item.status, "lista");
  await wait(50);
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, "yo@icloud.com");
  assert.match(mails[0].subject, /^JARVIS·[0-9a-f]{12}$/);
  assert.equal(mails[0].body, "Jarvis");
  await c.phone.create({ userId: c.ownerId, action: "linterna", args: { valor: "off" } });
  await wait(50);
  assert.equal(mails.length, 1, "agrupado");
  clock += 61_000;
  await c.phone.create({ userId: c.ownerId, action: "vibrar" });
  await wait(50);
  assert.equal(mails.length, 2);
  assert.notEqual(mails[0].subject, mails[1].subject);
  assert.equal((await audits(c, "phone.despertador_enviado")).length, 2);
});

test("despertador: límite de 20 por hora", async () => {
  const { c, mails } = await nudgeCtx({ PHONE_NUDGE_EMAIL: "yo@icloud.com" });
  for (let i = 0; i < 25; i++) { clock += 61_000; await c.despertador.nudge(c.ownerId); }
  assert.equal(mails.length, 20);
  assert.ok((await audits(c, "phone.despertador_omitido")).some((r) => /límite/.test(r.detail)));
});

test("despertador: sin PHONE_NUDGE_EMAIL o sin Gmail no hace nada ni falla", async () => {
  const a = await nudgeCtx({});
  assert.equal(await a.c.despertador.configurado(a.c.ownerId), false);
  const r = await a.c.phone.create({ userId: a.c.ownerId, action: "linterna", args: { valor: "on" } });
  assert.equal(r.ok, true);
  await wait(50);
  assert.equal(a.mails.length, 0);
  assert.equal((await audits(a.c, "phone.despertador_omitido")).length, 1);
  const b = await nudgeCtx({ PHONE_NUDGE_EMAIL: "yo@icloud.com" }, { connected: false });
  assert.equal((await b.c.despertador.nudge(b.c.ownerId)).sent, false);
  const f = await nudgeCtx({ PHONE_NUDGE_EMAIL: "yo@icloud.com" }, { fail: true });
  assert.equal((await f.c.despertador.nudge(f.c.ownerId)).sent, false);
});

test("despertador: una acción aprobada dispara el correo; las que esperan aprobación no", async () => {
  const { c, mails } = await nudgeCtx({ PHONE_NUDGE_EMAIL: "yo@icloud.com" });
  clock += 3_600_000;
  const r = await c.phone.create({ userId: c.ownerId, action: "modo_avion", args: { valor: "on" } });
  await wait(50);
  assert.equal(mails.length, 0);
  await c.approvals.decide(c.ownerId, r.item.approval_id, true);
  await wait(80);
  assert.equal(mails.length, 1);
});

test("GET /api/phone/despertador refleja la configuración", async () => {
  const j = await (await call("/api/phone/despertador")).json();
  assert.equal(j.configurado, false);
});
