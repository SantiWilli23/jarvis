// Proveedores reales de la Fase 5. Todos quedan apagados si falta su clave/credencial.
// NINGUNO recibe mensajes privados (no están en permite_privado), salvo Ollama local (localSafe).
import { OpenAICompatProvider, Provider, ProviderError, normHeaders } from "./base.js";

// Mistral: https://api.mistral.ai/v1/chat/completions (compatible con OpenAI). Modelo en config.
export class MistralProvider extends OpenAICompatProvider {
  constructor(opts = {}) { super({ id: "mistral", name: "Mistral", model: "mistral-small-latest", ...opts }); }
  get baseUrl() { return "https://api.mistral.ai/v1"; }
}

// Cloudflare Workers AI, endpoint compatible con OpenAI:
// https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1/chat/completions
export class CloudflareProvider extends OpenAICompatProvider {
  constructor({ accountId, ...opts } = {}) {
    super({ id: "cloudflare", name: "Cloudflare Workers AI", model: "@cf/meta/llama-3.1-8b-instruct", ...opts });
    this.accountId = accountId || "";
  }
  get enabled() { return !!this.apiKey && /^[0-9a-zA-Z]+$/.test(this.accountId); }
  get baseUrl() { return `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/ai/v1`; }
}

export function isLocalUrl(u) {
  try { return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(u).hostname); } catch { return false; }
}

// Ollama: solo se activa si OLLAMA_URL responde (GET /v1/models). Lo privado solo si es localhost.
export class OllamaProvider extends OpenAICompatProvider {
  constructor({ url, ...opts } = {}) {
    super({ id: "ollama", name: "Ollama", model: "llama3.1", apiKey: "local", ...opts });
    this.url = String(url || "").replace(/\/+$/, "").replace(/\/v1$/, "");
    this.alive = false;
    this.lastProbe = 0;
  }
  get localSafe() { return isLocalUrl(this.url); }
  get enabled() {
    if (!this.url || !/^https?:\/\//.test(this.url)) return false;
    if (Date.now() - this.lastProbe > 60_000) this.probe().catch(() => {}); // refresco sin bloquear
    return this.alive;
  }
  get baseUrl() { return `${this.url}/v1`; }
  async probe() {
    this.lastProbe = Date.now();
    if (!this.url || !/^https?:\/\//.test(this.url)) { this.alive = false; return false; }
    try {
      const res = await this.fetch(`${this.url}/v1/models`, { signal: AbortSignal.timeout(2500) });
      if (!res.ok) { this.alive = false; return false; }
      const j = await res.json();
      const ids = (j?.data || []).map((m) => m.id);
      if (!ids.length) { this.alive = false; return false; }
      if (!ids.includes(this.model)) this.model = ids[0];
      this.alive = true;
    } catch { this.alive = false; }
    return this.alive;
  }
}

// ChatGPT (OpenAI). Puesto de pago: revisor de fallas, fotos. Sustituto gratis: Gemini.
export class OpenAIProvider extends OpenAICompatProvider {
  constructor(opts = {}) { super({ id: "openai", name: "ChatGPT", model: "gpt-4o-mini", ...opts }); }
  get baseUrl() { return "https://api.openai.com/v1"; }
  async chat({ messages = [], system, images, signal } = {}) {
    if (!images?.length) return super.chat({ messages, system, signal });
    // Fotos: el último mensaje del usuario lleva las imágenes (data URL o URL) como partes de contenido.
    const msgs = messages.map((m) => ({ ...m }));
    const i = msgs.map((m) => m.role).lastIndexOf("user");
    if (i >= 0) msgs[i].content = [{ type: "text", text: String(msgs[i].content) }, ...images.map((u) => ({ type: "image_url", image_url: { url: u } }))];
    return super.chat({ messages: msgs, system, signal });
  }
}

// Grok (xAI). Puesto de pago: datos y videos. Sustituto gratis: Groq.
export class XaiProvider extends OpenAICompatProvider {
  constructor(opts = {}) { super({ id: "xai", name: "Grok", model: "grok-4.7", ...opts }); }
  get baseUrl() { return "https://api.x.ai/v1"; }
}

// Perplexity: API Agent (POST /v1/agent) con la herramienta web_search. La API Sonar de chat
// completions anuncia su retiro el 27-09-2026 en la documentación oficial, por eso no se usa.
export class PerplexityProvider extends Provider {
  constructor({ effort = "low", ...opts } = {}) {
    super({ id: "perplexity", name: "Perplexity", model: null, ...opts });
    this.effort = effort;
  }
  // Devuelve { text, sources:[{title,url}], tokens, headers }
  async ask({ input, system, signal } = {}) {
    let res;
    try {
      res = await this.fetch("https://api.perplexity.ai/v1/agent", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ input, ...(system ? { instructions: system } : {}), ...(this.model ? { model: this.model } : { effort: this.effort }), tools: [{ type: "web_search" }], stream: false }),
        signal,
      });
    } catch (e) { throw new ProviderError(`perplexity: sin conexión (${e.message})`, { status: 0 }); }
    const headers = normHeaders(res.headers);
    if (!res.ok) {
      let d = ""; try { d = (await res.text()).slice(0, 200); } catch { /* sin detalle */ }
      throw new ProviderError(`perplexity: HTTP ${res.status} ${d}`, { status: res.status, headers });
    }
    const j = await res.json();
    let text = "";
    const sources = [];
    for (const o of j?.output || []) {
      if (o.type === "search_results") for (const r of o.results || []) sources.push({ title: r.title || r.url, url: r.url });
      if (o.type === "message") for (const c of o.content || []) {
        if (c.type === "output_text") {
          text += c.text || "";
          for (const a of c.annotations || []) if (a.type === "url_citation" && a.url) sources.push({ title: a.title || a.url, url: a.url });
        }
      }
    }
    if (!text && j?.choices?.[0]?.message?.content) { // forma antigua (Sonar), por si acaso
      text = j.choices[0].message.content;
      for (const u of j.citations || []) sources.push({ title: u, url: u });
    }
    const seen = new Set();
    return { text, sources: sources.filter((s) => s.url && !seen.has(s.url) && seen.add(s.url)), tokens: j?.usage?.total_tokens ?? 0, headers };
  }
  async chat({ messages = [], system, signal } = {}) {
    const input = messages.length === 1 ? String(messages[0].content)
      : messages.map((m) => `${m.role === "user" ? "Usuario" : "Asistente"}: ${m.content}`).join("\n");
    const r = await this.ask({ input, system, signal });
    const refs = r.sources.slice(0, 5).map((s, i) => `[${i + 1}] ${s.url}`).join("\n");
    return { text: refs ? `${r.text}\n\nFuentes:\n${refs}` : r.text, tokens: r.tokens, headers: r.headers };
  }
}
