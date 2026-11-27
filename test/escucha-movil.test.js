// Escucha permanente de /m: estados y tiempos, WAV, frase de activación y rutas de wasm/modelos (sin red).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMaquina, wav16, quitarFrase } from "../web/js/wake/maquina.js";
import { createDb } from "../server/db/client.js";
import { buildContext } from "../server/context.js";
import { createApp } from "../server/app.js";
import { createWake } from "../server/routes/wake.js";
import { clock } from "./helpers.js";

const VOZ = new Float32Array(1280).fill(3000), CALLADO = new Float32Array(1280).fill(10);

function montar() {
  const now = clock(), ordenes = [];
  const m = createMaquina({ now, alOrden: (a) => ordenes.push(a) });
  const dar = (bloque, ms) => { for (let t = 0; t < ms; t += 80) { now.advance(80); m.audio(bloque); } };
  m.encender();
  dar(CALLADO, 800);
  return { m, dar, ordenes };
}

test("orden: se corta tras 1,5 s de silencio, incluye unos 300 ms previos y recorta el silencio final", () => {
  const { m, dar, ordenes } = montar();
  m.activada();
  dar(VOZ, 1600);
  dar(CALLADO, 1400);
  assert.equal(m.estado(), "orden");
  dar(CALLADO, 200);
  assert.equal(m.estado(), "procesando");
  assert.equal(ordenes.length, 1);
  assert.equal(ordenes[0][0], 10);                       // el previo
  assert.ok(ordenes[0].indexOf(3000) >= 4800 && ordenes[0].indexOf(3000) <= 6400);
  const cola = ordenes[0].length - 1 - ordenes[0].lastIndexOf(3000);
  assert.equal(cola, 6 * 1280);                          // unos 480 ms tras la última voz, no los 1,5 s
});

test("sin voz en 6 s vuelve a esperar sin enviar", () => {
  const { m, dar, ordenes } = montar();
  m.activada();
  dar(CALLADO, 5900);
  assert.equal(m.estado(), "orden");
  dar(CALLADO, 200);
  assert.equal(m.estado(), "esperando");
  assert.equal(ordenes.length, 0);
});

test("máximo 30 s", () => {
  const { m, dar, ordenes } = montar();
  m.activada();
  dar(VOZ, 29900);
  assert.equal(m.estado(), "orden");
  dar(VOZ, 200);
  assert.equal(ordenes.length, 1);
});

test("tras responder: 8 s para seguir, solo cuando la app quede libre", () => {
  const { m, dar, ordenes } = montar();
  m.activada(); dar(VOZ, 800); dar(CALLADO, 3100);
  m.ocupado(true); dar(VOZ, 800);                        // pensando o hablando: no escucha
  m.terminada(true); m.ocupado(true);
  assert.equal(m.estado(), "procesando");
  m.ocupado(false);
  assert.equal(m.estado(), "seguimiento");
  dar(CALLADO, 7900);
  assert.equal(m.estado(), "seguimiento");
  dar(CALLADO, 200);
  assert.equal(m.estado(), "esperando");
  m.activada(); dar(VOZ, 800); dar(CALLADO, 3100);
  m.terminada(true); m.ocupado(false);
  dar(CALLADO, 2000); dar(VOZ, 400);                     // sigue sin repetir "Hey Jarvis"
  assert.equal(m.estado(), "orden");
  dar(CALLADO, 3100);
  assert.equal(ordenes.length, 3);
});

test("ocupada, pausada y apagada descartan lo grabado", () => {
  const { m, dar, ordenes } = montar();
  m.activada(); dar(VOZ, 800); m.ocupado(true);
  assert.equal(m.estado(), "ocupada");
  m.ocupado(false);
  assert.equal(m.estado(), "esperando");
  m.activada(); dar(VOZ, 800); m.pausar(); dar(CALLADO, 5000);
  assert.equal(m.estado(), "pausada");
  m.reanudar(); m.apagar(); m.activada(); dar(VOZ, 800);
  assert.equal(m.estado(), "apagada");
  assert.equal(ordenes.length, 0);
});

test("WAV 16 kHz y frase de activación fuera del texto", () => {
  const w = new DataView(wav16(new Float32Array([0, 40000, -40000])));
  assert.equal(w.byteLength, 50);
  assert.equal(w.getUint32(24, true), 16000);
  assert.equal(w.getInt16(46, true), 32767);
  assert.equal(w.getInt16(48, true), -32768);
  assert.equal(quitarFrase("Hey Jarvis, ¿qué hora es?"), "¿qué hora es?");
  assert.equal(quitarFrase("Jarvis pon música"), "pon música");
  assert.equal(quitarFrase("Hey, Jarvis."), "");
  assert.equal(quitarFrase("dile a Jarvis que no"), "dile a Jarvis que no");
});

test("rutas: wasm público, modelos solo con sesión y con sha256 correcto; descarga una vez", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jw-"));
  const sha = (s) => createHash("sha256").update(s).digest("hex");
  mkdirSync(join(dir, "ort", "dist"), { recursive: true });
  writeFileSync(join(dir, "ort", "package.json"), '{"version":"9.9.9"}');
  writeFileSync(join(dir, "ort", "dist", "ort-wasm-simd-threaded.wasm"), "wasm");
  writeFileSync(join(dir, "ort", "dist", "ort.wasm.bundle.min.mjs"), "export const a = 1;");
  writeFileSync(join(dir, "local.onnx"), "uno");
  const bajadas = [];
  const fetchFalso = async (u) => { bajadas.push(u); return new Response(u.endsWith("remoto.onnx") ? "dos" : "alterado"); };
  const wake = createWake({ env: { ORT_DIR: join(dir, "ort"), WAKE_MODELS_DIR: dir }, tmp: join(dir, "tmp"), fetch: fetchFalso, modelos: { "local.onnx": sha("uno"), "remoto.onnx": sha("dos"), "malo.onnx": sha("tres") } });
  const ctx = await buildContext({ db: createDb({ url: ":memory:" }), env: { OWNER_PASSWORD: "prueba-123" } });
  const server = createServer(createApp({ ...ctx, wake }));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const wasm = await fetch(base + "/vendor/ort/ort.wasm");
    assert.equal(wasm.headers.get("content-type"), "application/wasm");
    assert.equal(await wasm.text(), "wasm");
    assert.equal((await fetch(base + "/vendor/ort/ort.mjs")).status, 200);
    assert.equal((await fetch(base + "/vendor/ort/otro")).status, 404);
    assert.equal(await (await fetch(base + "/js/wake/detector.js")).text(), readFileSync(new URL("../desktop/wake/detector.js", import.meta.url), "utf8"));
    assert.equal((await fetch(base + "/api/wake/modelos/local.onnx")).status, 401);
    const login = await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "prueba-123" }) });
    const { token } = await login.json();
    const pedir = (p) => fetch(base + "/api/wake" + p, { headers: { authorization: `Bearer ${token}` } });
    const estado = await (await pedir("/estado")).json();
    assert.equal(estado.ort, "9.9.9");
    assert.deepEqual(estado.faltan, ["malo.onnx"]);
    assert.equal(await (await pedir("/modelos/local.onnx")).text(), "uno");
    assert.equal(await (await pedir("/modelos/remoto.onnx")).text(), "dos");
    assert.equal((await pedir("/modelos/malo.onnx")).status, 404);
    assert.equal((await pedir("/modelos/package.json")).status, 404);
    assert.equal(bajadas.filter((u) => u.endsWith("remoto.onnx")).length, 1);
    assert.ok(!bajadas.some((u) => u.endsWith("local.onnx")));
  } finally { server.close(); rmSync(dir, { recursive: true, force: true }); }
});
