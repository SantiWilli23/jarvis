import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createDb } from "../server/db/client.js";
import { buildContext } from "../server/context.js";
import { createApp } from "../server/app.js";
import { parseProIntent, buscarRepo } from "../server/pro-intents.js";
import { hiloDeHash } from "../web/js/pro.js";

let server, base, ctx, web, repos;
const emitted = [];
const call = (path, { method = "GET", body } = {}) =>
  fetch(base + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), authorization: `Bearer ${web}` }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ http: r.status, ...(await r.json()) }));
const decir = (text, extra = {}) => call("/api/chat", { method: "POST", body: { text, ...extra } });
const hilos = async () => (await call("/api/pro/threads")).threads;

before(async () => {
  ctx = await buildContext({ db: createDb({ url: ":memory:" }), env: { OWNER_PASSWORD: "x-123" } });
  const ramas = [{ name: "main", commit: { sha: "a".repeat(40) } }, { name: "dev", commit: { sha: "b".repeat(40) } }];
  Object.assign(ctx.github, {
    enabled: true, cuentas: async () => ["ejemplo"], repos: async () => repos, ramas: async () => ramas,
    prs: async () => [], arbol: async () => ({ truncated: false, archivos: [] }),
  });
  ctx.providers.groq = { enabled: false };
  ctx.bus.on("chat.done", (e) => emitted.push(e));
  server = createServer(createApp(ctx));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  web = (await (await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "x-123" }) })).json()).token;
});
after(() => server.close());
beforeEach(() => { repos = [{ full_name: "ejemplo/mi-app", default_branch: "main" }, { full_name: "ejemplo/otra", default_branch: "dev" }]; });

test("frase: solo la explícita; conserva repo y pedido originales", () => {
  assert.deepEqual(parseProIntent("Crea una sesión Pro en Mi-App: Añade validación: emails"), { repo: "Mi-App", pedido: "Añade validación: emails" });
  assert.deepEqual(parseProIntent("jarvis, créame sesion pro: arregla el botón"), { repo: null, pedido: "arregla el botón" });
  assert.deepEqual(parseProIntent("crea una sesión Pro en el repositorio ejemplo/otra: x"), { repo: "ejemplo/otra", pedido: "x" });
  assert.deepEqual(parseProIntent("crea una sesión pro."), { repo: null, pedido: "" });
  for (const no of ["crea una sesión", "¿cómo crea una sesión Pro?", "crea una sesión de programación: x", "busca crea sesión pro: x", "crea una sesión pro para mañana"]) assert.equal(parseProIntent(no), null, no);
  assert.equal(buscarRepo("mi app", [{ full_name: "ejemplo/mi-app" }]).length, 1);
  assert.equal(hiloDeHash("#pro/12"), 12);
  assert.equal(hiloDeHash("#pro/x"), null);
  assert.equal(hiloDeHash("#aprobacion-1"), null);
});

test("sin repo dicho ni hilos previos: pregunta y no crea nada", async () => {
  const r = await decir("crea una sesión Pro: añade un test");
  assert.equal(r.status, "pro");
  assert.equal(r.pro.error, "falta_repo");
  assert.match(r.reply, /repositorio/);
  assert.equal((await hilos()).length, 0);
});

test("lo privado se rechaza sin crear hilo", async () => {
  for (const [text, extra] of [["crea una sesión Pro en mi-app: guarda mi contraseña", {}], ["crea una sesión Pro en mi-app: añade un test", { private: true }]]) {
    const r = await decir(text, extra);
    assert.equal(r.pro.error, "privado");
    assert.equal(r.private, true);
  }
  assert.equal((await hilos()).length, 0);
});

test("repo desconocido o ambiguo: no crea", async () => {
  assert.equal((await decir("crea una sesión Pro en nada: x")).pro.error, "repo_invalido");
  repos.push({ full_name: "otro/mi-app", default_branch: "main" });
  assert.equal((await decir("crea una sesión Pro en mi app: x")).pro.error, "repo_ambiguo");
  assert.equal((await hilos()).length, 0);
});

test("crea el hilo web, envía el pedido y devuelve pro.thread_id; luego usa el repo del último hilo", async () => {
  const r = await decir("crea una sesión Pro en otra: añade un test de emails");
  assert.equal(r.http, 200);
  assert.ok(r.pro.thread_id);
  assert.equal(r.pro.error, undefined);
  const v = await call(`/api/pro/threads/${r.pro.thread_id}`);
  assert.equal(v.thread.gh_repo, "ejemplo/otra");
  assert.equal(v.thread.gh_rama, "dev");
  assert.ok(v.messages.some((m) => m.author === "usuario" && m.text === "añade un test de emails"));
  assert.equal(v.rounds[0].status, "prompt_listo");
  assert.deepEqual(emitted.at(-1).pro, { thread_id: r.pro.thread_id });
  const s = await decir("crea una sesión Pro: y otro más");
  assert.equal((await call(`/api/pro/threads/${s.pro.thread_id}`)).thread.gh_repo, "ejemplo/otra");
});

test("GitHub apagado: avisa sin crear", async () => {
  const n = (await hilos()).length;
  ctx.github.enabled = false;
  assert.equal((await decir("crea una sesión Pro en mi-app: x")).pro.error, "web_deshabilitado");
  ctx.github.enabled = true;
  assert.equal((await hilos()).length, n);
});
