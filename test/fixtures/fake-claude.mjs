// "claude" falso para pruebas: lee stdin, lo guarda byte a byte y emite stream-json de ejemplo.
// FAKE_OUT = prefijo de archivos de salida; FAKE_MODE = ok | deny | big.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const stdin = Buffer.concat(chunks);
const base = process.env.FAKE_OUT;
let n = 0; while (existsSync(`${base}.${n}.stdin`)) n++;
writeFileSync(`${base}.${n}.stdin`, stdin);
writeFileSync(`${base}.${n}.args.json`, JSON.stringify(process.argv.slice(2)));

const args = process.argv.slice(2);
const resumed = args.includes("--resume");
const allowed = (args[args.indexOf("--allowedTools") + 1] || "");
const mode = process.env.FAKE_MODE || "ok";
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");

out({ type: "system", subtype: "init", session_id: "sesion-falsa-1", tools: [] });
out({ type: "assistant", message: { content: [{ type: "text", text: "Voy a trabajar en ello." }, { type: "tool_use", name: "Read", input: { file_path: "a.txt" } }], usage: { input_tokens: mode === "big" ? 9000 : 10, output_tokens: mode === "big" ? 9000 : 5 } } });
let denials = [], text = "Listo, señor.";
if (mode === "deny" && !/Bash\(rm /.test(allowed)) {
  denials = [{ tool_name: "Bash", tool_use_id: "t1", tool_input: { command: "rm viejo.txt" } }];
  text = "No pude borrar sin permiso.";
}
out({ type: "result", subtype: "success", is_error: false, result: text, session_id: "sesion-falsa-1", permission_denials: denials, usage: { input_tokens: 100, cache_creation_input_tokens: 20, output_tokens: 50 } });
