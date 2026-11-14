import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { memDb, clock } from "./helpers.js";
import { createSessions, WEB_TTL_MS } from "../server/auth/sessions.js";
import { createApp, csp } from "../server/app.js";
import { createWhatsApp } from "../server/connectors/whatsapp.js";
import { buildArgs } from "../desktop/runner/claude-args.js";
import { DENEGADAS_CLAUDE, rutaProtegida } from "../desktop/runner/secret-paths.js";
import { guardTool } from "../desktop/runner/agy-policy.js";

test("cola normal: Claude no lee secretos ni escribe guardianes (con y sin carpetas)", () => {
  for (const folders of [[], ["C:/a"]]) {
    const a = buildArgs({ task: { header: {} }, folders });
    const lista = a[a.indexOf("--disallowedTools") + 1].split(",");
    assert.deepEqual(lista, DENEGADAS_CLAUDE);
    for (const r of ["Read(**/.env)", "Read(**/.env.*)", "Read(**/*.pem)", "Read(**/*.key)", "Read(**/*.p12)", "Write(**/.env)",
      "Edit(**/desktop/runner/danger.js)", "Write(**/config/permissions.json)", "Edit(**/desktop/runner/claude-args.js)", "Edit(**/desktop/runner/agy-policy.js)", "Edit(**/desktop/runner/agy-args.js)"]) {
      assert.ok(lista.includes(r), r);
    }
  }
});

test("Gemini: rutas secretas o guardianes se bloquean aunque estén en la carpeta permitida", () => {
  assert.equal(rutaProtegida("C:\\x\\.env"), "secreto");
  assert.equal(rutaProtegida("/a/b/id.PEM"), "secreto");
  assert.equal(rutaProtegida("C:\\j\\desktop\\runner\\danger.js"), "guardian");
  assert.equal(rutaProtegida("/a/notas.txt"), null);
  const dirs = ["C:/j"];
  assert.ok(guardTool({ tool: "view_file", params: { AbsolutePath: "C:/j/.env" } }, dirs, "C:/j"));
  assert.ok(guardTool({ tool: "write_to_file", params: { TargetFile: "C:/j/desktop/runner/danger.js" } }, dirs, "C:/j"));
  assert.equal(guardTool({ tool: "view_file", params: { AbsolutePath: "C:/j/notas.md" } }, dirs, "C:/j"), null);
});

test("sesión web caduca a los 90 días, se renueva con el uso; pc/phone no caducan; revocar sigue", async () => {
  const { db, userId } = await memDb();
  const now = clock();
  const s = createSessions({ db, now });
  const web = await s.create(userId, { kind: "web" });
  const pc = await s.create(userId, { kind: "pc" });
  const ph = await s.create(userId, { kind: "phone" });
  const exp = (await db.execute("SELECT kind, expires_at FROM devices ORDER BY id")).rows;
  assert.equal(Number(exp[0].expires_at), now() + WEB_TTL_MS);
  assert.equal(exp[1].expires_at, null); assert.equal(exp[2].expires_at, null);
  now.advance(WEB_TTL_MS - 1000);
  assert.ok(await s.verify(web.token)); // y se renueva
  now.advance(WEB_TTL_MS - 1000);
  assert.ok(await s.verify(web.token), "renovada por uso");
  now.advance(WEB_TTL_MS + 1000); // 90 días sin usarse
  assert.equal(await s.verify(web.token), null);
  assert.ok(await s.verify(pc.token)); assert.ok(await s.verify(ph.token));
  assert.equal(await s.revoke(userId, (await s.list(userId))[2].id), true);
  assert.equal(await s.verify(ph.token), null);
});

async function boot(env = {}) {
  const old = { ...process.env }; Object.assign(process.env, env);
  const { db } = await memDb();
  const ctx = { db, sessions: createSessions({ db }), limiter: (await import("../server/auth/ratelimit.js")).createLoginLimiter({ db }), audit: { log: async () => {} }, hub: null };
  const server = createServer(createApp(ctx));
  await new Promise((r) => server.listen(0, r));
  return { base: `http://127.0.0.1:${server.address().port}`, db, close: () => { server.close(); process.env = old; } };
}

test("bloqueo de contraseña por IP, no por cuenta; X-Forwarded-For solo con proxy de confianza", async () => {
  for (const [env, confia] of [[{ TRUST_PROXY: "0" }, false], [{ TRUST_PROXY: "1" }, true]]) {
    const s = await boot(env);
    try {
      await s.db.execute({ sql: "UPDATE users SET password_hash = 'scrypt$1$x$y' WHERE id = 1" });
      const login = (ip) => fetch(s.base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ password: "mala" }) });
      for (let i = 0; i < 5; i++) assert.equal((await login("9.9.9.9")).status, 401);
      assert.equal((await login("9.9.9.9")).status, 429); // misma IP bloqueada
      // otra IP "declarada": si el proxy es de confianza es otra persona (no bloqueada); si no, es la misma conexión
      assert.equal((await login("8.8.8.8")).status, confia ? 401 : 429);
    } finally { s.close(); }
  }
});

test("el bloqueo ya no es por cuenta: otra IP no queda bloqueada por fallos ajenos", async () => {
  const { db } = await memDb();
  const lim = (await import("../server/auth/ratelimit.js")).createLoginLimiter({ db });
  for (let i = 0; i < 5; i++) await lim.record(["ip:1.1.1.1"], false);
  assert.equal((await lim.check(["ip:1.1.1.1"])).locked, true);
  assert.equal((await lim.check(["ip:2.2.2.2"])).locked, false);
});

test("WhatsApp: sin WHATSAPP_APP_SECRET queda apagado y el webhook rechaza", async () => {
  const base = { WHATSAPP_TOKEN: "t", WHATSAPP_PHONE_ID: "1", WHATSAPP_VERIFY_TOKEN: "v" };
  const sin = createWhatsApp({ env: base, db: null, ownerId: 1 });
  assert.equal(sin.enabled, false);
  assert.equal(sin.verifyChallenge({ "hub.mode": "subscribe", "hub.verify_token": "v", "hub.challenge": "1" }), null);
  assert.equal(sin.validSignature(Buffer.from("x"), "sha256=00"), false);
  assert.equal(createWhatsApp({ env: { ...base, WHATSAPP_APP_SECRET: "s" }, db: null, ownerId: 1 }).enabled, true);
});

test("CSP: cabecera presente, sin script en línea, sin 'unsafe-eval', ws al mismo host", async () => {
  const s = await boot();
  try {
    const r = await fetch(s.base + "/m");
    const h = r.headers.get("content-security-policy");
    assert.equal(h, csp(new URL(s.base).host));
    assert.match(h, /script-src 'self';/); assert.doesNotMatch(h, /unsafe-eval/);
    assert.match(h, /frame-ancestors 'none'/);
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.equal(r.headers.get("referrer-policy"), "no-referrer");
    for (const p of ["/", "/m"]) { // ningún <script> sin src (la CSP los bloquearía)
      const html = await (await fetch(s.base + p)).text();
      assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, p);
      assert.doesNotMatch(html, /\son[a-z]+\s*=/i, p);
    }
  } finally { s.close(); }
});
