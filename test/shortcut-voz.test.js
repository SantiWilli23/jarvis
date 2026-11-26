import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createDb } from "../server/db/client.js";
import { buildContext } from "../server/context.js";
import { createApp } from "../server/app.js";
import { createTts } from "../server/tts.js";
import { MAX_AUDIO, sinLlamada } from "../server/routes/shortcut.js";

// Servidor completo en memoria con modelos "fake"; Gemini TTS y MiniMax son falsos y se cuenta cada llamada.
async function boot({ bytes = 4800 } = {}) {
  const voces = [];
  const f = async (url) => {
    const u = String(url);
    if (!u.includes("-tts:generateContent") && !u.includes("minimax")) return new Response("{}", { status: 500 });
    voces.push(u);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: Buffer.alloc(bytes).toString("base64") } }] } }] }), { status: 200 });
  };
  const ctx = await buildContext({ db: createDb({ url: ":memory:" }), env: { OWNER_PASSWORD: "prueba-123" }, fetch: f });
  ctx.tts = createTts({ db: ctx.db, env: { GEMINI_API_KEY: "g", MINIMAX_API_KEY: "m" }, fetch: f, privacy: ctx.privacy, config: { minimax: { enabled: true } }, phrasesDir: "no-existe", cacheDir: "no-existe" });
  const server = createServer(createApp(ctx));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = async (kind) => (await ctx.sessions.create(ctx.ownerId, { name: kind, kind })).token;
  const sc = await token("shortcut");
  const call = (body, { tk = sc, query = "" } = {}) => fetch(`${base}/api/shortcut${query}`, { method: "POST", headers: { "content-type": "application/json", ...(tk ? { authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) });
  return { ctx, voces, token, call, close: () => server.close() };
}

test("voz:true devuelve el audio de Gemini en Base64", async () => {
  const s = await boot();
  try {
    const r = await (await s.call({ text: "hola", voz: true })).json();
    assert.equal(r.audio_mime, "audio/wav");
    assert.equal(Buffer.from(r.audio_b64, "base64").length, 4800 + 44);
    assert.equal(r.speak, r.reply);
    assert.equal(s.voces.length, 1);
  } finally { s.close(); }
});

test("sin voz:true la respuesta es la de siempre y no se llama a ninguna voz", async () => {
  const s = await boot();
  try {
    const r = await (await s.call({ text: "hola" })).json();
    assert.deepEqual(Object.keys(r).sort(), ["reply", "speak", "status"]);
    const t = await s.call({ text: "hola", voz: true }, { query: "?format=text" });
    assert.match(t.headers.get("content-type"), /text\/plain/);
    assert.equal(s.voces.length, 0);
  } finally { s.close(); }
});

test("lo privado nunca lleva audio ni llega a Gemini o MiniMax", async () => {
  const s = await boot();
  try {
    await s.ctx.notes.add({ userId: s.ctx.ownerId, title: "Alergia", body: "alergia al polen de olivo", level: "privada" });
    const casos = [
      { text: "hola", private: true },          // marcado en el cuerpo
      { text: "mi contraseña del banco" },      // clasificador
      { text: "qué sabes del polen de olivo" }, // nota privada
    ];
    for (const c of casos) {
      const r = await (await s.call({ ...c, voz: true })).json();
      assert.ok(r.speak, c.text);
      assert.equal(r.audio_b64, undefined, c.text);
    }
    // marcado por la salida, aunque la entrada no lo parezca
    s.ctx.chat.handle = async () => ({ status: "escolar", reply: "Tiene prueba el lunes.", private: true });
    assert.equal((await (await s.call({ text: "hola", voz: true })).json()).audio_b64, undefined);
    assert.equal(s.voces.length, 0);
  } finally { s.close(); }
});

test("audio por encima del tope: se responde sin audio", async () => {
  const s = await boot({ bytes: MAX_AUDIO });
  try {
    const r = await (await s.call({ text: "hola", voz: true })).json();
    assert.ok(r.speak);
    assert.equal(r.audio_b64, undefined);
    assert.equal(s.voces.length, 1);
  } finally { s.close(); }
});

test("si la voz falla, la respuesta de texto llega igual", async () => {
  const s = await boot();
  try {
    s.ctx.tts = { synth: async () => { throw new Error("sin voz"); } };
    const r = await s.call({ text: "hola", voz: true });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).audio_b64, undefined);
  } finally { s.close(); }
});

test("voz:true solo con clave shortcut", async () => {
  const s = await boot();
  try {
    assert.equal((await s.call({ text: "hola", voz: true }, { tk: null })).status, 401);
    for (const kind of ["web", "phone", "pc"]) assert.equal((await s.call({ text: "hola", voz: true }, { tk: await s.token(kind) })).status, 403, kind);
    assert.equal(s.voces.length, 0);
  } finally { s.close(); }
});

test("se quita el «Jarvis» inicial solo con voz:true", async () => {
  assert.equal(sinLlamada("Jarvis, qué hora es"), "qué hora es");
  assert.equal(sinLlamada("Hey Jarvis qué hora es"), "qué hora es");
  assert.equal(sinLlamada("Oye, Jarvis. ¿Qué tal?"), "¿Qué tal?");
  assert.equal(sinLlamada("Jarvis"), "Jarvis");
  assert.equal(sinLlamada("qué es jarvis"), "qué es jarvis");
  const s = await boot();
  try {
    const vistos = [];
    s.ctx.chat.handle = async ({ text }) => { vistos.push(text); return { status: "ok", reply: "Hecho." }; };
    await s.call({ text: "Jarvis, hola", voz: true });
    await s.call({ text: "Jarvis, hola" });
    assert.deepEqual(vistos, ["hola", "Jarvis, hola"]);
  } finally { s.close(); }
});
