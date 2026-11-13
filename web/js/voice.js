// Voz: grabación con MediaRecorder (Safari/iPhone) y síntesis del sistema (voz masculina grave en español).
// No usa Web Speech API de reconocimiento: la transcripción la hace el servidor (Groq Whisper).

const MAX_MS = 30000;

function pickMime() {
  if (typeof MediaRecorder === "undefined") return "";
  for (const m of ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg"]) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch { /* siguiente */ }
  }
  return "";
}

export const canRecord = () => !!(navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined");

// Empieza a grabar. Devuelve { stop(): Promise<Blob> }.
export async function startRecording(onAutoStop) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = pickMime();
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise((res) => {
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      res(new Blob(chunks, { type: rec.mimeType || mime || "audio/mp4" }));
    };
  });
  rec.start();
  const timer = setTimeout(() => { if (rec.state !== "inactive") { rec.stop(); onAutoStop?.(); } }, MAX_MS);
  return { stop() { clearTimeout(timer); if (rec.state !== "inactive") rec.stop(); return done; } };
}

let voice = null;
function pickVoice() {
  const vs = (window.speechSynthesis?.getVoices() || []).filter((v) => /^es/i.test(v.lang));
  return vs.find((v) => /jorge|diego|pablo|alvaro|enrique|raul|carlos|male/i.test(v.name)) || vs[0] || null;
}
if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = () => { voice = pickVoice(); };

// Dice el texto en voz alta; llama a onEnd al terminar (o enseguida si no hay síntesis).
export function speak(msg, onEnd) {
  let ended = false;
  const end = () => { if (!ended) { ended = true; onEnd?.(); } };
  try {
    if (!window.speechSynthesis) return end();
    const u = new SpeechSynthesisUtterance(msg);
    voice = voice || pickVoice();
    if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = "es-ES";
    u.rate = 0.9; u.pitch = 0.7;
    u.onend = end; u.onerror = end;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    // Seguro por si Safari nunca dispara onend
    setTimeout(end, Math.max(4000, msg.length * 120));
  } catch { end(); }
}
export function stopSpeaking() { try { window.speechSynthesis?.cancel(); } catch { /* nada */ } }
