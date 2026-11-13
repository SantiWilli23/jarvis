// Construye los proveedores a partir de config/providers.json y las variables de entorno.
import { FakeProvider } from "./fake.js";
import { GroqProvider } from "./groq.js";
import { GeminiProvider } from "./gemini.js";
import { OpenRouterProvider } from "./openrouter.js";
import * as sk from "./skeletons.js";

export function buildProviders({ env = process.env, fetch: f, config } = {}) {
  const key = (n) => (n && env[n]) || "";
  const cfg = config?.proveedores || {};
  const mk = (Cls, id) => new Cls({ apiKey: key(cfg[id]?.env), fetch: f, ...(cfg[id]?.modelo ? { model: cfg[id].modelo } : {}) });
  const list = [
    mk(GeminiProvider, "gemini"), mk(GroqProvider, "groq"),
    mk(sk.MistralProvider, "mistral"), mk(OpenRouterProvider, "openrouter"),
    mk(sk.CloudflareProvider, "cloudflare"), mk(sk.OllamaProvider, "ollama"),
    new sk.OpenAIProvider({ apiKey: key("OPENAI_API_KEY"), fetch: f }),
    new sk.XaiProvider({ apiKey: key("XAI_API_KEY"), fetch: f }),
    new sk.PerplexityProvider({ apiKey: key("PERPLEXITY_API_KEY"), fetch: f }),
    new FakeProvider(),
  ];
  return Object.fromEntries(list.map((p) => [p.id, p]));
}
