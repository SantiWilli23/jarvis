import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { createDb } from "../server/db/client.js";
import { buildContext } from "../server/context.js";
import { createApp } from "../server/app.js";
import { createMcp } from "../server/mcp/index.js";
import { TOOLS } from "../server/mcp/tools.js";
import { createBridge, validarBase, TOOLS as TOOLS_PUENTE, AVISO } from "../desktop/mcpb/server/index.js";
import { armar, ARCHIVOS } from "../scripts/make-mcpb.js";
import { clock } from "./helpers.js";

const CB = "https://claude.ai/api/mcp/auth_callback";
const now = clock(Date.now());
let server, base, ctx, web;

async function levantar(activo) {
  const db = createDb({ url: ":memory:" });
  const c = await buildContext({ db, env: { OWNER_PASSWORD: "prueba-123" }, now });
  c.mcp = createMcp({ db, notes: c.notes, search: c.search, privacy: c.privacy, sessions: c.sessions, limiter: c.limiter, audit: c.audit, env: c.env, now, ...(activo === null ? {} : { config: { activo } }) });
  const s = createServer(createApp(c));
  await new Promise((r) => s.listen(0, r));
  return { c, s, url: `http://127.0.0.1:${s.address().port}` };
}
before(async () => {
  ({ c: ctx, s: server, url: base } = await levantar(true));
  web = (await ctx.sessions.create(ctx.ownerId, { name: "web", kind: "web" })).token;
});
after(() => server.close());

const post = (path, body, headers = {}) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const conSesion = () => ({ authorization: `Bearer ${web}` });
const form = (body) => fetch(`${base}/oauth/token`, { method: "POST", body: new URLSearchParams(body) });
const registrar = async (redirect = CB) => post("/oauth/register", { client_name: "Claude", redirect_uris: [redirect] });

async function codigo(clientId, redirect = CB) {
  const verifier = randomBytes(32).toString("base64url");
  const pedido = { response_type: "code", client_id: clientId, redirect_uri: redirect, state: "xyz", code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" };
  const info = await (await fetch(`${base}/oauth/info?${new URLSearchParams(pedido)}`, { headers: conSesion() })).json();
  const r = await (await post("/oauth/approve", { ...pedido, csrf: info.csrf, aprobar: true }, conSesion())).json();
  const url = new URL(r.redirect);
  assert.equal(url.searchParams.get("state"), "xyz");
  return { code: url.searchParams.get("code"), verifier, pedido, info };
}
const canje = (clientId, c, extra = {}) => form({ grant_type: "authorization_code", code: c.code, client_id: clientId, redirect_uri: CB, code_verifier: c.verifier, ...extra });

let cliente, tokenMcp;
const rpc = async (method, params, tk = tokenMcp) => (await post("/mcp", { jsonrpc: "2.0", id: 1, method, params }, { authorization: `Bearer ${tk}` })).json();
const llamar = async (name, args) => (await rpc("tools/call", { name, arguments: args })).result;

test("con activo:false (config del repo) no responden /mcp ni OAuth", async () => {
  const off = await levantar(null);
  try {
    for (const p of ["/mcp", "/.well-known/oauth-authorization-server", "/.well-known/oauth-protected-resource", "/oauth/authorize"]) {
      assert.equal((await fetch(off.url + p)).status, 404, p);
    }
    assert.equal((await fetch(`${off.url}/oauth/register`, { method: "POST" })).status, 404);
  } finally { off.s.close(); }
});

test("metadatos y 401 con resource_metadata", async () => {
  const r = await post("/mcp", { jsonrpc: "2.0", id: 1, method: "ping" });
  assert.equal(r.status, 401);
  assert.match(r.headers.get("www-authenticate"), /resource_metadata="http:\/\/127\.0\.0\.1:\d+\/\.well-known\/oauth-protected-resource"/);
  const pr = await (await fetch(`${base}/.well-known/oauth-protected-resource`)).json();
  assert.equal(pr.resource, `${base}/mcp`);
  const as = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
  assert.deepEqual(as.code_challenge_methods_supported, ["S256"]);
});

test("redirect fuera de la lista blanca se rechaza", async () => {
  for (const u of ["https://malo.example/callback", "https://claude.ai.malo.example/api/mcp/auth_callback", "http://localhost.malo.example:80/callback", "http://127.0.0.1:99999/callback", "http://localhost:3000/otra"]) {
    assert.equal((await registrar(u)).status, 400, u);
  }
  cliente = (await (await registrar()).json()).client_id;
  const q = new URLSearchParams({ response_type: "code", client_id: cliente, redirect_uri: "https://claude.com/api/mcp/auth_callback", code_challenge: "a".repeat(43), code_challenge_method: "S256" });
  const r = await fetch(`${base}/oauth/authorize?${q}`, { redirect: "manual" });
  assert.equal(r.status, 400, "permitida pero no registrada por este cliente");
});

test("flujo OAuth con PKCE; el código no se reutiliza", async () => {
  const c = await codigo(cliente);
  assert.equal(c.info.redirect_uri, CB);
  const pagina = await fetch(`${base}/oauth/authorize?${new URLSearchParams(c.pedido)}`);
  assert.equal(pagina.status, 200);
  assert.match(await pagina.text(), /oauth\.js/);
  const r = await canje(cliente, c);
  assert.equal(r.status, 200);
  tokenMcp = (await r.json()).access_token;
  assert.equal((await canje(cliente, c)).status, 400);
  const init = await rpc("initialize", { protocolVersion: "2025-06-18" });
  assert.equal(init.result.protocolVersion, "2025-06-18");
  assert.deepEqual((await rpc("tools/list")).result.tools.map((t) => t.name), ["memoria_buscar", "memoria_proponer"]);
  assert.deepEqual((await rpc("ping")).result, {});
  assert.equal((await post("/mcp", { jsonrpc: "2.0", method: "notifications/initialized" }, { authorization: `Bearer ${tokenMcp}` })).status, 202);
});

test("verificador, client_id o caducidad incorrectos no dan token; sin PKCE no hay autorización", async () => {
  assert.equal((await canje(cliente, await codigo(cliente), { code_verifier: "b".repeat(43) })).status, 400);
  assert.equal((await canje(cliente, await codigo(cliente), { redirect_uri: "https://claude.com/api/mcp/auth_callback" })).status, 400);
  const viejo = await codigo(cliente);
  now.advance(10 * 60 * 1000 + 1);
  assert.equal((await canje(cliente, viejo)).status, 400);
  const q = new URLSearchParams({ response_type: "code", client_id: cliente, redirect_uri: CB });
  assert.equal((await fetch(`${base}/oauth/authorize?${q}`)).status, 400);
});

test("consentimiento: exige sesión web, cabecera con cookie, CSRF y mismo origen", async () => {
  const { pedido, info } = await codigo(cliente);
  const cookie = { cookie: `jarvis_sid=${web}` };
  const cuerpo = { ...pedido, csrf: info.csrf, aprobar: true };
  assert.equal((await post("/oauth/approve", cuerpo)).status, 401);
  assert.equal((await post("/oauth/approve", cuerpo, cookie)).status, 403);
  assert.equal((await post("/oauth/approve", { ...cuerpo, csrf: "x" }, conSesion())).status, 403);
  assert.equal((await post("/oauth/approve", { ...cuerpo, state: "otro" }, conSesion())).status, 403);
  assert.equal((await post("/oauth/approve", cuerpo, { ...conSesion(), origin: "https://malo.example" })).status, 403);
  assert.equal((await post("/oauth/approve", cuerpo, { authorization: `Bearer ${tokenMcp}` })).status, 403);
});

test("buscar nunca devuelve privadas, escolares, secretas por filtro ni en revisión", async () => {
  const userId = ctx.ownerId;
  await ctx.notes.add({ userId, title: "ok", body: "zanahoria permitida" });
  await ctx.notes.add({ userId, body: "zanahoria NOSALE1", level: "privada" });
  await ctx.notes.add({ userId, body: "zanahoria NOSALE2", origen: "escolar" });
  await ctx.notes.add({ userId, body: "zanahoria NOSALE3 de classroom" });
  await ctx.notes.add({ userId, body: "zanahoria NOSALE4 contraseña del router" });
  await ctx.notes.add({ userId, body: "zanahoria NOSALE5", source: "modelo" });
  const out = (await llamar("memoria_buscar", { consulta: "zanahoria", k: 50 })).content[0].text;
  assert.match(out, /zanahoria permitida/);
  assert.doesNotMatch(out, /NOSALE/);
});

test("buscar: máximo 8 y presupuesto de tokens; auditoría sin contenido", async () => {
  const userId = ctx.ownerId;
  for (let i = 0; i < 12; i++) await ctx.notes.add({ userId, body: `pepino ${i}` });
  assert.equal(JSON.parse((await llamar("memoria_buscar", { consulta: "pepino", k: 99 })).content[0].text).notas.length, 8);
  for (let i = 0; i < 5; i++) await ctx.notes.add({ userId, body: "nabo ".repeat(400) });
  assert.equal(JSON.parse((await llamar("memoria_buscar", { consulta: "nabo", k: 8 })).content[0].text).notas.length, 2);
  const log = JSON.stringify(await ctx.audit.list(userId, 500));
  assert.doesNotMatch(log, /pepino|nabo|zanahoria|NOSALE/);
});

test("proponer: va a revisión con origen mcp y tope de 30 al día, también en paralelo", async () => {
  const rs = await Promise.all(Array.from({ length: 33 }, (_, i) => llamar("memoria_proponer", { texto: `recuerdo ${i}` })));
  assert.equal(rs.filter((r) => !r.isError).length, 30);
  const bandeja = await ctx.inbox.list(ctx.ownerId);
  assert.equal(bandeja.filter((n) => n.origen === "mcp:Claude").length, 30);
  now.advance(24 * 60 * 60 * 1000 + 1);
  assert.ok(!(await llamar("memoria_proponer", { texto: "otro día" })).isError);
});

test("el token mcp no sirve fuera de /mcp y se revoca en Dispositivos", async () => {
  const h = { authorization: `Bearer ${tokenMcp}`, "x-requested-with": "jarvis" };
  for (const p of ["/api/status", "/api/auth/me", "/api/memory/notes", "/api/devices", "/api/chat", "/api/tasks", "/api/agent/claim", "/api/agent/memoria/proponer", "/api/agent/pc/next", "/api/shortcut", "/api/phone/next", "/api/pc/actions", "/api/audit", "/oauth/info"]) {
    for (const method of ["GET", "POST"]) {
      const s = (await fetch(base + p, { method, headers: h })).status;
      assert.ok([401, 403, 404].includes(s), `${method} ${p}: ${s}`);
    }
  }
  assert.equal((await fetch(`${base}/api/auth/restore`, { method: "POST", headers: { cookie: `jarvis_sid=${tokenMcp}`, "x-requested-with": "jarvis" } })).status, 401);
  // y al revés: una sesión web no entra a /mcp
  assert.equal((await post("/mcp", { jsonrpc: "2.0", id: 1, method: "ping" }, conSesion())).status, 401);
  const { devices } = await (await fetch(`${base}/api/devices`, { headers: conSesion() })).json();
  const d = devices.find((x) => x.kind === "mcp" && !x.revoked_at);
  await ctx.sessions.revoke(ctx.ownerId, Number(d.id));
  assert.equal((await post("/mcp", { jsonrpc: "2.0", id: 1, method: "ping" }, { authorization: `Bearer ${tokenMcp}` })).status, 401);
});

test("registro: límite por IP y máximo de 20 clientes", async () => {
  now.advance(60 * 60 * 1000);
  const st = [];
  for (let i = 0; i < 6; i++) st.push((await registrar()).status);
  assert.deepEqual(st, [201, 201, 201, 201, 201, 429]);
  for (let i = 0; i < 20; i++) await ctx.db.execute({ sql: "INSERT INTO oauth_clients (id, redirect_uris, created_at) VALUES (?,?,?)", args: [`relleno${i}`, "[]", now()] });
  now.advance(60 * 60 * 1000);
  assert.equal((await registrar()).status, 429);
});

test("puente stdio: autoriza en el navegador sin token incrustado y reenvía", async () => {
  now.advance(25 * 60 * 60 * 1000); // libera cupo de clientes sin usar
  const dir = mkdtempSync(join(tmpdir(), "mcpb-"));
  try {
    const abrir = async (u) => { // hace de navegador: aprueba con la sesión web
      const pedido = Object.fromEntries(new URL(u).searchParams);
      const info = await (await fetch(`${base}/oauth/info?${new URLSearchParams(pedido)}`, { headers: conSesion() })).json();
      const r = await (await post("/oauth/approve", { ...pedido, csrf: info.csrf, aprobar: true }, conSesion())).json();
      await fetch(r.redirect);
    };
    const p = createBridge({ base, dir, abrir, log: () => {} });
    const primero = await p.manejar({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "memoria_buscar", arguments: { consulta: "x" } } });
    assert.equal(primero.result.content[0].text, AVISO);
    await p.esperar();
    const lista = await p.manejar({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    assert.deepEqual(lista.result.tools, TOOLS);
    assert.equal(await p.manejar({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  assert.throws(() => validarBase("http://malo.example"));
  assert.deepEqual(TOOLS_PUENTE.map((t) => [t.name, Object.keys(t.inputSchema.properties), t.inputSchema.required]),
    TOOLS.map((t) => [t.name, Object.keys(t.inputSchema.properties), t.inputSchema.required]));
});

test("el .mcpb es un zip con solo los archivos previstos", () => {
  const dir = mkdtempSync(join(tmpdir(), "mcpb-"));
  try {
    const buf = readFileSync(armar(join(dir, "x.mcpb")));
    const nombres = [];
    for (let i = 0; buf.readUInt32LE(i) === 0x04034b50;) {
      const comp = buf.readUInt32LE(i + 18), n = buf.readUInt16LE(i + 26);
      const nombre = buf.toString("utf8", i + 30, i + 30 + n);
      const data = inflateRawSync(buf.subarray(i + 30 + n, i + 30 + n + comp));
      assert.deepEqual(data, readFileSync(new URL(`../desktop/mcpb/${nombre}`, import.meta.url)));
      nombres.push(nombre);
      i += 30 + n + comp;
    }
    assert.deepEqual(nombres, ARCHIVOS);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
