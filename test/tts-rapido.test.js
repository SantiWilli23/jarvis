import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { memDb, clock } from "./helpers.js";
import { createTts, partirTexto } from "../server/tts.js";
import { createPrivacy } from "../server/router/privacy.js";
import { chatRoutes } from "../server/routes/chat.js";
import { ttsRoutes } from "../server/routes/tts.js";

const PCM = Buffer.alloc(480, 1).toString("base64");
const geminiOk = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: PCM } }] } }] }), { status: 200 });
const LARGO = "Primera frase de prueba, señor. " + "Segunda frase bastante más larga para pasar del umbral de corte. ".repeat(3).trim();

async function setup({ fetch, config, env = { GEMINI_API_KEY: "x" }, now = clock() } = {}) {
  const { db, userId } = await memDb();
  const f = async (url, init) => { f.calls.push(String(url)); return (fetch || geminiOk)(url, init); };
  f.calls = [];
  const tts = createTts({ db, env, fetch: f, config, privacy: createPrivacy(), phrasesDir: "no-existe", cacheDir: "no-existe", now });
  return { tts, userId, f, now };
}

// App mínima con las dos rutas; el usuario sale de la cabecera x-u.
async function servidor(t, { tts, reply = "Buenas tardes, señor.", out = {}, frenado = false }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: Number(req.headers["x-u"] || 1) }; next(); });
  const ctx = { tts, control: { frenado: async () => frenado }, chat: { handle: async () => ({ status: "ok", reply, private: false, ...out }), checkPrivate: async () => false } };
  app.use("/api/chat", chatRoutes(ctx));
  app.use("/api/tts", ttsRoutes(ctx));
  const srv = app.listen(0);
  t.after(() => srv.close());
  const base = `http://127.0.0.1:${srv.address().port}/api`;
  return {
    chat: async (body) => (await fetch(base + "/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json(),
    audio: (id, u = 1) => fetch(`${base}/tts/${id}`, { headers: { "x-u": String(u) } }),
  };
}

test("partirTexto: corto o de una frase no se parte; largo da dos trozos exactos", () => {
  assert.deepEqual(partirTexto("Hola. Adiós."), ["Hola. Adiós."]);
  assert.equal(partirTexto("a ".repeat(120) + "fin.").length, 1);
  const [a, b] = partirTexto(LARGO);
  assert.ok(a.startsWith("Primera frase") && a.length <= 120 && a.endsWith("."));
  assert.equal(`${a} ${b}`, LARGO);
});

test("chat con voz:true prepara las partes y GET las entrega solo a su usuario", async (t) => {
  const { tts, f, now } = await setup();
  const s = await servidor(t, { tts, reply: LARGO });
  const r = await s.chat({ text: "hola", voz: true });
  assert.equal(r.voz.partes.length, 2);
  assert.equal(r.voz.partes.map((p) => p.texto).join(" "), LARGO);
  const a = await s.audio(r.voz.partes[0].id);
  assert.equal(a.status, 200);
  assert.equal(a.headers.get("x-voice"), "gemini");
  assert.equal(a.headers.get("content-type"), "audio/wav");
  assert.equal((await s.audio(r.voz.partes[1].id)).status, 200);
  assert.equal(f.calls.length, 2, "GET no vuelve a sintetizar");
  assert.equal((await s.audio(r.voz.partes[0].id, 2)).status, 404);
  assert.equal((await s.audio("nada")).status, 404);
  now.advance(61_000);
  assert.equal((await s.audio(r.voz.partes[0].id)).status, 404);
});

test("la respuesta del chat no espera a la voz; si falla, GET da 204", async (t) => {
  let soltar;
  const { tts } = await setup({ fetch: () => new Promise((res) => { soltar = () => res(new Response("{}", { status: 500 })); }) });
  const s = await servidor(t, { tts });
  const r = await s.chat({ text: "hola", voz: true });
  assert.equal(r.voz.partes.length, 1);
  const pendiente = s.audio(r.voz.partes[0].id);
  while (!soltar) await new Promise((res) => setTimeout(res, 5));
  soltar();
  const a = await pendiente;
  assert.equal(a.status, 204);
  assert.equal(a.headers.get("x-voice"), "browser");
});

test("sin voz: no pedida, privado, escolar, freno o sin clave", async (t) => {
  const { tts, f } = await setup();
  const casos = [
    [{}, {}],
    [{ out: { private: true } }, { voz: true }],
    [{ out: { status: "escolar" } }, { voz: true }],
    [{ reply: "Su contraseña es esa, señor." }, { voz: true }],
    [{}, { voz: true, private: true }],
    [{ frenado: true }, { voz: true }],
  ];
  for (const [srv, body] of casos) assert.equal((await (await servidor(t, { tts, ...srv })).chat({ text: "hola", ...body })).voz, undefined);
  assert.equal(f.calls.length, 0);
  const sin = await setup({ env: {} });
  assert.equal((await (await servidor(t, { tts: sin.tts })).chat({ text: "hola", voz: true })).voz, undefined);
});

test("tope de trabajos: los más viejos se olvidan", async () => {
  const { tts, userId } = await setup({ config: { gemini: { tope_dia: 100 } } });
  const ids = [];
  for (let i = 0; i < 21; i++) ids.push((await tts.preparar({ userId, text: "frase " + i })).partes[0].id);
  assert.equal(tts.trabajo({ userId, id: ids[0] }), undefined);
  assert.ok(tts.trabajo({ userId, id: ids[20] }));
});
