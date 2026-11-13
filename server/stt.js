// Voz a texto con Groq Whisper. Sin clave usa una transcripción simulada (modo "fake").
export function createStt({ apiKey, fetch: f = globalThis.fetch } = {}) {
  return {
    get fake() { return !apiKey; },
    async transcribe(buffer, mime = "audio/mp4") {
      if (!apiKey) return { text: "Hola Jarvis (transcripción simulada: falta GROQ_API_KEY)", fake: true };
      const ext = /webm/.test(mime) ? "webm" : /ogg/.test(mime) ? "ogg" : /wav/.test(mime) ? "wav" : "m4a";
      const form = new FormData();
      form.append("file", new Blob([buffer], { type: mime }), `audio.${ext}`);
      form.append("model", "whisper-large-v3-turbo");
      form.append("language", "es");
      form.append("response_format", "json");
      const res = await f("https://api.groq.com/openai/v1/audio/transcriptions", { method: "POST", headers: { authorization: `Bearer ${apiKey}` }, body: form });
      if (!res.ok) throw Object.assign(new Error(`Whisper HTTP ${res.status}`), { status: res.status });
      const j = await res.json();
      return { text: j.text || "", fake: false };
    },
  };
}
