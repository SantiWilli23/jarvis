// Service worker: cáscara desde caché con revalidación, sin tocar datos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const web = (f) => new URL(`../web/${f}`, import.meta.url);
const fuente = readFileSync(web("sw.js"), "utf8");

function montar() {
  const guardado = new Map(), oyentes = {}, pedidos = [];
  const red = { responder: () => ({ ok: true, cuerpo: "nuevo" }) };
  const cache = { match: async (k) => guardado.get(k), put: async (k, v) => { guardado.set(k, v); } };
  const self = { addEventListener: (t, fn) => { oyentes[t] = fn; } };
  const fetch = async (p) => { pedidos.push(p); const r = red.responder(); return { ...r, clone: () => r }; };
  new Function("self", "caches", "fetch", "location", fuente)(self, { open: async () => cache }, fetch, { origin: "https://j.test" });
  async function pedir(ruta, method = "GET") {
    let respuesta = null, fondo = null;
    oyentes.fetch({ request: { url: "https://j.test" + ruta, method }, respondWith: (p) => { respuesta = p; }, waitUntil: (p) => { fondo = p; } });
    const r = respuesta && await respuesta;
    await fondo;
    return r;
  }
  return { guardado, pedidos, red, pedir };
}

test("sirve la copia al instante y la renueva por detrás; un 404 o sin red no la pisan", async () => {
  const s = montar();
  assert.equal((await s.pedir("/m?debug=1")).cuerpo, "nuevo"); // sin copia: de la red
  s.guardado.set("/js/main.js", { cuerpo: "viejo" });
  assert.equal((await s.pedir("/js/main.js")).cuerpo, "viejo");
  assert.equal(s.guardado.get("/js/main.js").cuerpo, "nuevo");
  s.red.responder = () => ({ ok: false, cuerpo: "404" });
  await s.pedir("/js/main.js");
  assert.equal(s.guardado.get("/js/main.js").cuerpo, "nuevo");
  s.red.responder = () => { throw new Error("sin red"); };
  assert.equal((await s.pedir("/js/main.js")).cuerpo, "nuevo");
});

test("nunca atiende /api, /ws, datos ni envíos", async () => {
  const s = montar();
  for (const r of ["/api/status", "/api/tts/abc", "/health", "/ws", "/oauth/info", "/mcp", "/vendor/ort/ort.wasm"]) assert.equal(await s.pedir(r), null, r);
  assert.equal(await s.pedir("/", "POST"), null);
  assert.equal(s.pedidos.length, 0);
  assert.equal(s.guardado.size, 0);
});

test("todo script y estilo propio de las páginas existe y está en la cáscara", () => {
  for (const html of ["index.html", "m.html", "estudio.html"]) {
    for (const [, ruta] of readFileSync(web(html), "utf8").matchAll(/(?:src|href)="\/?((?:js|css)\/[^"]+)"/g)) {
      assert.ok(existsSync(web(ruta)), `${html}: ${ruta}`);
      assert.ok(fuente.includes(`"/${ruta}"`), `sw.js sin /${ruta} (${html})`);
    }
  }
});

test("todo el JavaScript de web/ se puede analizar (main.js no se importa en otras pruebas)", () => {
  for (const f of readdirSync(web("js/"), { recursive: true }).filter((x) => x.endsWith(".js"))) {
    execFileSync(process.execPath, ["--check", fileURLToPath(web(`js/${f.replaceAll("\\", "/")}`))], { stdio: "pipe" });
  }
});
