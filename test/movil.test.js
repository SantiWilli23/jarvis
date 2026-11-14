import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createDb } from "../server/db/client.js";
import { buildContext } from "../server/context.js";
import { createApp } from "../server/app.js";

const web = (f) => readFileSync(new URL(`../web/${f}`, import.meta.url), "utf8");
let server, base;
before(async () => {
  const ctx = await buildContext({ db: createDb({ url: ":memory:" }), env: { OWNER_PASSWORD: "prueba-123" } });
  server = createServer(createApp(ctx));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test("m.html trae todos los ids que usan main.js, panels.js y movil.js (sin repetirse)", () => {
  const html = web("m.html");
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, "ids repetidos en m.html: " + ids.filter((x, i) => ids.indexOf(x) !== i));
  for (const f of ["js/main.js", "js/panels.js", "js/movil.js", "js/movil-pro.js"]) {
    const used = new Set([...web(f).matchAll(/\$\("([^"]+)"\)/g)].map((m) => m[1]));
    assert.ok(used.size > 5, f);
    for (const id of used) assert.ok(ids.includes(id), `${f} usa $("${id}") pero m.html no lo tiene`);
  }
  // index.html sigue siendo la referencia de main.js/panels.js
  const idx = [...web("index.html").matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  for (const f of ["js/main.js", "js/panels.js"]) for (const m of web(f).matchAll(/\$\("([^"]+)"\)/g)) assert.ok(idx.includes(m[1]), `index.html: ${m[1]}`);
});

test("GET /m responde 200 con la vista móvil; / sigue siendo el HUD de escritorio", async () => {
  const m = await fetch(base + "/m");
  assert.equal(m.status, 200);
  const t = await m.text();
  assert.match(t, /class="movil"/);
  assert.match(t, /css\/movil\.css/);
  const d = await (await fetch(base + "/")).text();
  assert.match(d, /css\/hud\.css/);
  assert.ok(!/css\/movil\.css/.test(d));
  assert.match(d, /js\/vista\.js/); // la redirección a /m (solo teléfonos) vive en un archivo propio por la CSP
  assert.match(await (await fetch(base + "/js/vista.js")).text(), /location\.replace\("\/m"\)/);
  assert.equal((await fetch(base + "/apple-touch-icon.png")).headers.get("content-type"), "image/png");
});

test("service worker y manifiesto al día", () => {
  const sw = web("sw.js");
  assert.match(sw, /jarvis-shell-v10/);
  for (const p of ['"/m"', '"/css/movil.css"', '"/js/movil.js"']) assert.ok(sw.includes(p), p);
  const mf = JSON.parse(web("manifest.webmanifest"));
  assert.equal(mf.id, "/"); assert.equal(mf.scope, "/"); assert.equal(mf.theme_color, "#080b10"); assert.equal(mf.background_color, "#080b10");
  assert.ok(mf.icons.some((i) => i.sizes === "180x180" && i.type === "image/png"));
  const png = readFileSync(new URL("../web/apple-touch-icon.png", import.meta.url));
  assert.equal(png.readUInt32BE(16), 180); assert.equal(png.readUInt32BE(20), 180);
});
