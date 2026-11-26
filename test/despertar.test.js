// "Hey Jarvis": cadena de detección, antirrebote y control de la escucha, con modelos y Electron falsos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDetector, BLOQUE } from "../desktop/wake/detector.js";
import { createEscucha } from "../desktop/wake/escucha.js";

function falsos(puntaje = () => 0.9, opciones = {}) {
  const visto = { mel: [], embed: [], clasificar: [] };
  const d = createDetector({
    mel: async (a) => { visto.mel.push(a); return new Float32Array(8 * 32).fill(10); },
    embed: async (m) => { visto.embed.push(m); return new Float32Array(96).fill(visto.embed.length); },
    clasificar: async (e) => { visto.clasificar.push(e); return puntaje(); },
    ...opciones,
  });
  return { d, visto };
}
const bloques = async (d, n) => { let oidos = 0; for (let i = 0; i < n; i++) if (await d.procesar(new Float32Array(BLOQUE))) oidos++; return oidos; };

test("cadena: formas, contexto, transformación del mel y calentamiento", async () => {
  const { d, visto } = falsos(() => 0);
  await d.procesar(new Float32Array(BLOQUE).fill(7));
  await bloques(d, 15);
  assert.equal(visto.mel[0].length, 480 + BLOQUE);
  assert.equal(visto.mel[1][0], 7); // arrastra el final del bloque anterior
  assert.equal(visto.embed[0].length, 76 * 32);
  assert.equal(visto.embed[0][0], 1);          // relleno inicial
  assert.equal(visto.embed[0].at(-1), 3);      // 10 / 10 + 2
  assert.equal(visto.clasificar.length, 1);    // solo tras 16 embeddings
  assert.equal(visto.clasificar[0].length, 16 * 96);
  assert.equal(visto.clasificar[0][0], 1);
  assert.equal(visto.clasificar[0].at(-1), 16);
});

test("acumula trozos de cualquier tamaño", async () => {
  const { d, visto } = falsos();
  for (let i = 0; i < 5; i++) await d.procesar(new Float32Array(512));
  assert.equal(visto.mel.length, 2);
});

test("umbral y antirrebote", async () => {
  assert.equal(await bloques(falsos(() => 0.49).d, 40), 0);
  const { d } = falsos(() => 0.5, { refractarioMs: 800 }); // 10 bloques
  assert.equal(await bloques(d, 16), 1);
  assert.equal(await bloques(d, 9), 0);
  assert.equal(await bloques(d, 1), 1);
  d.reiniciar(); // vuelve a calentar
  assert.equal(await bloques(d, 15), 0);
  assert.equal(await bloques(d, 1), 1);
});

test("reiniciar descarta lo que estaba en vuelo", async () => {
  const { d } = falsos();
  await bloques(d, 15);
  const enVuelo = d.procesar(new Float32Array(BLOQUE));
  d.reiniciar();
  assert.equal(await enVuelo, false);
});

test("escucha: pausa mientras Jarvis está ocupado, ignora ajenos y apagar suelta la ventana", async () => {
  let ocupado = true, despertares = 0, ventana;
  const oyentes = {};
  class Ventana {
    constructor() { ventana = this; this.destruida = false; this.webContents = { on() {} }; }
    loadFile() { return Promise.resolve(); }
    isDestroyed() { return this.destruida; }
    destroy() { this.destruida = true; }
  }
  const e = createEscucha({
    BrowserWindow: Ventana, ipcMain: { on: (n, f) => { oyentes[n] = f; } }, cada: 5,
    crearDetectores: async () => [{ procesar: async () => true, reiniciar() {} }],
    ocupado: async () => ocupado, alDespertar: () => despertares++, alError: () => assert.fail("sin errores"),
  });
  const esperar = () => new Promise((r) => setTimeout(r, 30));
  const enviar = async (sender = ventana.webContents) => { oyentes["wake:audio"]({ sender }, new Float32Array(BLOQUE)); await new Promise((r) => setImmediate(r)); };
  assert.equal(e.encendida(), false);
  await e.encender();
  await esperar();
  await enviar();
  assert.equal(despertares, 0); // ocupado
  ocupado = false;
  await esperar();
  await enviar({});
  assert.equal(despertares, 0); // no es la ventana de captura
  await enviar();
  assert.equal(despertares, 1);
  e.apagar();
  assert.equal(ventana.destruida, true);
  assert.equal(e.encendida(), false);
});

test("escucha: apagar mientras carga no abre el micrófono", async () => {
  let soltar, abiertas = 0;
  const e = createEscucha({
    BrowserWindow: class { constructor() { abiertas++; } }, ipcMain: { on() {} },
    crearDetectores: () => new Promise((r) => { soltar = r; }), ocupado: async () => false, alDespertar() {}, alError() {},
  });
  const carga = e.encender();
  e.apagar();
  soltar([]);
  await carga;
  assert.equal(abiertas, 0);
});
