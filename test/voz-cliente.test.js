// Voz del cliente (sin navegador): cola de partes, respaldo del navegador y corte.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

let pedidos, sonado, leido, respuestas, voces, callado;
const tic = () => new Promise((r) => setTimeout(r, 5));
globalThis.window = {
  speechSynthesis: {
    getVoices: () => voces,
    speak: (u) => { leido.push({ texto: u.text, voz: u.voice?.name }); setImmediate(() => u.onend()); },
    cancel: () => {},
  },
};
globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
globalThis.Audio = class {
  play() { if (!this.src.startsWith("data:")) { sonado.push(this.src); if (!callado) setImmediate(() => this.onended?.()); } return Promise.resolve(); }
  pause() {}
};
globalThis.fetch = async (url, o = {}) => {
  pedidos.push({ url, metodo: o.method || "GET", signal: o.signal });
  const estado = respuestas[url] ?? 200;
  return { status: estado, blob: async () => new Blob(["x"]) };
};
const { speak, stopSpeaking, ocupado, createCorte } = await import("../web/js/voice.js");
const decir = (msg, priv, voz) => new Promise((r) => speak(msg, r, priv, voz));
const VOZ = { partes: [{ id: "a", texto: "Uno." }, { id: "b", texto: "Dos." }] };

beforeEach(() => { stopSpeaking(); pedidos = []; sonado = []; leido = []; respuestas = {}; callado = false; voces = [{ name: "Jorge", lang: "es-ES", localService: true }]; });

test("con partes: pide todas a la vez y las reproduce en orden sin POST", async () => {
  const fin = decir("Uno. Dos.", false, VOZ);
  assert.deepEqual(pedidos.map((p) => p.url), ["/api/tts/a", "/api/tts/b"]);
  await fin;
  assert.equal(sonado.length, 2);
  assert.equal(leido.length, 0);
  assert.equal(ocupado(), false);
});

test("una parte sin audio se lee con la voz del navegador y sigue la cola", async () => {
  respuestas["/api/tts/a"] = 204;
  await decir("Uno. Dos.", false, VOZ);
  assert.deepEqual(leido.map((l) => l.texto), ["Uno."]);
  assert.equal(sonado.length, 1);
  respuestas["/api/tts/b"] = 404; leido = [];
  await decir("Uno. Dos.", false, VOZ);
  assert.deepEqual(leido.map((l) => l.texto), ["Uno.", "Dos."]);
});

test("cortar detiene toda la cola", async () => {
  callado = true; // el primer audio no termina solo
  let fin = false;
  speak("Uno. Dos.", () => { fin = true; }, false, VOZ);
  await tic();
  stopSpeaking();
  await tic();
  assert.equal(sonado.length, 1);
  assert.equal(leido.length, 0);
  assert.equal(fin, false);
  assert.ok(pedidos.every((p) => p.signal.aborted));
});

test("sin voz o con texto privado usa POST /api/tts como antes", async () => {
  await decir("Hola.", false);
  await decir("Secreto.", true, VOZ);
  assert.deepEqual(pedidos.map((p) => `${p.metodo} ${p.url}`), ["POST /api/tts", "POST /api/tts"]);
});

// Corte por silencio: muestras cada 80 ms.
function medir(tramos) {
  let t = 0;
  const corte = createCorte({ silencioMs: 1500, now: () => t });
  for (const [nivel, ms] of tramos) for (let i = 0; i < ms; i += 80) { t += 80; const r = corte.paso(nivel); if (r) return { r, t }; }
  return { r: null, t };
}

test("corte: 1,5 s de silencio después de oír voz, aunque hable desde el primer instante", () => {
  for (const previo of [[[30, 800]], []]) {
    const antes = previo.length ? 800 : 0;
    const { r, t } = medir([...previo, [3000, 2000], [30, 5000]]);
    assert.equal(r, "silencio");
    assert.ok(t - antes - 2000 >= 1400 && t - antes - 2000 <= 1700, String(t));
  }
});

test("corte: sin voz a los 8 s, también en una sala ruidosa; sin señal no decide", () => {
  for (const ruido of [20, 900]) {
    const { r, t } = medir([[ruido, 20000]]);
    assert.equal(r, "sin_voz");
    assert.ok(t >= 8000 && t <= 8200);
  }
  assert.equal(medir([[0, 20000]]).r, null);
});

test("corte: en sala ruidosa se adapta y las pausas cortas no cortan", () => {
  assert.equal(medir([[900, 800], [6000, 1000], [900, 1000], [6000, 1000], [900, 1000]]).r, null);
  assert.equal(medir([[900, 800], [6000, 1000], [900, 2000]]).r, "silencio");
});

test("privado: solo una voz local; sin ninguna local no se lee", async () => {
  respuestas["/api/tts"] = 204;
  const nube = { name: "Alvaro Online (Natural)", lang: "es-ES", localService: false };
  voces = [nube, { name: "Helena", lang: "es-ES", localService: true }];
  await decir("Nota.", true);
  assert.deepEqual(leido.map((l) => l.voz), ["Helena"]);
  voces = [nube, { name: "Zira", lang: "en-US", localService: true }, { name: "SinDato", lang: "es-ES" }];
  leido = [];
  await decir("Nota.", true);
  assert.equal(leido.length, 0);
  assert.equal(ocupado(), false);
  await decir("Público.", false);
  assert.equal(leido.length, 1);
});
