// Construye los proveedores a partir de config/providers.json y las variables de entorno.
import { FakeProvider } from "./fake.js";
import { GroqProvider } from "./groq.js";
import { GeminiProvider } from "./gemini.js";
import { OpenRouterProvider } from "./openrouter.js";
import { MistralProvider, CloudflareProvider, OllamaProvider, OpenAIProvider, XaiProvider, PerplexityProvider } from "./more.js";

export function buildProviders({ env = process.env, fetch: f, config } = {}) {
  const key = (n) => (n && env[n]) || "";
  const cfg = config?.proveedores || {};
  const mk = (Cls, id, extra = {}) => new Cls({ apiKey: key(cfg[id]?.env), fetch: f, ...(cfg[id]?.modelo ? { model: cfg[id].modelo } : {}), ...extra });
  const list = [
    mk(GeminiProvider, "gemini"), mk(GroqProvider, "groq"),
    mk(MistralProvider, "mistral"), mk(OpenRouterProvider, "openrouter"),
    mk(CloudflareProvider, "cloudflare", { accountId: env.CLOUDFLARE_ACCOUNT_ID || "" }),
    mk(OllamaProvider, "ollama", { url: env.OLLAMA_URL || "", apiKey: "local" }),
    mk(OpenAIProvider, "openai"), mk(XaiProvider, "xai"),
    mk(PerplexityProvider, "perplexity", { effort: cfg.perplexity?.esfuerzo || "low" }),
    new FakeProvider(),
  ];
  return Object.fromEntries(list.map((p) => [p.id, p]));
}
