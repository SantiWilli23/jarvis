import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const web = (f) => readFileSync(new URL(`../web/${f}`, import.meta.url), "utf8");
const ids = (f) => [...web(f).matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);

test("acciones-pc.js: sin innerHTML, escucha pc.actions y accion.resultado, usa la API del PC", () => {
  const js = web("js/acciones-pc.js");
  assert.ok(!/innerHTML|insertAdjacentHTML/.test(js));
  for (const s of ["pc.actions", "accion.resultado", "/pc/actions", "/approve", "textContent"]) assert.ok(js.includes(s), s);
});

test("el contenedor #pcacc existe una sola vez en m.html (pestaña PC de Control) y en index.html", () => {
  for (const f of ["m.html", "index.html"]) assert.equal(ids(f).filter((x) => x === "pcacc").length, 1, f);
  const m = web("m.html");
  assert.match(m, /aria-label="Control"/);
  assert.match(m, /data-ctab="ios"[^>]*>iPhone/); assert.match(m, /data-ctab="pc"[^>]*>PC/);
  assert.match(m, /<span>Control<\/span>/);
  assert.equal((m.match(/<button type="button" data-open="/g) || []).length, 8, "barra inferior (4 + micrófono) y los 4 accesos de Más");
  assert.match(web("index.html"), /js\/acciones-pc\.js/);
  assert.match(web("js/movil.js"), /acciones-pc\.js/);
  for (const f of ["m.html", "index.html"]) { const l = ids(f); assert.equal(new Set(l).size, l.length, f); }
});

test("showApproval distingue al PC", () => {
  const p = web("js/panels.js");
  assert.ok(p.includes("El PC pide permiso") && p.includes("Claude pide permiso"));
  assert.match(p, /startsWith\("pc:"\)/);
});

test("el service worker guarda acciones-pc.js y sube de versión", () => {
  const sw = web("sw.js");
  assert.ok(sw.includes('"/js/acciones-pc.js"'));
  assert.match(sw, /jarvis-shell-v26/);
});
