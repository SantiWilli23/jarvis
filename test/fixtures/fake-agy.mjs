// "agy" falso para pruebas; imita el formato REAL de Antigravity CLI (-p <prompt>, stream-json).
// Guarda prompt, args y entorno; FAKE_OUT = prefijo de salida.
// FAKE_503 = modelos (coma) que fallan con 503 por stderr; FAKE_QUOTA=1 responde 429 por stderr;
// FAKE_EDIT="ruta:contenido" escribe ese archivo en el cwd SOLO con --mode accept-edits (como la CLI real);
// FAKE_CMD = comando de shell que "ejecuta" (para probar el bloqueo); FAKE_RESULT = texto de respuesta;
// FAKE_STATUS = status final distinto de SUCCESS.
import { writeFileSync, existsSync, readFileSync } from "node:fs";

const base = process.env.FAKE_OUT;
let n = 0; while (existsSync(`${base}.${n}.args.json`)) n++;
const args = process.argv.slice(2);
const val = (f) => { const i = args.findIndex((a) => a === f || a.startsWith(f + "=")); if (i < 0) return undefined; return args[i].includes("=") ? args[i].slice(args[i].indexOf("=") + 1) : args[i + 1]; };
const prompt = val("-p") ?? val("--print") ?? "";
const model = val("--model");
const mode = val("--mode");
const m = prompt.match(/^Lee y sigue exactamente las instrucciones de (.+)$/);
const effective = m ? readFileSync(m[1], "utf8") : prompt; // como view_file: el contenido real del prompt
writeFileSync(`${base}.${n}.args.json`, JSON.stringify(args));
writeFileSync(`${base}.${n}.prompt`, effective);
writeFileSync(`${base}.${n}.env.json`, JSON.stringify({ GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? null }));

const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
if ((process.env.FAKE_503 || "").split(",").includes(model)) {
  process.stderr.write("error: 503 Service Unavailable: model overloaded\n");
  process.exit(1);
}
if (process.env.FAKE_QUOTA) {
  process.stderr.write("error: 429 RESOURCE_EXHAUSTED: quota exceeded\n");
  process.exit(1);
}
const usage = { input_tokens: 120, output_tokens: 30, thinking_tokens: 5, total_tokens: 155 };
out({ event: "init", conversation_id: "conv-fake", init: { model, cwd: process.cwd(), tools: ["view_file", "run_command"], permission_mode: mode } });
if (process.env.FAKE_CMD) out({ event: "step_update", step_update: { step_type: "tool_call", tool_name: "run_command", args: { command: process.env.FAKE_CMD }, state: "DONE" } });
if (process.env.FAKE_EDIT && mode === "accept-edits") {
  const i = process.env.FAKE_EDIT.indexOf(":");
  writeFileSync(process.env.FAKE_EDIT.slice(0, i), process.env.FAKE_EDIT.slice(i + 1));
}
const text = process.env.FAKE_RESULT || `Hecho con ${model}.`;
out({ event: "step_update", step_update: { step_type: "agent_response", state: "ACTIVE", text_delta: text.slice(0, 20) } });
out({ event: "step_update", step_update: { step_type: "agent_response", state: "DONE", text_delta: text.slice(20), usage } });
out({ event: "result", result: { conversation_id: "conv-fake", status: process.env.FAKE_STATUS || "SUCCESS", response: text, duration_seconds: 1, usage } });
