import { OpenAICompatProvider } from "./base.js";

export class GroqProvider extends OpenAICompatProvider {
  constructor(opts = {}) {
    super({ id: "groq", name: "Groq", model: "openai/gpt-oss-120b", ...opts });
  }
  get baseUrl() { return "https://api.groq.com/openai/v1"; }
  // gpt-oss admite reasoning_effort low|medium|high (console.groq.com/docs/reasoning): en charla, "low" para contestar antes.
  // En lo demás no se manda nada (queda el valor por defecto del proveedor).
  chat({ kind, params, ...opts } = {}) {
    const rapido = kind === "charla" && /gpt-oss/.test(opts.model || this.model);
    return super.chat({ ...opts, params: rapido ? { reasoning_effort: "low", ...params } : params });
  }
}
