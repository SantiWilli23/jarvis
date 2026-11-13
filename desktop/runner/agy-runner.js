// Ejecuta Antigravity CLI (agy) como proceso hijo (sin shell, sin GEMINI_API_KEY). Salida real (VERIFICADA):
// stream-json NDJSON: {event:"init"}, {event:"step_update"} y final {event:"result",result:{status,response,usage}}.
// Los errores (modelo inválido, 429/503) salen por stderr con código de salida distinto de 0.
import { spawn } from "node:child_process";
import { agyEnv } from "./agy-args.js";
import { blockedForGemini } from "./danger.js";

// "503" (servidor saturado: permite bajar de Flash), "sin_cuota" (429/cuota: NO se baja) o null.
export function classifyAgyError(text) {
  const t = String(text || "");
  if (/\b503\b|UNAVAILABLE|overloaded|sobrecargad/i.test(t)) return "503";
  if (/\b429\b|RESOURCE_EXHAUSTED|quota|rate.?limit|cuota/i.test(t)) return "sin_cuota";
  return null;
}

// Los pasos de herramienta reales no están documentados: se busca un comando de shell de forma tolerante.
function findCommand(o) {
  const n = String(o?.tool_name || o?.name || o?.tool || "");
  if (!/shell|bash|command|terminal/i.test(n)) return null;
  const a = o.args || o.input || o.parameters || o.tool_input || {};
  return typeof a.command === "string" ? a.command : null;
}

function tokensOf(o) {
  const s = o?.usage || {};
  return { tokens_in: Number(s.input_tokens) || 0, tokens_out: Number(s.output_tokens) || 0 };
}

// Devuelve { text, isError, errorKind, usage, commands, blocked, aborted, exitCode, stderr, conversationId }.
export function runAgy({ command, prefix = [], args, cwd, env = process.env, onEvents = () => {}, timeoutMs = 30 * 60_000, spawnFn = spawn }) {
  return new Promise((resolve) => {
    const child = spawnFn(command, [...prefix, ...args], { cwd, env: { ...agyEnv(env), ...(prefix.length && process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}) }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, shell: false });
    const out = { text: "", isError: false, errorKind: null, usage: { tokens_in: 0, tokens_out: 0 }, commands: [], blocked: null, aborted: null, exitCode: null, stderr: "", conversationId: null };
    let buf = "", finished = false, errMsg = "", gotResult = false;
    const parts = [], deltas = [];
    const kill = (why) => { if (!out.aborted) { out.aborted = why; try { child.kill(); } catch { /* ya terminó */ } } };
    const timer = setTimeout(() => kill("tiempo"), timeoutMs);

    const handle = (line) => {
      const s = line.trim(); if (!s) return;
      let m; try { m = JSON.parse(s); } catch { onEvents([{ kind: "texto", text: s.slice(0, 300) }]); parts.push(s); return; }
      if (!m || typeof m !== "object") return;
      const cmd = findCommand(m) || findCommand(m.step_update);
      if (cmd) {
        out.commands.push(cmd); onEvents([{ kind: "herramienta", text: `Bash: ${cmd.slice(0, 120)}` }]);
        const b = blockedForGemini(cmd);
        if (b) { out.blocked = { ...b, detail: cmd }; kill("comando_bloqueado"); }
        return;
      }
      if (m.event === "init") { out.conversationId = m.conversation_id || null; return; }
      if (m.event === "step_update" && m.step_update) {
        const su = m.step_update;
        if (su.step_type === "agent_response" && typeof su.text_delta === "string" && su.text_delta) { deltas.push(su.text_delta); onEvents([{ kind: "texto", text: su.text_delta.trim().slice(0, 300) }]); }
        const u = tokensOf(su); if (u.tokens_in || u.tokens_out) out.usage = u;
        return;
      }
      if (m.event === "result" && m.result) { // evento final: result.response es el texto completo
        const r = m.result; gotResult = true;
        if (typeof r.response === "string") out.text = r.response;
        const u = tokensOf(r); if (u.tokens_in || u.tokens_out) out.usage = u;
        if (r.status && r.status !== "SUCCESS") { out.isError = true; errMsg = `status ${r.status}: ${String(r.error || r.message || r.response || "").slice(0, 400)}`; }
        return;
      }
      if (m.error || m.event === "error") { out.isError = true; errMsg = JSON.stringify(m.error ?? m).slice(0, 500); }
    };
    child.stdout.on("data", (d) => { buf += d.toString("utf8"); let i; while ((i = buf.indexOf("\n")) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); } });
    child.stderr.on("data", (d) => { out.stderr = (out.stderr + d.toString("utf8")).slice(-3000); });
    const done = (code, err) => {
      if (finished) return; finished = true; clearTimeout(timer);
      if (buf.trim()) handle(buf);
      out.exitCode = code;
      if (!out.text) out.text = (deltas.join("") || parts.join("\n")).trim();
      if (err) { out.isError = true; out.text = out.text || `No pude ejecutar Antigravity CLI (agy): ${err.message}`; }
      if (code) out.isError = true;
      if (!code && !err && !gotResult && !out.text) { out.isError = true; errMsg ||= "sin resultado de agy"; }
      if (out.isError) out.errorKind = classifyAgyError(`${errMsg}\n${out.stderr}\n${out.text}`);
      resolve(out);
    };
    child.on("error", (e) => done(null, e));
    child.on("close", (c) => done(c));
    child.stdin.on("error", () => {});
    child.stdin.end(); // el prompt va en -p, no por stdin
  });
}
