import { OpenAICompatProvider } from "./base.js";

export class GroqProvider extends OpenAICompatProvider {
  constructor(opts = {}) {
    super({ id: "groq", name: "Groq", model: "openai/gpt-oss-120b", ...opts });
  }
  get baseUrl() { return "https://api.groq.com/openai/v1"; }
}
