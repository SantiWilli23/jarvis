import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memDb, clock } from "./helpers.js";
import { createTts, normalizePhrase, pcmToWav } from "../server/tts.js";
import { createPrivacy } from "../server/router/privacy.js";
import { createQuota } from "../server/router/quota.js";
import { createRouter } from "../server/router/chain.js";
import { buildProviders } from "../server/providers/index.js";
import { loadJson } from "../server/context.js";

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const PCM_B64 = Buffer.alloc(480, 1).toString("base64");

// fetch falso: cuenta llamadas por host y responde según la URL.
function mockFetch(handlers = {}) {
  const f = async (url, init) => {
    f.calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null, headers: init?.headers });
    for (const [frag, h] of Object.entries(handlers)) if (String(url).includes(frag)) return h(init);
    throw new Error("sin red en pruebas: " + url);
  };
  f.calls = [];
  return f;
}
const geminiOk = () => json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;rate=24000", data: PCM_B64 } }] } }] });
const minimaxVoiceOk = () => json({ voice_id: "voz_x", base_resp: { status_code: 0 } });
const minimaxAudioOk = () => json({ data: { audio: "49443304" }, base_resp: { status_code: 0 } });

async function ttsSetup({ env, f, config, phrases = true } = {}) {
  const { db, userId } = await memDb();
  const dir = mkdtempSync(join(tmpdir(), "jarvis-tts-"));
  const phrasesDir = join(dir, "phrases"); mkdirSync(phrasesDir);
  if (phrases) writeFileSync(join(phrasesDir, "manifest.json"), JSON.stringify({ frases: [{ id: "a", texto: "Hola, señor.", archivo: "hola-senor.mp3" }, { id: "b", texto: "Entendido.", archivo: "entendido.mp3" }] }));
  const now = clock();
  const tts = createTts({ db, env, fetch: f, config, privacy: createPrivacy(), phrasesDir, cacheDir: join(dir, "cache"), now });
  return { tts, userId, phrasesDir, now, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test("normalizePhrase ignora mayúsculas, espacios y puntuación; WAV con cabecera correcta", () => {
  assert.equal(normalizePhrase("  ¡HOLA,   Señor! "), normalizePhrase("hola señor"));
  const w = pcmToWav(Buffer.alloc(10));
  assert.equal(w.toString("ascii", 0, 4), "RIFF");
  assert.equal(w.readUInt32LE(24), 24000);
  assert.equal(w.length, 54);
});

test("lo privado nunca llega a Gemini TTS ni a MiniMax (aunque haya claves)", async () => {
  const f = mockFetch({ generativelanguage: geminiOk, "voice_design": minimaxVoiceOk, "t2a_v2": minimaxAudioOk });
  const { tts, userId, done } = await ttsSetup({ env: { GEMINI_API_KEY: "x", MINIMAX_API_KEY: "y" }, f, config: { minimax: { enabled: true } } });
  assert.equal(await tts.synth({ userId, text: "mi clave es secreta", isPrivate: true }), null);
  assert.equal(f.calls.length, 0);
  // el mismo texto no privado sí sale a Gemini
  assert.equal((await tts.synth({ userId, text: "buenos días", isPrivate: false })).source, "gemini");
  assert.equal(f.calls.length, 1);
  done();
});

test("Gemini TTS: pide AUDIO, devuelve WAV y respeta el estilo", async () => {
  const f = mockFetch({ generativelanguage: geminiOk });
  const { tts, userId, done } = await ttsSetup({ env: { GEMINI_API_KEY: "x" }, f });
  const r = await tts.synth({ userId, text: "Buenas tardes" });
  assert.equal(r.mime, "audio/wav");
  assert.equal(r.data.toString("ascii", 0, 4), "RIFF");
  assert.deepEqual(f.calls[0].body.generationConfig.responseModalities, ["AUDIO"]);
  assert.match(f.calls[0].body.contents[0].parts[0].text, /mayordomo/);
  assert.match(f.calls[0].url, /gemini-2\.5-flash-preview-tts:generateContent/);
  done();
});

test("tope de voz agotado cae a la siguiente voz (Gemini -> MiniMax -> navegador)", async () => {
  const f = mockFetch({ generativelanguage: geminiOk, voice_design: minimaxVoiceOk, t2a_v2: minimaxAudioOk });
  const { tts, userId, done } = await ttsSetup({ env: { GEMINI_API_KEY: "x", MINIMAX_API_KEY: "y" }, f, config: { gemini: { tope_dia: 1 }, minimax: { enabled: true, tope_caracteres_dia: 30 } } });
  assert.equal((await tts.synth({ userId, text: "uno" })).source, "gemini");
  assert.equal((await tts.synth({ userId, text: "dos" })).source, "minimax"); // Gemini lleno
  const st = await tts.status(userId);
  assert.equal(st.minimax.usado_caracteres, 3);
  assert.equal(await tts.synth({ userId, text: "x".repeat(40) }), null); // MiniMax lleno: navegador
  done();
});

test("MiniMax apagado por defecto; sin saldo (1008) cae al navegador sin romper", async () => {
  const f = mockFetch({ voice_design: minimaxVoiceOk, t2a_v2: () => json({ base_resp: { status_code: 1008, status_msg: "insufficient balance" } }) });
  const off = await ttsSetup({ env: { MINIMAX_API_KEY: "y" }, f });
  assert.equal(await off.tts.synth({ userId: off.userId, text: "hola amigo" }), null);
  assert.equal(f.calls.length, 0);
  off.done();
  const on = await ttsSetup({ env: { MINIMAX_API_KEY: "y" }, f, config: { minimax: { enabled: true } } });
  assert.equal(await on.tts.synth({ userId: on.userId, text: "hola amigo" }), null);
  assert.equal((await on.tts.status(on.userId)).minimax.usado_caracteres, 0);
  on.done();
});

test("Gemini con 429 o error cae a MiniMax sin lanzar", async () => {
  const f = mockFetch({ generativelanguage: () => json({ error: "cuota" }, 429), voice_design: minimaxVoiceOk, t2a_v2: minimaxAudioOk });
  const { tts, userId, done } = await ttsSetup({ env: { GEMINI_API_KEY: "x", MINIMAX_API_KEY: "y" }, f, config: { minimax: { enabled: true } } });
  assert.equal((await tts.synth({ userId, text: "probando" })).source, "minimax");
  done();
});

test("el saludo cacheado en disco no repite llamadas", async () => {
  const f = mockFetch({ generativelanguage: geminiOk });
  const { tts, userId, done } = await ttsSetup({ env: { GEMINI_API_KEY: "x" }, f, phrases: false });
  const a = await tts.synth({ userId, text: "Hola, señor." });
  const b = await tts.synth({ userId, text: "hola señor" });
  assert.equal(f.calls.length, 1);
  assert.equal(a.source, "gemini");
  assert.equal(b.source, "gemini-cache");
  assert.deepEqual(a.data, b.data);
  // otra frase no se cachea
  await tts.synth({ userId, text: "Buenas noches" }); await tts.synth({ userId, text: "Buenas noches" });
  assert.equal(f.calls.length, 3);
  done();
});

test("frase pregrabada: se sirve si existe el mp3 y se ignora si falta", async () => {
  const f = mockFetch({});
  const { tts, userId, phrasesDir, done } = await ttsSetup({ env: {}, f });
  assert.equal(await tts.synth({ userId, text: "Entendido." }), null); // falta el mp3
  writeFileSync(join(phrasesDir, "entendido.mp3"), Buffer.from("ID3fake"));
  const r = await tts.synth({ userId, text: "  entendido " });
  assert.equal(r.source, "pregrabada");
  assert.equal(r.mime, "audio/mpeg");
  assert.equal(r.data.toString(), "ID3fake");
  assert.equal(f.calls.length, 0);
  done();
});

test("sin manifest ni claves no rompe: devuelve null", async () => {
  const { tts, userId, done } = await ttsSetup({ env: {}, f: mockFetch({}), phrases: false });
  assert.equal(await tts.synth({ userId, text: "Hola, señor." }), null);
  done();
});

/* ---------- OpenRouter ---------- */
const config = loadJson("providers.json");

test("OpenRouter: apagado sin clave y con modelo que no es :free", () => {
  assert.equal(buildProviders({ env: {}, config }).openrouter.enabled, false);
  assert.equal(buildProviders({ env: { OPENROUTER_API_KEY: "k" }, config }).openrouter.enabled, true);
  const cfg = structuredClone(config); cfg.proveedores.openrouter.modelo = "openai/gpt-5";
  assert.equal(buildProviders({ env: { OPENROUTER_API_KEY: "k" }, config: cfg }).openrouter.enabled, false);
  assert.ok(config.permite_privado.every((id) => id !== "openrouter"));
  assert.equal(config.proveedores.openrouter.limites.rpd, 50);
  assert.deepEqual(config.cadena_gratis.slice(0, 3), ["groq", "openrouter", "cloudflare"]);
});

async function orSetup(f) {
  const { db, userId } = await memDb();
  const now = clock();
  const providers = buildProviders({ env: { OPENROUTER_API_KEY: "k" }, fetch: f, config });
  const quota = createQuota({ db, limits: { openrouter: { rpm: null, rpd: 50 } }, now });
  const router = createRouter({ providers, chain: ["openrouter"], quota, privacy: createPrivacy() });
  return { router, quota, userId, now };
}

test("OpenRouter llama a la API compatible con OpenAI; lo privado nunca llega", async () => {
  const f = mockFetch({ "openrouter.ai": () => json({ choices: [{ message: { content: "ok" } }], usage: { total_tokens: 7 } }) });
  const { router, userId } = await orSetup(f);
  const r = await router.route({ userId, messages: [{ role: "user", content: "hola" }] });
  assert.equal(r.provider, "openrouter");
  assert.equal(f.calls[0].url, "https://openrouter.ai/api/v1/chat/completions");
  assert.match(f.calls[0].body.model, /:free$/);
  const p = await router.route({ userId, isPrivate: true, kind: "privado", messages: [{ role: "user", content: "secreto" }] });
  assert.equal(p.ok, false);
  assert.equal(f.calls.length, 1);
});

test("OpenRouter: un 429 lo pausa y el tope de 50 al día lo agota", async () => {
  let mode = 429;
  const f = mockFetch({ "openrouter.ai": () => mode === 429 ? json({ error: "x" }, 429, { "retry-after": "90" }) : json({ choices: [{ message: { content: "ok" } }] }) });
  const { router, quota, userId, now } = await orSetup(f);
  const t0 = now();
  assert.equal((await router.route({ userId, messages: [{ role: "user", content: "a" }] })).ok, false);
  assert.equal((await quota.check(userId, "openrouter")).until, t0 + 90_000);
  await router.route({ userId, messages: [{ role: "user", content: "b" }] });
  assert.equal(f.calls.length, 1, "pausado: no insiste");
  now.advance(91_000); mode = 200;
  for (let i = 0; i < 50; i++) assert.equal((await router.route({ userId, messages: [{ role: "user", content: "c" }] })).ok, true);
  const r = await router.route({ userId, messages: [{ role: "user", content: "d" }] });
  assert.equal(r.ok, false);
  assert.equal(r.tried[0].skip, "dia");
});
