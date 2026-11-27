// Genera como pregrabadas (voz de config/providers.json) las frases fijas que Jarvis repite.
// Uso: node scripts/gen-frases.mjs [máximo de peticiones, 8 por defecto]
// Clave: GEMINI_API_KEY del entorno, del archivo JARVIS_ENV, de .env o de ../jarvis/.env. Nunca se muestra.
// Va de a poco; ante un 429 se detiene y dice cuáles faltan. Solo anota en el manifiesto lo que tiene audio.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { normalizePhrase, pedirGemini, wavDeGemini } from "../server/tts.js";

// El texto tiene que ser la respuesta literal completa (se compara sin mayúsculas ni puntuación).
const FRASES = [
  ["anotado-en-cola", "Anotado, señor. Lo dejé en cola, palabra por palabra, y se lo entrego a Claude en cuanto encienda su PC."],
  ["preparado-claude", "Lo preparé para Claude en el PC, señor. Revise los pasos en la cola antes de enviarlo."],
  ["sin-cupo", "Mis proveedores gratuitos llegaron a su límite por ahora, señor. Lo reintento en cuanto se reinicien. Si quiere, puede pedírselo a Gemini con /gemini."],
  ["freno-puesto", "El freno está puesto, señor. Reanude desde la web cuando quiera."],
  ["no-le-oi-nada", "No le oí nada, señor."],
  ["anotado-sin-cupo", "Lo anoté en la cola para el PC, señor, pero sin ordenarlo: mis modelos están sin cuota."],
  ["no-oi-nada", "No oí nada, señor."],
  ["toque-play", "Toque play una vez, señor."],
];

const raiz = fileURLToPath(new URL("..", import.meta.url));
const dir = raiz + "web/audio/phrases/";
const manifiesto = dir + "manifest.json";

function clave() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  for (const p of [process.env.JARVIS_ENV, raiz + ".env", raiz + "../jarvis/.env"]) {
    if (p && existsSync(p)) { const k = dotenv.parse(readFileSync(p)).GEMINI_API_KEY; if (k) return k; }
  }
  return null;
}

async function main(maximo) {
  const apiKey = clave();
  if (!apiKey) return console.log("No hay GEMINI_API_KEY: no se generó nada.");
  const { gemini } = JSON.parse(readFileSync(raiz + "config/providers.json", "utf8")).voz;
  const m = JSON.parse(readFileSync(manifiesto, "utf8"));
  const faltan = FRASES.filter(([, texto]) => !m.frases.some((x) => normalizePhrase(x.texto) === normalizePhrase(texto) && existsSync(dir + x.archivo)));
  let pedidas = 0, hechas = 0;
  for (const [id, texto] of faltan) {
    if (pedidas >= maximo) break;
    if (pedidas) await new Promise((r) => setTimeout(r, 21_000)); // unas 3 por minuto
    pedidas++;
    let data;
    try {
      const res = await pedirGemini({ apiKey, modelo: gemini.modelo, voz: gemini.voz, text: texto, timeoutMs: 60_000 });
      if (!res.ok) { console.log(`Gemini respondió ${res.status}: me detengo.`); break; }
      data = await wavDeGemini(res);
    } catch (e) { console.log(`Falló la petición (${e.name}): me detengo.`); break; }
    if (!data) { console.log(`Sin audio: ${id}`); continue; }
    writeFileSync(dir + id + ".wav", data);
    m.frases = [...m.frases.filter((x) => x.id !== id), { id, texto, archivo: id + ".wav" }];
    const lineas = m.frases.map((x) => `    { "id": ${JSON.stringify(x.id)}, "texto": ${JSON.stringify(x.texto)}, "archivo": ${JSON.stringify(x.archivo)} }`);
    writeFileSync(manifiesto, `{\n  "nota": ${JSON.stringify(m.nota)},\n  "frases": [\n${lineas.join(",\n")}\n  ]\n}\n`);
    hechas++;
    console.log(`Generada: ${id} (${data.length} bytes)`);
  }
  const pendientes = faltan.filter(([id]) => !m.frases.some((x) => x.id === id)).map(([id]) => id);
  console.log(`Peticiones: ${pedidas}. Generadas: ${hechas}. Faltan: ${pendientes.join(", ") || "ninguna"}.`);
}

await main(Number(process.argv[2] ?? 8));
