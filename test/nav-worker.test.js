import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createNavWorker, parseNavResult } from "../desktop/runner/nav-worker.js";
import { buildNavArgs, NAV_PERMITIDAS } from "../desktop/runner/claude-args.js";
import { urlPermitida, urlsDeHerramienta, normalizeEvent } from "../desktop/runner/claude-runner.js";
import { createHubClient } from "../desktop/runner/hub-client.js";
import { checkChrome } from "../desktop/runner/doctor.js";
import { createWorker } from "../desktop/runner/worker.js";

const fx = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const CLAUDE = { command: process.execPath, prefix: [join(fx, "fake-claude.mjs")] };
const C = "mcp__claude-in-chrome__";

function setup(env = {}) {
  const out = join(mkdtempSync(join(tmpdir(), "nav-out-")), "f");
  for (const k of ["FAKE_MODE", "FAKE_EDIT", "FAKE_RESULT", "FAKE_EMPTY", "FAKE_SLEEP_MS", "FAKE_ERR_MODEL", "FAKE_ERR_TEXT", "FAKE_TOOLS", "FAKE_HANG_MS"]) delete process.env[k];
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
  assert.equal(await createNavWorker({ hub, claude: CLAUDE, ...o }).tick(), "tarea");
  assert.equal(hub.results.length, 1);
  return { out, r: hub.results[0] };
}
const flag = (a, f) => a[a.indexOf(f) + 1];

test("argumentos: chrome, sonnet y solo las herramientas del contrato", () => {
  const a = buildNavArgs({ maxTurns: 25 });
  for (const f of ["-p", "--chrome", "--verbose"]) assert.ok(a.includes(f));
  assert.equal(flag(a, "--output-format"), "stream-json");
  assert.equal(flag(a, "--model"), "sonnet");
  assert.equal(flag(a, "--max-turns"), "25");
  assert.ok(!a.includes("--dangerously-skip-permissions"));
  const permitidas = flag(a, "--allowedTools").split(",");
  assert.deepEqual(permitidas, ["ToolSearch", ...["tabs_context_mcp", "tabs_create_mcp", "navigate", "read_page", "get_page_text", "find", "computer", "form_input"].map((n) => C + n)]);
  const prohibidas = flag(a, "--disallowedTools").split(",");
  for (const n of [C + "javascript_tool", C + "file_upload", C + "upload_image", "Bash", "PowerShell", "Edit", "Write", "Read", "WebFetch", "WebSearch", "Agent"]) {
    assert.ok(prohibidas.includes(n), n);
    assert.ok(!NAV_PERMITIDAS.includes(n), n);
  }
});

test("ok: prompt por stdin, carpeta temporal borrada, resultado con fuentes", async () => {
  const { out, r } = await correr({
    FAKE_RESULT: "Hecho.\n" + bloque({ estado: "ok", respuesta: "Una estrella de neutrones.", fuentes: [{ titulo: "W", url: "https://es.wikipedia.org/x" }, { titulo: "mala", url: "javascript:alert(1)" }] }),
    FAKE_TOOLS: JSON.stringify([{ name: C + "navigate", input: { url: "chatgpt.com", tabId: 1 } }]),
  });
  assert.deepEqual(r, { id: 7, estado: "ok", respuesta: "Una estrella de neutrones.", fuentes: [{ titulo: "W", url: "https://es.wikipedia.org/x" }], error: null });
  assert.match(readFileSync(`${out}.0.stdin`, "utf8"), /¿Qué es un púlsar\?/);
  const args = JSON.parse(readFileSync(`${out}.0.args.json`, "utf8"));
  assert.ok(!args.some((a) => a.includes("púlsar")), "la consulta no va en la línea de comando");
  const { cwd } = JSON.parse(readFileSync(`${out}.0.cwd.json`, "utf8"));
  assert.match(cwd, /jarvis-nav-/);
  assert.ok(!existsSync(cwd));
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
  const w = createNavWorker({ hub: mkHub(tarea()), claude: CLAUDE });
  const p = w.tick();
  assert.equal(await w.tick(), "ocupado");
  assert.equal(await p, "tarea");
  assert.equal(await w.tick(), "vacio");
  const sin = createNavWorker({ hub: { navClaim: async () => { throw Object.assign(new Error("HTTP 404"), { status: 404 }); } } });
  assert.equal(await sin.tick(), "vacio");
});

test("el bucle atiende nav solo con las colas clásica y Pro vacías", async () => {
  const orden = [];
  let clasicas = 1, pros = 1, listo;
  const fin = new Promise((r) => { listo = r; });
  const hub = {
    hello: async () => ({}), heartbeat: async () => {}, bye: async () => {},
    claim: async () => (clasicas-- > 0 ? { task: { id: 1, seq: 1, text: "x", sha256: "no" } } : { task: null }),
    finish: async () => { orden.push("clasica"); },
  };
  const w = createWorker({
    hub, pollMs: 5,
    pro: { tick: async () => (pros-- > 0 ? (orden.push("pro"), "job") : "vacio") },
    nav: { tick: async () => { orden.push("nav"); listo(); return "vacio"; } },
  });
  w.start();
  await fin;
  await w.stop();
  assert.deepEqual(orden.slice(0, 3), ["clasica", "pro", "nav"]);
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
  assert.deepEqual(llamadas, [["http://h/api/agent/nav/claim", "POST", "{}"], ["http://h/api/agent/nav/5/result", "POST", "{\"estado\":\"ok\"}"]]);
});

test("doctor: capacidad chrome", async () => {
  const ex = (help, logged) => async (b, a) => (a[0] === "--help" ? help : JSON.stringify({ loggedIn: logged }));
  const cb = { command: "c", prefix: [] };
  assert.deepEqual(await checkChrome(cb, { ex: ex("  --chrome   Enable", true) }), { ok: true, error: null });
  assert.equal((await checkChrome(cb, { ex: ex("  --no-chrome  Disable", true) })).error, "sin_chrome");
  assert.equal((await checkChrome(cb, { ex: ex("  --chrome   Enable", false) })).error, "sin_login");
  assert.equal((await checkChrome(null)).error, "sin_claude");
});
