// Navegador de Jarvis (lado PC): scripts DOM fijos, controlador asistido y sondeo. Sin Electron ni sitios reales:
// un DOM mínimo en memoria (suficiente para los selectores simples de las pruebas) y relojes falsos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scriptDetectar, scriptPreparar, scriptLeer, detectar, preparar, leer } from "../desktop/browser/dom-scripts.js";
import { runAssist } from "../desktop/browser/assist.js";
import { createBrowserWorker } from "../desktop/browser/worker.js";

// ---- DOM falso mínimo ----
class El {
  constructor(tag, attrs = {}, text = "") { this.tagName = tag.toUpperCase(); this.attrs = attrs; this.textContent = text; this.eventos = []; this.clicks = 0; }
  get innerText() { return this.textContent; }
  focus() {}
  click() { this.clicks++; }
  dispatchEvent(e) { this.eventos.push(e.type); return true; }
}
class Caja extends El {
  constructor(attrs) { super("textarea", attrs); this._v = ""; }
  get value() { return this._v; }
  set value(v) { this._v = v; }
}
function coincide(el, s) {
  const m = /^([a-z]*)(?:#([\w-]+))?(?:\.([\w-]+))?(?:\[(\w+)(\*?)=['"]([^'"]*)['"]\])?$/i.exec(s);
  if (!m) return false;
  const [, tag, id, cls, attr, parcial, val] = m;
  if (tag && el.tagName !== tag.toUpperCase()) return false;
  if (id && el.attrs.id !== id) return false;
  if (cls && !String(el.attrs.class || "").split(" ").includes(cls)) return false;
  if (attr && !(parcial ? String(el.attrs[attr] || "").includes(val) : el.attrs[attr] === val)) return false;
  return true;
}
function pagina({ titulo = "Chat", texto = "", els = [] } = {}) {
  return {
    title: titulo, body: { innerText: texto }, els,
    querySelector(s) { return this.els.find((e) => coincide(e, s)) || null; },
    querySelectorAll(s) { return this.els.filter((e) => coincide(e, s)); },
  };
}
const SEL = { input: ["#caja", "textarea"], respuesta: [".resp"], ocupado: ["#stop"], bloqueo: ["iframe[src*='captcha']"], aviso: [".aviso"], login: ["input[type*='email']"] };
const ejecutar = (doc, codigo) => new Function("document", `return ${codigo}`)(doc); // el MISMO texto que se inyectaría

// Sitio falso con estado: la caja, el botón Enviar (solo lo pulsa "el señor"), generación y respuesta.
function sitioFalso() {
  const caja = new Caja({ id: "caja" }), enviar = new El("button", { id: "enviar" }), stop = new El("button", { id: "stop" });
  const doc = pagina({ els: [caja, enviar] });
  const s = { doc, caja, enviar, polls: 0, generando: 0, enviados: 0,
    usuarioEnvia() { enviar.click(); s.enviados++; doc.els.push(stop); s.generando = 2; },
    tick() { // un sondeo del tiempo pasa
      if (s.generando > 0 && --s.generando === 0) { doc.els.splice(doc.els.indexOf(stop), 1); doc.els.push(new El("div", { class: "resp" }, "Respuesta a: " + caja.value)); }
    } };
  return s;
}
const hubFalso = (rechazaEn = null) => { const pasos = []; return { pasos, step: async (id, b) => { if (rechazaEn === b.estado) throw Object.assign(new Error("x"), { data: { error: "tarea_cerrada" } }); pasos.push(b); return { ok: true }; } }; };
const reloj = () => { let t = 0; const now = () => t; now.add = (ms) => { t += ms; }; return now; };

test("los scripts solo escriben: ni clic, ni submit, ni Enter, ni tocan el botón de enviar", () => {
  const fuente = [detectar, preparar, leer].map((f) => f.toString()).join("\n");
  for (const prohibido of [".click(", "submit", "requestSubmit", "Enter", "KeyboardEvent", "keydown", "keypress", "sel.enviar", "dispatchEvent(new MouseEvent"]) assert.ok(!fuente.includes(prohibido), prohibido);
  const s = sitioFalso();
  ejecutar(s.doc, scriptPreparar(SEL, "hola"));
  assert.equal(s.enviar.clicks, 0);
  assert.equal(s.enviados, 0);
});

test("detectar: sesión, login, captcha, Cloudflare, aviso, sin selector y falso positivo en conversación", () => {
  const caja = new Caja({ id: "caja" });
  assert.equal(ejecutar(pagina({ els: [caja] }), scriptDetectar(SEL)), "sesion_ok");
  assert.equal(ejecutar(pagina({ texto: "Iniciar sesión", els: [new El("input", { type: "password" }), new El("input", { type: "email" })] }), scriptDetectar(SEL)), "necesita_login");
  assert.equal(ejecutar(pagina({ els: [new El("iframe", { src: "x.com/captcha/1" })] }), scriptDetectar(SEL)), "bloqueado");
  assert.equal(ejecutar(pagina({ titulo: "Just a moment...", texto: "Checking your browser" }), scriptDetectar(SEL)), "bloqueado");
  assert.equal(ejecutar(pagina({ texto: "Enter the verification code we sent you" }), scriptDetectar(SEL)), "bloqueado"); // 2FA
  assert.equal(ejecutar(pagina({ els: [caja, new El("div", { class: "aviso" }, "Cuenta limitada")] }), scriptDetectar(SEL)), "bloqueado");
  assert.equal(ejecutar(pagina({ texto: "página rara sin nada" }), scriptDetectar(SEL)), "sin_selector");
  assert.equal(ejecutar(pagina({ texto: "explícame qué es un captcha y cloudflare", els: [caja] }), scriptDetectar(SEL)), "sesion_ok");
});

test("preparar: inserta tal cual (comillas, saltos, intento de inyección) en textarea y en contenteditable", () => {
  const raro = "línea 1\n\"); alert(1); (\"`${x}` </script> 🚀";
  const s = sitioFalso();
  assert.deepEqual(ejecutar(s.doc, scriptPreparar(SEL, raro)), { ok: true });
  assert.equal(s.caja.value, raro);
  assert.ok(s.caja.eventos.includes("input"));
  const ed = new El("div", { id: "ed" });
  const r = ejecutar(pagina({ els: [ed] }), scriptPreparar({ input: ["#ed"] }, raro));
  assert.equal(r.ok, true);
  assert.equal(ed.textContent, raro);
  assert.deepEqual(ejecutar(pagina({}), scriptPreparar(SEL, "x")), { ok: false, motivo: "sin_caja" });
});

test("leer: último mensaje y si sigue generando", () => {
  const d = pagina({ els: [new El("div", { class: "resp" }, "uno"), new El("div", { class: "resp" }, "dos"), new El("button", { id: "stop" })] });
  assert.deepEqual(ejecutar(d, scriptLeer(SEL)), { ocupado: true, n: 2, texto: "dos" });
});

test("flujo asistido: prepara, NO envía, espera al señor y lee la respuesta como dato", async () => {
  const s = sitioFalso(), hub = hubFalso(), now = reloj();
  let listo = 0;
  const sleep = async (ms) => { now.add(ms); if (s.polls++ === 1) s.usuarioEnvia(); s.tick(); }; // el señor pulsa Enviar en el 2.º sondeo
  const out = await runAssist({ task: { id: 7, site: "claude", prompt: "haz una función" }, selectors: SEL, page: { exec: async (c) => ejecutar(s.doc, c) }, hub, limites: { max_pasos: 12, max_segundos: 180 }, sleep, now, onPromptReady: () => { listo++; assert.equal(s.enviados, 0); } });
  assert.equal(out.fin, "respuesta_lista");
  assert.deepEqual(hub.pasos.map((p) => p.estado), ["sesion_ok", "prompt_listo", "respuesta_lista"]);
  assert.equal(hub.pasos.at(-1).texto, "Respuesta a: haz una función");
  assert.equal(listo, 1);
  assert.equal(s.enviados, 1); // solo el envío del "señor"
  assert.ok(hub.pasos.slice(0, 2).every((p) => p.texto === undefined)); // el texto de página solo viaja como dato en respuesta_lista
});

test("necesita login o captcha: se detiene sin escribir nada", async () => {
  for (const [els, esperado] of [[[new El("input", { type: "password" })], "necesita_login"], [[new El("iframe", { src: "a/captcha" })], "bloqueado"]]) {
    const hub = hubFalso(), caja = new Caja({ id: "caja" });
    const doc = pagina({ els: [...els] });
    const out = await runAssist({ task: { id: 1, prompt: "x" }, selectors: SEL, page: { exec: async (c) => ejecutar(doc, c) }, hub, sleep: async () => {}, now: reloj() });
    assert.equal(out.fin, esperado);
    assert.deepEqual(hub.pasos.map((p) => p.estado), [esperado]);
    assert.equal(caja.value, "");
  }
});

test("captcha que aparece a mitad de espera: para y avisa", async () => {
  const s = sitioFalso(), hub = hubFalso(), now = reloj();
  const sleep = async (ms) => { now.add(ms); if (s.polls++ === 1) s.doc.els.push(new El("iframe", { src: "a/captcha" })); };
  const out = await runAssist({ task: { id: 2, prompt: "x" }, selectors: SEL, page: { exec: async (c) => ejecutar(s.doc, c) }, hub, sleep, now });
  assert.equal(out.fin, "bloqueado");
  assert.deepEqual(hub.pasos.map((p) => p.estado), ["sesion_ok", "prompt_listo", "bloqueado"]);
});

test("selector roto: degrada a copiar el prompt y abrir el sitio (sin fallar)", async () => {
  const hub = hubFalso(); const degradadas = [];
  const out = await runAssist({ task: { id: 3, site: "grok", prompt: "hola" }, selectors: SEL, page: { exec: async (c) => ejecutar(pagina({ texto: "página cambiada" }), c) }, hub, degrade: async (t) => degradadas.push(t.prompt), sleep: async () => {}, now: reloj() });
  assert.equal(out.fin, "degradado");
  assert.deepEqual(degradadas, ["hola"]);
  assert.deepEqual(hub.pasos.map((p) => p.estado), ["degradado"]);
  // Caja detectada pero que no acepta el texto: también degrada.
  const hub2 = hubFalso(), rota = new Caja({ id: "caja" }); Object.defineProperty(rota, "value", { get: () => "", set: () => {} });
  const out2 = await runAssist({ task: { id: 4, prompt: "hola" }, selectors: SEL, page: { exec: async (c) => ejecutar(pagina({ els: [rota] }), c) }, hub: hub2, degrade: async () => {}, sleep: async () => {}, now: reloj() });
  assert.equal(out2.fin, "degradado");
});

test("Detener, rechazo del servidor y tiempo máximo cortan el ciclo", async () => {
  let parar = false;
  const s1 = sitioFalso(), h1 = hubFalso(), n1 = reloj();
  const o1 = await runAssist({ task: { id: 5, prompt: "x" }, selectors: SEL, page: { exec: async (c) => ejecutar(s1.doc, c) }, hub: h1, sleep: async (ms) => { n1.add(ms); parar = true; }, shouldStop: () => parar, now: n1 });
  assert.equal(o1.fin, "detenido");
  assert.equal(h1.pasos.at(-1).estado, "bloqueado");

  const s2 = sitioFalso(), h2 = hubFalso("prompt_listo");
  const o2 = await runAssist({ task: { id: 6, prompt: "x" }, selectors: SEL, page: { exec: async (c) => ejecutar(s2.doc, c) }, hub: h2, sleep: async () => {}, now: reloj() });
  assert.equal(o2.fin, "rechazado");

  const s3 = sitioFalso(), h3 = hubFalso(), n3 = reloj();
  const o3 = await runAssist({ task: { id: 8, prompt: "x" }, selectors: SEL, page: { exec: async (c) => ejecutar(s3.doc, c) }, hub: h3, limites: { max_segundos: 180 }, sleep: async (ms) => { n3.add(ms); }, now: n3 });
  assert.equal(o3.fin, "vencida"); // el señor nunca envió: 180 s y se acaba
  assert.ok(n3() >= 180_000);
});

test("tope de pasos del controlador", async () => {
  const s = sitioFalso(), h = hubFalso();
  const o = await runAssist({ task: { id: 9, prompt: "x" }, selectors: SEL, page: { exec: async (c) => ejecutar(s.doc, c) }, hub: h, limites: { max_pasos: 1 }, sleep: async () => {}, now: reloj() });
  assert.equal(o.fin, "rechazado");
  assert.equal(h.pasos.length, 1);
});

test("sondeo: apagado → espera; sitio desconocido → error; la URL del servidor se ignora", async () => {
  const sels = JSON.parse(readFileSync(new URL("../desktop/browser/selectors.json", import.meta.url), "utf8"));
  const pasos = [];
  let respuesta = { task: null, reason: "inactivo" };
  const hub = { browserClaim: async () => respuesta, browserStep: async (id, b) => { pasos.push([id, b.estado]); return { ok: true }; } };
  const cargadas = [];
  const win = { cargar: async (id) => { cargadas.push(id); }, page: () => ({ exec: async () => "bloqueado" }), degradar() {}, alFrente() {}, estado() {} };
  const w = createBrowserWorker({ hub, win, selectors: sels, sleep: async () => {}, now: reloj() });
  await w.uno();
  assert.deepEqual(cargadas, []);
  respuesta = { task: { id: 1, site: "inventado", url: "https://malo.example", prompt: "x" }, limites: {} };
  await w.uno();
  assert.deepEqual(pasos, [[1, "error"]]);
  respuesta = { task: { id: 2, site: "claude", url: "https://malo.example", particion: "persist:otra", prompt: "x" }, limites: {} };
  await w.uno();
  assert.deepEqual(cargadas, ["claude"]); // carga el sitio de la tabla local
  assert.deepEqual(pasos.at(-1), [2, "bloqueado"]);
});

test("selectors.json y window.js: cuatro sitios con partición propia, sin preload, aislados", () => {
  const sels = JSON.parse(readFileSync(new URL("../desktop/browser/selectors.json", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(sels.sitios).sort(), ["chatgpt", "claude", "grok", "perplexity"]);
  assert.equal(sels.sitios.claude.url, "https://claude.ai/code");
  for (const [id, s] of Object.entries(sels.sitios)) {
    assert.equal(s.particion, `persist:${id}`);
    assert.ok(s.url.startsWith("https://"));
    for (const k of ["input", "respuesta", "ocupado", "bloqueo", "login"]) assert.ok(Array.isArray(s[k]), `${id}.${k}`);
  }
  const win = readFileSync(new URL("../desktop/browser/window.js", import.meta.url), "utf8");
  assert.ok(!/preload/i.test(win.replace(/\/\/.*$/gm, "")), "sin preload");
  assert.match(win, /sandbox: true/);
  assert.match(win, /contextIsolation: true/);
  assert.match(win, /nodeIntegration: false/);
  assert.match(win, /executeJavaScriptInIsolatedWorld/);
});
