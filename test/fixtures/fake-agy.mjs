// "gemini" falso para pruebas. Guarda stdin, args y entorno; FAKE_OUT = prefijo de salida.
// FAKE_503 = modelos (separados por coma) que responden 503; FAKE_QUOTA=1 responde 429 cuota agotada;
// FAKE_EDIT="ruta:contenido" escribe ese archivo en el cwd si el prompt no es de solo lectura;
// FAKE_CMD = comando de shell que "ejecuta" (para probar el bloqueo); FAKE_RESULT = texto de respuesta.
import { writeFileSync, existsSync } from "node:fs";

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const base = process.env.FAKE_OUT;
let n = 0; while (existsSync(`${base}.${n}.stdin`)) n++;
const args = process.argv.slice(2);
writeFileSync(`${base}.${n}.stdin`, Buffer.concat(chunks));
writeFileSync(`${base}.${n}.args.json`, JSON.stringify(args));
writeFileSync(`${base}.${n}.env.json`, JSON.stringify({ GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? null }));

const model = args[args.indexOf("--model") + 1];
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
if ((process.env.FAKE_503 || "").split(",").includes(model)) {
  process.stderr.write("[API Error: 503 Service Unavailable: The model is overloaded]\n");
  process.exit(1);
}
if (process.env.FAKE_QUOTA) {
  process.stderr.write("[API Error: 429 RESOURCE_EXHAUSTED: quota exceeded]\n");
  process.exit(1);
}
if (process.env.FAKE_CMD) out({ type: "tool_use", tool_name: "run_shell_command", args: { command: process.env.FAKE_CMD } });
if (process.env.FAKE_EDIT && !Buffer.concat(chunks).toString().startsWith("MODO SOLO LECTURA")) {
  const i = process.env.FAKE_EDIT.indexOf(":");
  writeFileSync(process.env.FAKE_EDIT.slice(0, i), process.env.FAKE_EDIT.slice(i + 1));
}
out({ type: "message", role: "assistant", content: process.env.FAKE_RESULT || `Hecho con ${model}.` });
out({ type: "result", stats: { models: { [model]: { tokens: { prompt: 120, candidates: 30 } } } } });
