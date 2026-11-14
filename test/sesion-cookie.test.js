import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createDb } from "../server/db/client.js";
import { buildContext } from "../server/context.js";
import { createApp } from "../server/app.js";
import { confirmarSesion } from "../web/js/sesion.js";

let server, base;
before(async () => {
  const ctx = await buildContext({ db: createDb({ url: ":memory:" }), env: { OWNER_PASSWORD: "prueba-cookie-1" } });
  server = createServer(createApp(ctx));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const login = (headers = {}) => fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ password: "prueba-cookie-1" }) });
const cookieDe = (res) => res.headers.getSetCookie().find((c) => c.startsWith("jarvis_sid="));

test("login pone la cookie jarvis_sid con los atributos correctos (Secure solo en https)", async () => {
  const res = await login();
  const { token } = await res.json();
  const c = cookieDe(res);
  assert.ok(c.startsWith("jarvis_sid=" + token));
  for (const a of ["HttpOnly", "SameSite=Strict", "Path=/", "Max-Age=31536000"]) assert.ok(c.includes(a), a);
  assert.ok(!c.includes("Secure"));
  const s = cookieDe(await login({ "x-forwarded-proto": "https" }));
  assert.ok(s.includes("; Secure"));
});

test("la cookie autentica GET /auth/me sin Authorization", async () => {
  const res = await login(); const { token } = await res.json();
  const me = await fetch(base + "/api/auth/me", { headers: { cookie: "jarvis_sid=" + token } });
  assert.equal(me.status, 200);
  assert.equal((await fetch(base + "/api/auth/me", { headers: { cookie: "jarvis_sid=falso" } })).status, 401);
  assert.equal((await fetch(base + "/api/auth/me")).status, 401);
  // con cabecera Authorization manda el bearer (uno malo no se rescata con la cookie)
  assert.equal((await fetch(base + "/api/auth/me", { headers: { authorization: "Bearer malo", cookie: "jarvis_sid=" + token } })).status, 401);
});

test("mutación solo con cookie sin x-requested-with da 403; con la cabecera pasa", async () => {
  const { token } = await (await login()).json();
  const cookie = "jarvis_sid=" + token;
  const sin = await fetch(base + "/api/settings", { method: "PUT", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ modo: "ia" }) });
  assert.equal(sin.status, 403);
  const con = await fetch(base + "/api/settings", { method: "PUT", headers: { cookie, "content-type": "application/json", "x-requested-with": "jarvis" }, body: JSON.stringify({ modo: "ia" }) });
  assert.notEqual(con.status, 403); assert.notEqual(con.status, 401);
  // con bearer no hace falta la cabecera
  const b = await fetch(base + "/api/settings", { method: "PUT", headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: JSON.stringify({ modo: "ia" }) });
  assert.notEqual(b.status, 403);
});

test("restore devuelve el token solo con cookie válida y la cabecera", async () => {
  const { token } = await (await login()).json();
  const h = { "x-requested-with": "jarvis" };
  const ok = await fetch(base + "/api/auth/restore", { method: "POST", headers: { ...h, cookie: "jarvis_sid=" + token } });
  assert.equal(ok.status, 200); assert.equal((await ok.json()).token, token);
  assert.equal((await fetch(base + "/api/auth/restore", { method: "POST", headers: { cookie: "jarvis_sid=" + token } })).status, 403);
  assert.equal((await fetch(base + "/api/auth/restore", { method: "POST", headers: h })).status, 401);
  assert.equal((await fetch(base + "/api/auth/restore", { method: "POST", headers: { ...h, cookie: "jarvis_sid=nope" } })).status, 401);
  assert.equal((await fetch(base + "/api/auth/restore", { method: "POST", headers: { ...h, authorization: "Bearer " + token } })).status, 401); // solo cookie
});

test("logout borra la cookie y revoca la sesión", async () => {
  const { token } = await (await login()).json();
  const out = await fetch(base + "/api/auth/logout", { method: "POST", headers: { cookie: "jarvis_sid=" + token, "x-requested-with": "jarvis", "content-type": "application/json" }, body: "{}" });
  assert.equal(out.status, 200);
  assert.match(cookieDe(out), /^jarvis_sid=; .*Max-Age=0/);
  assert.equal((await fetch(base + "/api/auth/me", { headers: { authorization: "Bearer " + token } })).status, 401);
  assert.equal((await fetch(base + "/api/auth/restore", { method: "POST", headers: { "x-requested-with": "jarvis", cookie: "jarvis_sid=" + token } })).status, 401);
});

test("cliente: un 401 suelto o un fallo de red no cierran la sesión; dos 401 seguidos sí", async () => {
  const sec = (...r) => { let i = 0; return async () => { const v = r[Math.min(i++, r.length - 1)]; if (v === "red") throw new Error("red"); return v; }; };
  const nada = async () => {};
  assert.equal(await confirmarSesion(sec(401, 200), nada), "valida");
  assert.equal(await confirmarSesion(sec(200), nada), "valida");
  assert.equal(await confirmarSesion(sec(401, 401), nada), "caida");
  assert.equal(await confirmarSesion(sec("red", "red"), nada), "incierta");
  assert.equal(await confirmarSesion(sec(502, 503), nada), "incierta");
  assert.equal(await confirmarSesion(sec(401, "red"), nada), "incierta");
  assert.equal(await confirmarSesion(sec(503, 401), nada), "incierta");
  let esperas = 0; await confirmarSesion(sec(401, 401), async (ms) => { esperas++; assert.equal(ms, 1500); });
  assert.equal(esperas, 1);
});
