// Proveedor de pruebas: no usa red ni claves. Sirve en el modo sin claves y en los tests.
import { Provider } from "./base.js";

export class FakeProvider extends Provider {
  constructor(opts = {}) {
    super({ id: "fake", name: "Proveedor de pruebas", apiKey: "local", ...opts });
    this.calls = [];
  }
  get enabled() { return true; }
  async chat({ messages = [], system = "" } = {}) {
    this.calls.push({ messages, system });
    const last = [...messages].reverse().find((m) => m.role === "user")?.content || "";
    // Si se pide JSON (modo Preparar), devuelve una preparación simple.
    if (/json/i.test(system)) {
      return { text: JSON.stringify({ resumen: String(last).slice(0, 80), pasos: ["Entender el pedido", "Hacerlo", "Avisar al señor"], preguntas: [] }), tokens: 10, headers: {} };
    }
    return { text: `Entendido, señor. (Respuesta simulada: no hay claves configuradas.) Dijo: "${String(last).slice(0, 120)}".`, tokens: 10, headers: {} };
  }
}
