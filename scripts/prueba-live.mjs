// Fase 0 del modo conversación en vivo: prueba mínima de la Live API con token efímero.
// Uso: node scripts/prueba-live.mjs <ruta/.env> [salida.wav]
// Nunca imprime la clave ni el token.
import { writeFileSync } from 'node:fs';

const [envFile, wavPath = 'hola-live.wav'] = process.argv.slice(2);
if (envFile) process.loadEnvFile(envFile);
const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error('Falta GEMINI_API_KEY'); process.exit(1); }

const MODELOS = ['gemini-3.8-live', 'gemini-2.5-flash-native-audio-preview-12-2025'];
const BASE = 'https://generativelanguage.googleapis.com/v1beta/auth_tokens';
const WS = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';
const MAX_SESIONES = 20;
const secretos = [KEY];
const limpio = (t) => secretos.reduce((s, x) => s.split(x).join('***'), String(t)).replace(/access_token=[^&\s"']+/g, 'access_token=***');
const log = (...a) => console.log(limpio(a.join(' ')));
let sesiones = 0;

const setupDe = (modelo) => ({
  model: `models/${modelo}`,
  generationConfig: {
    responseModalities: ['AUDIO'],
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Algenib' } } },
  },
  systemInstruction: { parts: [{ text: 'Eres Jarvis, un mayordomo. Responde en español, muy breve.' }] },
  outputAudioTranscription: {},
  sessionResumption: {},
});

// Dos formas de fijar la configuración: la del ejemplo de la guía y la de la referencia REST.
const FORMAS = {
  liveConnectConstraints: (s) => {
    const { model, generationConfig, ...resto } = s;
    return { liveConnectConstraints: { model, config: { ...generationConfig, ...resto } } };
  },
  bidiGenerateContentSetup: (s) => ({ bidiGenerateContentSetup: s }),
  // Fija solo los campos listados; el resto (sessionResumption.handle) lo pone el cliente.
  fieldMask: (s) => {
    const { sessionResumption, ...fijo } = s;
    return { bidiGenerateContentSetup: fijo, fieldMask: 'model,generationConfig,systemInstruction,outputAudioTranscription' };
  },
};

async function crearToken(modelo, forma) {
  const ahora = Date.now();
  const r = await fetch(BASE, {
    method: 'POST',
    headers: { 'x-goog-api-key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      uses: 1,
      expireTime: new Date(ahora + 10 * 60_000).toISOString(),
      newSessionExpireTime: new Date(ahora + 2 * 60_000).toISOString(),
      ...FORMAS[forma](setupDe(modelo)),
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.name) throw new Error(`token HTTP ${r.status}: ${j.error?.message ?? 'sin name'}`);
  secretos.push(j.name, encodeURIComponent(j.name));
  return j.name;
}

function conectar(token, setup) {
  if (++sesiones > MAX_SESIONES) throw new Error('tope de sesiones');
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const ws = new WebSocket(`${WS}?access_token=${encodeURIComponent(token)}`);
    const s = { ws, handle: null, turno: null };
    const timer = setTimeout(() => { ws.close(); reject(new Error('sin setupComplete en 20 s')); }, 20_000);
    ws.onopen = () => ws.send(JSON.stringify({ setup }));
    ws.onerror = () => {};
    ws.onclose = (e) => {
      const err = new Error(`cierre ${e.code} ${e.reason || '(sin motivo)'}`);
      clearTimeout(timer); reject(err); s.turno?.reject(err);
    };
    ws.onmessage = async (ev) => {
      const m = JSON.parse(typeof ev.data === 'string' ? ev.data : await ev.data.text());
      if (m.setupComplete) { clearTimeout(timer); s.msSetup = Math.round(performance.now() - t0); resolve(s); }
      const u = m.sessionResumptionUpdate;
      if (u?.resumable && u.newHandle) { s.handle = u.newHandle; secretos.push(u.newHandle); }
      if (m.goAway) log('  goAway', JSON.stringify(m.goAway));
      const c = m.serverContent, t = s.turno;
      if (!c || !t) return;
      for (const p of c.modelTurn?.parts ?? []) {
        if (!p.inlineData) continue;
        t.msAudio ??= Math.round(performance.now() - t.t0);
        t.mime = p.inlineData.mimeType;
        t.audio.push(Buffer.from(p.inlineData.data, 'base64'));
      }
      if (c.outputTranscription?.text) t.texto += c.outputTranscription.text;
      if (c.turnComplete) { s.turno = null; t.resolve(t); }
    };
  });
}

function pedir(s, text) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('sin turnComplete en 30 s')), 30_000);
    s.turno = {
      t0: performance.now(), audio: [], texto: '',
      resolve: (t) => { clearTimeout(timer); resolve(t); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    };
    s.ws.send(JSON.stringify({ realtimeInput: { text } }));
  });
}

const cerrar = async (s) => { s.ws.close(1000); await new Promise((r) => setTimeout(r, 300)); };

function wav(pcm, hz = 24000) {
  const h = Buffer.alloc(44);
  h.write('RIFF'); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(hz, 24); h.writeUInt32LE(hz * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

async function sesionHola(modelo, forma) {
  const t0 = performance.now();
  const token = await crearToken(modelo, forma);
  const msToken = Math.round(performance.now() - t0);
  // El cliente solo manda el modelo: lo demás debe venir fijado en el token.
  const s = await conectar(token, { model: `models/${modelo}` });
  const t = await pedir(s, 'Di: Hola señor.');
  const msTotal = Math.round(msToken + s.msSetup + t.msAudio);
  await cerrar(s);
  if (!t.audio.length) throw new Error('turno sin audio');
  const pcm = Buffer.concat(t.audio);
  log(`  token ${msToken} ms, setup ${s.msSetup} ms, primer audio ${t.msAudio} ms (suma ${msTotal}), ${(pcm.length / 48000).toFixed(2)} s ${t.mime}, transcripción: "${t.texto.trim()}"`);
  return pcm;
}

async function probarReanudacion(modelo, forma) {
  log(`Reanudación con token fijado (${forma})`);
  const token = await crearToken(modelo, forma);
  const base = { model: `models/${modelo}` };
  const a = await conectar(token, { ...base, sessionResumption: {} });
  const t1 = await pedir(a, 'Recuerda el número 4719. Responde solo: vale.');
  await new Promise((r) => setTimeout(r, 1500));
  await cerrar(a);
  log(`  sesión inicial: "${t1.texto.trim()}", handle ${a.handle ? 'recibido' : 'NO recibido'}`);
  if (!a.handle) return false;
  for (const [nombre, tk] of [['mismo token', async () => token], ['token nuevo', () => crearToken(modelo, forma)]]) {
    try {
      const b = await conectar(await tk(), { ...base, sessionResumption: { handle: a.handle } });
      const t2 = await pedir(b, '¿Qué número te pedí recordar? Dilo en cifras.');
      await cerrar(b);
      const ok = /4\D?7\D?1\D?9|cuatro mil setecientos diecinueve/i.test(t2.texto);
      log(`  ${nombre}: setup ${b.msSetup} ms, respuesta "${t2.texto.trim()}" -> ${ok ? 'CONSERVA contexto' : 'NO conserva contexto'}`);
      if (ok) return true;
    } catch (e) { log(`  ${nombre}: ERROR ${e.message}`); }
  }
  return false;
}

let modelo, forma, primero;
busqueda: for (const m of MODELOS) {
  for (const f of ['liveConnectConstraints', 'bidiGenerateContentSetup']) {
    log(`Probando ${m} con ${f}`);
    try { primero = await sesionHola(m, f); modelo = m; forma = f; break busqueda; }
    catch (e) { log(`  ERROR ${e.message}`); }
  }
}
if (!modelo) { log('Ningún modelo funcionó'); process.exit(1); }
writeFileSync(wavPath, wav(primero));
log(`Modelo ${modelo}, forma ${forma}, WAV ${wavPath}`);

for (let i = 1; i <= 5; i++) {
  log(`Sesión ${i}/5`);
  try { await sesionHola(modelo, forma); }
  catch (e) { log(`  ERROR ${e.message}`); }
}

for (const f of [forma, 'fieldMask']) {
  try { if (await probarReanudacion(modelo, f)) break; }
  catch (e) { log(`  ERROR ${e.message}`); }
}
log(`Sesiones WebSocket abiertas: ${sesiones}`);
