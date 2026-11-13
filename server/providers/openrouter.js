import { OpenAICompatProvider } from "./base.js";

// OpenRouter (API compatible con OpenAI). SOLO modelos ":free": si el id configurado no termina
// en ":free", el proveedor queda apagado para no gastar dinero por accidente.
// NO recibe mensajes privados (no está en permite_privado).
export class OpenRouterProvider extends OpenAICompatProvider {
  constructor(opts = {}) {
    super({ id: "openrouter", name: "OpenRouter", model: "google/gemma-4-31b-it:free", ...opts });
  }
  get baseUrl() { return "https://openrouter.ai/api/v1"; }
  get enabled() { return !!this.apiKey && /:free$/.test(this.model || ""); }
}
