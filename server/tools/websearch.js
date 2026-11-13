// Búsqueda web con citas de fuentes. SIEMPRE no privada: si el texto es privado no se busca.
// Orden: Perplexity (PERPLEXITY_API_KEY) > Gemini con Google Search (GEMINI_API_KEY, gratis según
// su cuota) > respuestas instantáneas de DuckDuckGo (sin clave, resultados limitados).
// Usa fetch nativo; cuenta contra la cuota del proveedor usado.

import { classify } from "../router/classify.js";

export function createWebSearch({ providers, quota, config = {}, fetch: f = globalThis.fetch, env = process.env, now = () => Date.now() }) {
  const gemModel = config.gemini_modelo || "gemini-2.5-flash";

  async function viaPerplexity(query) {
    const r = await providers.perplexity.ask({ input: query, system: "Responde en español, breve, con datos actuales." });
    return { text: r.text, sources: r.sources, tokens: r.tokens, headers: r.headers };
  }
  async function viaGemini(query) {
    const key = providers.gemini.apiKey;
    const res = await f(`https://generativelanguage.googleapis.com/v1beta/models/${gemModel}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: query }] }], tools: [{ google_search: {} }] }),
    });
    if (!res.ok) throw Object.assign(new Error(`gemini search HTTP ${res.status}`), { status: res.status });
    const j = await res.json();
    const cand = j?.candidates?.[0];
    const text = (cand?.content?.parts || []).map((p) => p.text || "").join("").trim();
    const sources = (cand?.groundingMetadata?.groundingChunks || []).map((c) => c.web).filter((w) => w?.uri).map((w) => ({ title: w.title || w.uri, url: w.uri }));
    return { text, sources, tokens: j?.usageMetadata?.totalTokenCount || 0, headers: {} };
  }
  async function viaDuck(query) {
    const res = await f(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`);
    if (!res.ok) throw Object.assign(new Error(`duckduckgo HTTP ${res.status}`), { status: res.status });
    const j = await res.json();
    const sources = [];
    if (j.AbstractURL) sources.push({ title: j.Heading || j.AbstractURL, url: j.AbstractURL });
    for (const t of j.RelatedTopics || []) if (t.FirstURL) sources.push({ title: t.Text?.slice(0, 80) || t.FirstURL, url: t.FirstURL });
    const text = j.AbstractText || j.Answer || (j.RelatedTopics || []).find((t) => t.Text)?.Text || "";
    return { text, sources: sources.slice(0, 5), tokens: 0, headers: {} };
  }

  const backends = () => [
    providers.perplexity?.enabled && ["perplexity", viaPerplexity],
    providers.gemini?.enabled && ["gemini", viaGemini],
    ["duckduckgo", viaDuck],
  ].filter(Boolean);

  return {
    get enabled() { return true; }, // DuckDuckGo no necesita clave
    backends: () => backends().map(([id]) => id),
    // -> { ok, text, sources, provider, private:false } | { ok:false, reason }
    async search({ userId, query, isPrivate = false }) {
      const q = String(query || "").trim().slice(0, 500);
      if (isPrivate || classify(q).private) return { ok: false, reason: "privado" }; // nada privado sale a buscadores
      if (!q) return { ok: false, reason: "vacio" };
      for (const [id, fn] of backends()) {
        if (quota && id !== "duckduckgo") {
          const c = await quota.check(userId, id);
          if (!c.ok) continue;
        }
        try {
          const r = await fn(q);
          if (!r.text) continue;
          if (quota && id !== "duckduckgo") { await quota.record(userId, id, r.tokens || 0); await quota.ingestHeaders(userId, id, r.headers); }
          return { ok: true, provider: id, text: r.text, sources: r.sources.slice(0, 6), private: false };
        } catch (e) {
          if (quota && id !== "duckduckgo") await quota.pauseOnError(userId, id, { status: e.status || 0, headers: e.headers || {}, message: e.message });
        }
      }
      return { ok: false, reason: "sin_resultados" };
    },
    format(r) {
      const refs = r.sources.map((s, i) => `[${i + 1}] ${s.title} - ${s.url}`).join("\n");
      return refs ? `${r.text}\n\nFuentes:\n${refs}` : r.text;
    },
  };
}
