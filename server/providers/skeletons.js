// Esqueletos APAGADOS: existen para que la cadena los conozca, pero nunca se activan
// hasta las fases 3 a 5 (enabled siempre es false, aunque haya clave).
import { OpenAICompatProvider } from "./base.js";

function skeleton(id, name, baseUrl, model) {
  return class extends OpenAICompatProvider {
    constructor(opts = {}) { super({ id, name, model, ...opts }); this.skeleton = true; }
    get baseUrl() { return baseUrl; }
  };
}

export const MistralProvider = skeleton("mistral", "Mistral", "https://api.mistral.ai/v1", "ministral-8b-latest");
export const OpenRouterProvider = skeleton("openrouter", "OpenRouter", "https://openrouter.ai/api/v1", "deepseek/deepseek-chat-v3-0324:free");
export const OpenAIProvider = skeleton("openai", "ChatGPT", "https://api.openai.com/v1", "gpt-4o-mini");
export const XaiProvider = skeleton("xai", "Grok", "https://api.x.ai/v1", "grok-2");
export const PerplexityProvider = skeleton("perplexity", "Perplexity", "https://api.perplexity.ai", "sonar");
export const CloudflareProvider = skeleton("cloudflare", "Cloudflare Workers AI", "https://api.cloudflare.com/client/v4", "@cf/meta/llama-3.1-8b-instruct");
export const OllamaProvider = skeleton("ollama", "Ollama", "http://localhost:11434/v1", "llama3.1");
