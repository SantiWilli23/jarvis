import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

globalThis.document ??= { body: { setAttribute() {} } }; // setState solo marca el body
const { crearDictado, crearLector, textoLegible, leerActivo } = await import("../web/js/voz-ui.js");
delete globalThis.document;

const web = (f) => readFileSync(new URL("../web/" + f, import.meta.url), "utf8");
const msg = (id, kind, text, extra = {}) => ({ id, kind, text, author: "jarvis", ...extra });

test("el dictado entrega el texto, avisa a la música y no envía", async () => {
  globalThis.document = { body: { setAttribute() {} } };
  const textos = [], estados = [], errores = [];
  const d = crearDictado({
    alTexto: (t) => textos.push(t), alError: (e) => errores.push(e), puede: () => true,
    grabar: async () => ({ stop: async () => ({ size: 5000 }) }),
    transcribir: async () => ({ text: " arregla el login " }),
    estado: (s) => estados.push(s),
  });
  await d.alternar();
  assert.equal(d.fase(), "grabando");
  await d.alternar();
  delete globalThis.document;
  assert.deepEqual(textos, ["arregla el login"]);
  assert.deepEqual(estados, ["listening", "thinking", "idle"]);
  assert.deepEqual(errores, []);
  assert.equal(d.fase(), "libre");
});

test("el botón de micrófono no envía el formulario", () => {
  for (const [html, id] of [["index.html", "pro-mic"], ["m.html", "mpro-mic"]]) assert.match(web(html), new RegExp(`<button type="button" id="${id}"`));
  assert.ok(!/requestSubmit|\.submit\(|\/messages/.test(web("js/voz-ui.js")));
});

test("solo se leen mensajes permitidos, sin código, diffs ni privados", () => {
  for (const k of ["coordinador", "sistema", "resultado"]) assert.equal(textoLegible(msg(1, k, "Listo, señor.")), "Listo, señor.");
  for (const k of ["texto", "plan", "informe", "verificacion", "consulta", "propuesta", "prompt"]) assert.equal(textoLegible(msg(1, k, "x")), "", k);
  assert.equal(textoLegible(msg(1, "sistema", "x", { author: "claude" })), "");
  assert.equal(textoLegible(msg(1, "sistema", "secreto", { meta: { private: true } })), "");
  const t = textoLegible(msg(1, "coordinador", "Hecho.\n```js\nconst clave = 1;\n```\nUse `npm test`.\n+ añadida\nFin.\ndiff --git a/x b/x\nsecreto"));
  assert.equal(t, "Hecho. Use . Fin.");
});

test("el lector no lee el historial y solo habla si está activado", () => {
  assert.equal(leerActivo(), false); // apagado por defecto, y sin localStorage no falla
  const dicho = [];
  let on = true;
  const l = crearLector({ hablar: (t, fin) => { dicho.push(t); fin(); }, callar: () => {}, activo: () => on });
  const msgs = [msg(1, "coordinador", "viejo")];
  l.revisar(7, msgs);
  msgs.push(msg(2, "resultado", "nuevo"), msg(3, "informe", "no"));
  l.revisar(7, msgs);
  l.revisar(7, msgs);
  on = false;
  msgs.push(msg(4, "sistema", "apagado"));
  l.revisar(7, msgs);
  on = true;
  l.revisar(7, msgs);
  l.revisar(8, [msg(9, "sistema", "otro hilo")]);
  assert.deepEqual(dicho, ["nuevo"]);
});
