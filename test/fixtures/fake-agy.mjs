// `agy` falso (formato real de `agy -p ... --output-format stream-json`, capturado con agy 1.5.8).
// Guarda el pedido (-p), args y entorno; FAKE_OUT = prefijo de los archivos que escribe.
// FAKE_503 = modelos (coma) que responden 503; FAKE_QUOTA=1 -> 429; FAKE_EDIT="ruta:contenido" escribe ese archivo
// si el pedido no es de solo lectura; FAKE_CMD = comando de shell que "ejecuta"; FAKE_RESULT = respuesta;
// FAKE_DENY=texto -> una herramienta rechazada por permisos; FAKE_STATUS=ERROR -> result.status distinto de SUCCESS.
import { writeFileSync, existsSync } from "node:fs";

const base = process.env.FAKE_OUT;
let n = 0; while (existsSync(`${base}.${n}.stdin`)) n++;
const args = process.argv.slice(2);
const prompt = args[args.indexOf("-p") + 1] ?? "";
writeFileSync(`${base}.${n}.stdin`, prompt);
writeFileSync(`${base}.${n}.args.json`, JSON.stringify(args));
writeFileSync(`${base}.${n}.env.json`, JSON.stringify({ GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? null, cwd: process.cwd() }));

const model = args[args.indexOf("--model") + 1];
const conv = "c7dcb5ed-0000-4000-8000-000000000000";
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const step = (o) => out({ event: "step_update", step_update: { conversation_id: conv, ...o } });
if ((process.env.FAKE_503 || "").split(",").includes(model)) {
  process.stderr.write("[API Error: 503 Service Unavailable: The model is overloaded]\n");
  process.exit(1);
}
if (process.env.FAKE_QUOTA) {
  process.stderr.write("[API Error: 429 RESOURCE_EXHAUSTED: quota exceeded]\n");
  process.exit(1);
}
out({ event: "init", conversation_id: conv, init: { model, cwd: process.cwd(), tools: ["write_file", "run_command"], permission_mode: "request-review" } });
step({ step_index: 0, state: "DONE", step_type: "user_input" });
if (process.env.FAKE_CMD) {
  step({ step_index: 1, state: "ACTIVE", step_type: "tool", tool_name: "run_command", tool_info: { name: "run_command", parameters: { CommandLine: process.env.FAKE_CMD } } });
}
if (process.env.FAKE_DENY) {
  step({ step_index: 2, state: "DONE", step_type: "tool", tool_name: "run_command", tool_info: { name: "run_command", parameters: { CommandLine: "x" }, error: process.env.FAKE_DENY } });
}
if (process.env.FAKE_EDIT && !prompt.startsWith("MODO SOLO LECTURA")) {
  const i = process.env.FAKE_EDIT.indexOf(":");
  writeFileSync(process.env.FAKE_EDIT.slice(0, i), process.env.FAKE_EDIT.slice(i + 1));
}
const text = process.env.FAKE_RESULT || `Hecho con ${model}.`;
step({ step_index: 3, state: "ACTIVE", step_type: "agent_response", text_delta: text });
step({ step_index: 3, state: "DONE", step_type: "agent_response", text_delta: "\n", duration_seconds: 3.49, usage: { input_tokens: 9735, output_tokens: 198, thinking_tokens: 177, cache_read_tokens: 0, total_tokens: 9933 } });
out({ event: "result", result: { conversation_id: conv, status: process.env.FAKE_STATUS || "SUCCESS", response: text + "\n", duration_seconds: 3.65, num_turns: 1, usage: { input_tokens: 9735, output_tokens: 198, thinking_tokens: 177, cache_read_tokens: 0, total_tokens: 9933 } } });
