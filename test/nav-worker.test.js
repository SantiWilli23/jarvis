import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createNavWorker, parseNavResult, probarGuardia, pasosDe, navPrompt, buscarNode } from "../desktop/runner/nav-worker.js";
import { decidir } from "../desktop/runner/nav-guard.js";
import { buildNavArgs, navSettings } from "../desktop/runner/claude-args.js";
import { urlPermitida, urlsDeHerramienta, normalizeEvent } from "../desktop/runner/claude-runner.js";
import { createHubClient } from "../desktop/runner/hub-client.js";
import { checkChrome } from "../desktop/runner/doctor.js";
import { createWorker } from "../desktop/runner/worker.js";

const fx = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const CLAUDE = { command: process.execPath, prefix: [join(fx, "fake-claude.mjs")] };
const C = "mcp__claude-in-chrome__";
const NAV_DIR = join(mkdtempSync(join(tmpdir(), "jarvis-nav-test-")), "nav");

function setup(env = {}) {
  const out = join(mkdtempSync(join(tmpdir(), "nav-out-")), "f");
  for (const k of ["FAKE_MODE", "FAKE_EDIT", "FAKE_RESULT", "FAKE_EMPTY", "FAKE_SLEEP_MS", "FAKE_ERR_MODEL", "FAKE_ERR_TEXT", "FAKE_TOOLS", "FAKE_HANG_MS", "FAKE_STREAM"]) delete process.env[k];
  Object.assign(process.env, { FAKE_OUT: out, ...env });
  return out;
}
const tarea = (o = {}) => ({ id: 7, tipo: "preguntar_ia", sitio: "chatgpt", consulta: "¿Qué es un púlsar?", url_inicial: "https://chatgpt.com/", limites: { hosts: ["chatgpt.com"], timeout_s: 180, max_turnos: 25 }, ...o });
function mkHub(...tasks) {
  const h = { results: [] };
  h.navClaim = async () => ({ task: tasks.shift() || null });
  h.navResult = async (id, b) => { h.results.push({ id, ...b }); return { ok: true }; };
  return h;
}
const bloque = (o) => "```json\n" + JSON.stringify(o) + "\n```";
async function correr(env, t = tarea(), o = {}) {
  const out = setup(env), hub = mkHub(t);
  assert.equal(await createNavWorker({ hub, claude: CLAUDE, navDir: NAV_DIR, ...o }).tick(), "tarea");
  assert.equal(hub.results.length, 1);
  return { out, r: hub.results[0] };
}
const flag = (a, f) => a[a.indexOf(f) + 1];

test("argumentos: chrome, sonnet, guardia por --settings y nada de Chrome pre-aprobado", () => {
  const a = buildNavArgs({ perfil: "ia", maxTurns: 25, settings: "s.json" });
  for (const f of ["-p", "--chrome", "--verbose", "--strict-mcp-config"]) assert.ok(a.includes(f));
  assert.equal(flag(a, "--output-format"), "stream-json");
  assert.equal(flag(a, "--model"), "sonnet");
  assert.equal(flag(a, "--effort"), "low");
  assert.equal(flag(a, "--max-turns"), "25");
  assert.equal(flag(a, "--settings"), "s.json");
  assert.equal(flag(a, "--setting-sources"), "");
  assert.ok(!a.includes("--dangerously-skip-permissions"));
  assert.equal(flag(a, "--allowedTools"), "ToolSearch"); // si el guardia no corre, Chrome queda denegado
  const prohibidas = flag(a, "--disallowedTools").split(",");
  for (const n of [C + "javascript_tool", C + "file_upload", C + "upload_image", "Bash", "PowerShell", "Edit", "Write", "Read", "WebFetch", "WebSearch", "Agent"]) assert.ok(prohibidas.includes(n), n);
  const lectura = flag(buildNavArgs({ perfil: "lectura" }), "--disallowedTools").split(",");
  assert.ok(lectura.includes(C + "form_input") && lectura.includes(C + "computer"));
  assert.ok(!flag(buildNavArgs({ perfil: "escolar", capturas: true }), "--disallowedTools").split(",").includes(C + "computer"));
  assert.throws(() => buildNavArgs({ perfil: "otro" }));
  const h = navSettings({ node: "n", guard: "g", politica: "p" }).hooks.PreToolUse[0];
  assert.equal(h.matcher, ".*");
  assert.deepEqual(h.hooks[0].args, ["g", "--nav-guard", "p"]);
  assert.equal(h.hooks[0].onFailure, "block");
});

test("ok: prompt por stdin, carpeta temporal borrada, resultado con fuentes", async () => {
  const { out, r } = await correr({
    FAKE_RESULT: "Hecho.\n" + bloque({ estado: "ok", respuesta: "Una estrella de neutrones.", fuentes: [{ titulo: "W", url: "https://es.wikipedia.org/x" }, { titulo: "mala", url: "javascript:alert(1)" }] }),
    FAKE_TOOLS: JSON.stringify([{ name: C + "navigate", input: { url: "chatgpt.com", tabId: 1 } }]),
  });
  assert.deepEqual(r, { id: 7, estado: "ok", respuesta: "Una estrella de neutrones.", fuentes: [{ titulo: "W", url: "https://es.wikipedia.org/x" }], session_id: "sesion-falsa-1", error: null });
  assert.match(readFileSync(`${out}.0.stdin`, "utf8"), /¿Qué es un púlsar\?/);
  const args = JSON.parse(readFileSync(`${out}.0.args.json`, "utf8"));
  assert.ok(!args.some((a) => a.includes("púlsar")), "la consulta no va en la línea de comando");
  const { cwd } = JSON.parse(readFileSync(`${out}.0.cwd.json`, "utf8"));
  assert.equal(realpathSync(cwd), realpathSync(NAV_DIR)); // fija (para --resume) y vacía
  assert.deepEqual(readdirSync(NAV_DIR), []);
  assert.ok(!existsSync(args[args.indexOf("--settings") + 1]), "los ajustes de la tarea se borran");
});

for (const [nombre, tool] of [
  ["navigate", { name: C + "navigate", input: { url: "https://malo.example/x" } }],
  ["tabs_create_mcp", { name: C + "tabs_create_mcp", input: { url: "https://chatgpt.com.malo.example" } }],
  ["browser_batch", { name: C + "browser_batch", input: { actions: [{ name: "navigate", input: { url: "file:///C:/x" } }] } }],
]) {
  test(`aborta fuera de la lista (${nombre})`, async () => {
    const t0 = Date.now();
    const { r } = await correr({ FAKE_TOOLS: JSON.stringify([tool]), FAKE_HANG_MS: "30000", FAKE_RESULT: bloque({ estado: "ok", respuesta: "no debe llegar" }) });
    assert.equal(r.estado, "bloqueado");
    assert.equal(r.respuesta, "");
    assert.match(r.error, /no permitida/);
    assert.ok(Date.now() - t0 < 20_000, "el proceso se mató");
  });
}

test("url_inicial fuera de la lista: ni arranca Claude", async () => {
  const { out, r } = await correr({}, tarea({ url_inicial: "https://otro.example/" }));
  assert.equal(r.estado, "bloqueado");
  assert.ok(!existsSync(`${out}.0.stdin`));
});

for (const estado of ["necesita_login", "captcha"]) {
  test(`${estado} se propaga`, async () => {
    const { r } = await correr({ FAKE_RESULT: bloque({ estado, respuesta: "", fuentes: [] }) });
    assert.equal(r.estado, estado);
    assert.equal(r.error, estado);
  });
}

test("JSON mal formado o ausente: error", async () => {
  for (const texto of ["```json\n{estado: ok,\n```", "Listo, sin bloque.", bloque({ estado: "inventado", respuesta: "x" }), bloque({ estado: "ok", respuesta: "" })]) {
    const { r } = await correr({ FAKE_RESULT: texto });
    assert.equal(r.estado, "error", texto);
    assert.match(r.error, /JSON/);
  }
});

test("timeout: mata el proceso y reporta error", async () => {
  const { r } = await correr({ FAKE_HANG_MS: "30000" }, tarea(), { timeoutMs: 1500 });
  assert.equal(r.estado, "error");
  assert.match(r.error, /tiempo/);
});

test("una a la vez; cola vacía y servidor sin la API no fallan", async () => {
  setup({ FAKE_SLEEP_MS: "300", FAKE_RESULT: bloque({ estado: "ok", respuesta: "a" }) });
  const w = createNavWorker({ hub: mkHub(tarea()), claude: CLAUDE, navDir: NAV_DIR });
  const p = w.tick();
  assert.equal(await w.tick(), "ocupado");
  assert.equal(await p, "tarea");
  assert.equal(await w.tick(), "vacio");
  const sin = createNavWorker({ hub: { navClaim: async () => { throw Object.assign(new Error("HTTP 404"), { status: 404 }); } } });
  assert.equal(await sin.tick(), "vacio");
});

test("el bucle atiende nav con la cola clásica vacía y antes que Pro", async () => {
  const orden = [];
  let clasicas = 1, navs = 1, listo;
  const fin = new Promise((r) => { listo = r; });
  const hub = {
    hello: async () => ({}), heartbeat: async () => {}, bye: async () => {},
    claim: async () => (clasicas-- > 0 ? { task: { id: 1, seq: 1, text: "x", sha256: "no" } } : { task: null }),
    finish: async () => { orden.push("clasica"); },
  };
  const w = createWorker({
    hub, pollMs: 5,
    pro: { tick: async () => { orden.push("pro"); listo(); return "vacio"; } },
    nav: { tick: async () => (navs-- > 0 ? (orden.push("nav"), "tarea") : "vacio") },
  });
  w.start();
  await fin;
  await w.stop();
  assert.deepEqual(orden.slice(0, 3), ["clasica", "nav", "pro"]);
});

test("hosts, herramientas y eventos", () => {
  assert.ok(urlPermitida("https://www.google.com/search?q=a", ["google.com"]));
  assert.ok(!urlPermitida("https://mail.google.com", ["google.com"]));
  assert.ok(urlPermitida("https://es.wikipedia.org", ["*.wikipedia.org"]));
  assert.ok(!urlPermitida("https://google.com@malo.example", ["google.com"]));
  assert.ok(!urlPermitida("javascript:alert(1)", ["google.com"]));
  assert.deepEqual(urlsDeHerramienta(C + "computer", { url: "x" }), []);
  assert.equal(normalizeEvent({ type: "assistant", message: { content: [{ type: "tool_use", name: C + "navigate", input: { url: "https://a.b" } }] } })[0].url, "https://a.b");
  assert.equal(parseNavResult("{\"estado\":\"ok\",\"respuesta\":\"sin cercas\"}").respuesta, "sin cercas");
});

test("hub-client: rutas nav", async () => {
  const llamadas = [];
  const hub = createHubClient({ baseUrl: "http://h", token: "t", fetchFn: async (u, o) => { llamadas.push([u, o.method, o.body]); return { ok: true, json: async () => ({ ok: true }) }; } });
  await hub.navClaim();
  await hub.navResult(5, { estado: "ok" });
  await hub.navEvents(5, { pasos: [] });
  assert.deepEqual(llamadas, [["http://h/api/agent/nav/claim", "POST", "{}"], ["http://h/api/agent/nav/5/result", "POST", "{\"estado\":\"ok\"}"], ["http://h/api/agent/nav/5/events", "POST", "{\"pasos\":[]}"]]);
});

test("doctor: capacidad chrome", async () => {
  const ex = (help, logged) => async (b, a) => (a[0] === "--help" ? help : JSON.stringify({ loggedIn: logged }));
  const cb = { command: "c", prefix: [] };
  assert.deepEqual(await checkChrome(cb, { ex: ex("  --chrome   Enable", true) }), { ok: true, error: null });
  assert.equal((await checkChrome(cb, { ex: ex("  --no-chrome  Disable", true) })).error, "sin_chrome");
  assert.equal((await checkChrome(cb, { ex: ex("  --chrome   Enable", false) })).error, "sin_login");
  assert.equal((await checkChrome(null)).error, "sin_claude");
});

// --- v2: perfiles, guardia, eventos y escolar ---
const abierta = { perfil: "lectura", hosts: ["*"], negados: ["accounts.google.com", "paypal.com"], capturas: false, max_paginas: 2 };
const nav = (url) => [C + "navigate", { url }];

test("urlPermitida con *: https público, sin negados, privadas ni localhost", () => {
  const ok = (u) => urlPermitida(u, abierta.hosts, abierta.negados);
  assert.ok(ok("https://es.wikipedia.org/x") && ok("ejemplo.com") && ok("https://8.8.8.8/"));
  for (const u of ["http://ejemplo.com", "https://accounts.google.com/", "https://www.paypal.com", "https://pago.paypal.com", "https://localhost:3000", "localhost:3000",
    "https://127.0.0.1", "https://127.1", "https://2130706433", "https://10.0.0.5", "https://192.168.1.1", "https://172.20.0.1", "https://169.254.169.254",
    "https://[::1]/", "https://router/", "https://nas.local", "file:///c:/x", "chrome://settings", "data:text/html,x"]) assert.ok(!ok(u), u);
  assert.ok(!urlPermitida("https://192.168.0.1", ["192.168.0.1"]));
});

test("guardia: herramientas por perfil, browser_batch y tope de páginas", () => {
  const d = (p, n, i, u) => decidir(p, n, i, u).ok;
  assert.ok(d(abierta, "ToolSearch", {}));
  assert.ok(d(abierta, ...nav("https://ejemplo.com")));
  assert.ok(d(abierta, C + "get_page_text", { tabId: 1 }));
  for (const n of ["computer", "form_input", "javascript_tool", "file_upload", "gif_creator"]) assert.ok(!d(abierta, C + n, { action: "left_click" }), n);
  assert.ok(!d(abierta, "Bash", {}) && !d(abierta, "mcp__otro__x", {}) && !d({}, "ToolSearch", {}));
  const escolar = { perfil: "escolar", hosts: ["*.lirmi.com"], capturas: true };
  assert.ok(d(escolar, C + "computer", { action: "screenshot" }));
  for (const action of ["left_click", "type", "key", "scroll"]) assert.ok(!d(escolar, C + "computer", { action }), action);
  assert.ok(!d({ ...escolar, capturas: false }, C + "computer", { action: "screenshot" }));
  assert.ok(!d(escolar, ...nav("https://ejemplo.com")));
  assert.ok(d({ perfil: "ia", hosts: ["chatgpt.com"] }, C + "computer", { action: "type" }));
  const lote = (...actions) => [C + "browser_batch", { actions }];
  assert.ok(d(abierta, ...lote({ name: "navigate", input: { url: "https://a.com" } }, { name: "get_page_text", input: {} })));
  assert.ok(!d(abierta, ...lote({ name: "get_page_text", input: {} }, { name: "navigate", input: { url: "https://localhost" } })));
  assert.ok(!d(abierta, ...lote({ name: "computer", input: { action: "left_click" } })));
  assert.ok(!d(abierta, ...lote({ name: "browser_batch", input: { actions: [] } })));
  assert.ok(!d(abierta, ...lote()));
  assert.ok(!d(abierta, ...nav("https://a.com"), 2));
  const dos = { name: "navigate", input: { url: "https://a.com" } };
  assert.ok(!d(abierta, ...lote(dos, dos), 1));
});

const GUARDIA = join(dirname(fileURLToPath(import.meta.url)), "..", "desktop", "runner", "nav-guard.js");
const hook = (politica, entrada) => spawnSync(process.execPath, [GUARDIA, "--nav-guard", politica], { input: typeof entrada === "string" ? entrada : JSON.stringify(entrada), encoding: "utf8" });

test("guardia como proceso: permite, bloquea con 2, cuenta páginas y falla cerrado", () => {
  const f = join(mkdtempSync(join(tmpdir(), "nav-pol-")), "p.json");
  writeFileSync(f, JSON.stringify(abierta));
  const llamada = { tool_name: C + "navigate", tool_input: { url: "https://a.com" } };
  for (let i = 0; i < 2; i++) { const r = hook(f, llamada); assert.equal(r.status, 0); assert.match(r.stdout, /"permissionDecision":"allow"/); }
  assert.equal(hook(f, llamada).status, 2, "tercera página con max_paginas 2");
  assert.equal(hook(f, { tool_name: "Bash", tool_input: {} }).status, 2);
  assert.equal(hook(f, "no es json").status, 2);
  assert.equal(hook(f + ".no-existe", llamada).status, 2);
  assert.ok(probarGuardia({ node: process.execPath, guard: GUARDIA, politica: f, env: process.env }));
});

test("si el guardia no arranca, no se llama a Claude", async () => {
  const { out, r } = await correr({}, tarea(), { nodePath: join(tmpdir(), "no-existe-node") });
  assert.equal(r.error, "guardia_no_funciona");
  assert.ok(!existsSync(`${out}.0.stdin`));
});

const uso = (id, name, input) => ({ type: "assistant", message: { content: [{ type: "tool_use", id, name: C + name, input }] } });
const resultado = (id, content) => ({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content }] } });
const STREAM = [
  uso("a", "navigate", { url: "https://chatgpt.com/", tabId: 5 }),
  resultado("a", [{ type: "text", text: 'Tab Context:\n- tabId 5: "Chat" (https://chatgpt.com/c/abc)' }]),
  uso("b", "get_page_text", { tabId: 5 }),
  resultado("b", [{ type: "text", text: 'tabId 9: "falsa" (https://chatgpt.com/c/falsa)' }]),
  uso("c", "computer", { action: "screenshot", tabId: 5 }),
  resultado("c", [{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }]),
];

test("eventos: pasos, captura, url_conversacion vista y session_id", async () => {
  const eventos = [];
  setup({ FAKE_STREAM: JSON.stringify(STREAM), FAKE_HANG_MS: "700", FAKE_RESULT: bloque({ estado: "ok", respuesta: "a", url_conversacion: "https://chatgpt.com/c/inventada" }) });
  const hub = mkHub(tarea({ capturas: true }));
  hub.navEvents = async (id, b) => { eventos.push(b); return { cancelado: false }; };
  await createNavWorker({ hub, claude: CLAUDE, navDir: NAV_DIR, latidoMs: 100 }).tick();
  assert.equal(hub.results[0].url_conversacion, "https://chatgpt.com/c/abc");
  assert.equal(hub.results[0].session_id, "sesion-falsa-1");
  assert.deepEqual(eventos.flatMap((e) => e.pasos), [{ herramienta: "navigate", url: "https://chatgpt.com/" }, { herramienta: "get_page_text", url: null }, { herramienta: "computer", url: null }]);
  assert.deepEqual(eventos.filter((e) => e.frame).map((e) => e.frame), [{ mime: "image/png", data: "AAAA" }]);
  assert.ok(eventos.length > 2, "latido sin pasos");
});

test("cancelar desde el servidor mata a Claude", async () => {
  setup({ FAKE_HANG_MS: "30000" });
  const hub = mkHub(tarea());
  hub.navEvents = async () => ({ cancelado: true });
  const t0 = Date.now();
  await createNavWorker({ hub, claude: CLAUDE, navDir: NAV_DIR, latidoMs: 100 }).tick();
  assert.equal(hub.results[0].estado, "cancelada");
  assert.ok(Date.now() - t0 < 20_000);
});

test("servidor sin la API de events: la tarea sigue", async () => {
  setup({ FAKE_HANG_MS: "400", FAKE_RESULT: bloque({ estado: "ok", respuesta: "a" }) });
  const hub = mkHub(tarea());
  let n = 0;
  hub.navEvents = async () => { n++; throw Object.assign(new Error("HTTP 404"), { status: 404 }); };
  await createNavWorker({ hub, claude: CLAUDE, navDir: NAV_DIR, latidoMs: 50 }).tick();
  assert.equal(hub.results[0].estado, "ok");
  assert.equal(n, 1);
});

test("escolar: authuser, prompt, items y cuenta_visible", async () => {
  const t = tarea({ tipo: "estudio", sitio: "classroom", perfil: "escolar", url_inicial: "https://classroom.google.com/", cuenta: { correo: "ejemplo@example.com" }, limites: { hosts: ["classroom.google.com", "docs.google.com"] } });
  const item = { curso: "Historia", tipo: "tarea", titulo: "Ensayo", fecha: "2026-12-01", url: "javascript:x", resumen: "r" };
  const { out, r } = await correr({ FAKE_RESULT: bloque({ estado: "ok", respuesta: "Una tarea.", cuenta_visible: "ejemplo@example.com", items: [item, { titulo: "" }] }) }, t);
  assert.deepEqual(r.items, [{ ...item, url: "" }]);
  assert.equal(r.cuenta_visible, "ejemplo@example.com");
  const prompt = readFileSync(`${out}.0.stdin`, "utf8");
  assert.match(prompt, /authuser=ejemplo%40example\.com/);
  assert.match(prompt, /tareas pendientes/);
  assert.deepEqual(pasosDe(C + "navigate", { url: "https://classroom.google.com/?authuser=ejemplo%40example.com" }), [{ herramienta: "navigate", url: "https://classroom.google.com/" }]);
});

test("lectura: el corte de respaldo respeta hosts_negados", async () => {
  const t = tarea({ tipo: "investigar", sitio: "google", url_inicial: "https://www.google.com/search?q=a", limites: { hosts: ["*"], hosts_negados: ["paypal.com"] } });
  const { r } = await correr({ FAKE_TOOLS: JSON.stringify([{ name: C + "navigate", input: { url: "https://paypal.com/x" } }]), FAKE_HANG_MS: "30000" }, t);
  assert.equal(r.estado, "bloqueado");
});

test("navPrompt: select con browser_batch y solo herramientas del perfil", () => {
  const sel = (t) => navPrompt(t).match(/select:(\S+)/)[1].split(",");
  const ia = sel(tarea());
  assert.ok(ia.includes(C + "browser_batch") && ia.includes(C + "computer") && !ia.includes(C + "tabs_close_mcp"));
  const lectura = tarea({ tipo: "buscar_google", sitio: "google" });
  assert.ok(sel(lectura).includes(C + "browser_batch"));
  assert.ok(!sel(lectura).includes(C + "computer") && !sel(lectura).includes(C + "form_input"));
  assert.ok(!/computer (wait|screenshot|key|type)/.test(navPrompt(lectura)));
  assert.ok(sel({ ...lectura, capturas: true }).includes(C + "computer"));
  const prohibidas = flag(buildNavArgs({ perfil: "ia" }), "--disallowedTools").split(",");
  assert.ok(ia.every((n) => !prohibidas.includes(n)));
});

test("hook: node del PATH solo con ruta absoluta y fuera de la carpeta actual", () => {
  const dir = mkdtempSync(join(tmpdir(), "nav-node-"));
  const exe = join(dir, process.platform === "win32" ? "node.exe" : "node");
  writeFileSync(exe, "no es un ejecutable");
  const otra = tmpdir();
  assert.equal(buscarNode({ env: { PATH: dir }, cwd: otra }), exe);
  assert.equal(buscarNode({ env: { PATH: dir }, cwd: dir }), null);
  assert.equal(buscarNode({ env: { PATH: "." }, cwd: otra, existe: () => true }), null);
  assert.equal(buscarNode({ env: {}, cwd: otra, existe: () => true }), null);
});

test("hook: si el node del PATH falla, cae a process.execPath; el log no lleva texto ni direcciones", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nav-node-"));
  writeFileSync(join(dir, process.platform === "win32" ? "node.exe" : "node"), "no es un ejecutable");
  const lineas = [];
  const out = setup({ FAKE_RESULT: bloque({ estado: "ok", respuesta: "secreta" }) });
  const env = { ...process.env, PATH: dir };
  delete env.Path;
  const hub = mkHub(tarea());
  await createNavWorker({ hub, claude: CLAUDE, navDir: NAV_DIR, env, log: (m) => lineas.push(m) }).tick();
  assert.equal(hub.results[0].estado, "ok");
  assert.ok(existsSync(`${out}.0.stdin`));
  const todo = lineas.join(" | ");
  for (const m of ["claim", "guardia probado", "spawn", "result", "envío"]) assert.ok(todo.includes(m), m);
  assert.ok(!/púlsar|secreta|https?:/.test(todo));
});
