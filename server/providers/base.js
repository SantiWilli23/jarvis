// Interfaz común de proveedores. `fetch` es inyectable para probar sin red.
//
//   provider.id, provider.name, provider.enabled
//   await provider.chat({ messages:[{role,content}], system, images? })
//     -> { text, tokens, headers }       (headers = cabeceras de límite ya normalizadas)
//   Si falla lanza ProviderError { status, headers }.

export class ProviderError extends Error {
  constructor(message, { status = 0, headers = {} } = {}) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
    this.headers = headers;
  }
}

// Pasa Headers/obj a un objeto plano con claves en minúsculas.
export function normHeaders(h) {
  const out = {};
  if (!h) return out;
  if (typeof h.forEach === "function" && typeof h.get === "function") h.forEach((v, k) => { out[k.toLowerCase()] = v; });
  else for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = String(v);
  return out;
}

export class Provider {
  constructor({ id, name, apiKey, model, fetch: f } = {}) {
    this.id = id;
    this.name = name || id;
    this.apiKey = apiKey || "";
    this.model = model;
    this.fetch = f || globalThis.fetch;
  }
  // Los esqueletos (skeleton = true) nunca se activan, tengan o no clave.
  get enabled() { return !this.skeleton && !!this.apiKey; }
  async chat() { throw new ProviderError(`${this.id} no está implementado`, { status: 501 }); }
}

// Proveedores con API compatible con OpenAI (Groq, Gemini en su modo compatible, Mistral, OpenRouter...).
export class OpenAICompatProvider extends Provider {
  get baseUrl() { return ""; }
  async chat({ messages = [], system, signal, params = {}, model } = {}) {
    const msgs = system ? [{ role: "system", content: system }, ...messages] : messages;
    let res;
    try {
      res = await this.fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ model: model || this.model, messages: msgs, ...params }),
        signal,
      });
    } catch (e) {
      throw new ProviderError(`${this.id}: sin conexión (${e.message})`, { status: 0 });
    }
    const headers = normHeaders(res.headers);
    if (!res.ok) {
      let detalle = "";
      try { detalle = (await res.text()).slice(0, 200); } catch { /* sin detalle */ }
      throw new ProviderError(`${this.id}: HTTP ${res.status} ${detalle}`, { status: res.status, headers });
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content ?? "";
    const tokens = data?.usage?.total_tokens ?? 0;
    return { text, tokens, headers };
  }
}
