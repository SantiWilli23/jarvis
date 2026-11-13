import { OpenAICompatProvider } from "./base.js";

// Gemini por su endpoint compatible con OpenAI (documentado por Google).
export class GeminiProvider extends OpenAICompatProvider {
  constructor(opts = {}) {
    super({ id: "gemini", name: "Gemini", model: "gemini-2.0-flash-lite", ...opts });
  }
  get baseUrl() { return "https://generativelanguage.googleapis.com/v1beta/openai"; }
}
