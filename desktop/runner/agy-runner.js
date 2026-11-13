// Ejecuta Antigravity CLI (agy) como proceso hijo (sin shell, sin GEMINI_API_KEY). Formato de salida SIN VERIFICAR:
// se aceptan stream-json (una línea JSON por evento), un JSON único {response, stats} o texto plano.
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

function findCommand(o) {
  const n = String(o?.tool_name || o?.name || o?.tool || "");
  if (!/shell|bash|command|terminal/i.test(n)) return null;
  const a = o.args || o.input || o.parameters || o.tool_input || {};
  return typeof a.command === "string" ? a.command : null;
}

function tokensOf(o) {
  const s = o?.stats || o?.usage || {};
  const sum = (k) => (s.models ? Object.values(s.models).reduce((t, m) => t + (m?.tokens?.[k] || 0), 0) : 0);
  return {
    tokens_in: Number(s.input_tokens ?? s.promptTokenCount ?? sum("prompt")) || 0,
    tokens_out: Number(s.output_tokens ?? s.candidatesTokenCount ?? sum("candidates")) || 0,
  };
}

// Devuelve { text, isError, errorKind, usage, commands, blocked, aborted, exitCode, stderr }.
export function runAgy({ command, prefix = [], args, stdin, cwd, env = process.env, onEvents = () => {}, timeoutMs = 30 * 60_000, spawnFn = spawn }) {
  return new Promise((resolve) => {
    const child = spawnFn(command, [...prefix, ...args], { cwd, env: { ...agyEnv(env), ...(prefix.length && process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}) }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, shell: false });
    const out = { text: "", isError: false, errorKind: null, usage: { tokens_in: 0, tokens_out: 0 }, commands: [], blocked: null, aborted: null, exitCode: null, stderr: "" };
    let buf = "", raw = "", finished = false, errMsg = "";
    const parts = [];
    const kill = (why) => { if (!out.aborted) { out.aborted = why; try { child.kill(); } catch { /* ya terminó */ } } };
    const timer = setTimeout(() => kill("tiempo"), timeoutMs);

    const handle = (line) => {
      const s = line.trim(); if (!s) return;
      let m; try { m = JSON.parse(s); } catch { onEvents([{ kind: "texto", text: s.slice(0, 300) }]); parts.push(s); return; }
      if (!m || typeof m !== "object") return;
      const cmd = findCommand(m);
      if (cmd) {
        out.commands.push(cmd); onEvents([{ kind: "herramienta", text: `Bash: ${cmd.slice(0, 120)}` }]);
        const b = blockedForGemini(cmd);
        if (b) { out.blocked = { ...b, detail: cmd }; kill("comando_bloqueado"); }
        return;
      }
      const t = typeof m.response === "string" ? m.response
        : (m.type === "message" && m.role !== "user" && typeof m.content === "string") ? m.content
        : typeof m.text === "string" ? m.text : null;
      if (t) { if (typeof m.response === "string") out.text = t; else parts.push(t); onEvents([{ kind: "texto", text: t.trim().slice(0, 300) }]); }
      if (m.type === "result" || m.stats || m.usage) { const u = tokensOf(m); if (u.tokens_in || u.tokens_out) out.usage = u; }
      if (m.error || m.type === "error" || m.status === "error") { out.isError = true; errMsg = JSON.stringify(m.error ?? m).slice(0, 500); }
    };
    child.stdout.on("data", (d) => { const s = d.toString("utf8"); raw += s; buf += s; let i; while ((i = buf.indexOf("\n")) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); } });
    child.stderr.on("data", (d) => { out.stderr = (out.stderr + d.toString("utf8")).slice(-3000); });
    const done = (code, err) => {
      if (finished) return; finished = true; clearTimeout(timer);
      if (buf.trim()) handle(buf);
      out.exitCode = code;
      if (!out.text) { // un único JSON multilínea
        try { const j = JSON.parse(raw); if (typeof j.response === "string") { out.text = j.response; out.usage = tokensOf(j); } } catch { /* no era un único JSON */ }
      }
      if (!out.text) out.text = parts.join("\n").trim();
      if (err) { out.isError = true; out.text = out.text || `No pude ejecutar Antigravity CLI (agy): ${err.message}`; }
      if (code) out.isError = true;
      if (out.isError) out.errorKind = classifyAgyError(`${errMsg}\n${out.stderr}\n${out.text}`);
      resolve(out);
    };
    child.on("error", (e) => done(null, e));
    child.on("close", (c) => done(c));
    child.stdin.on("error", () => {});
    child.stdin.end(stdin);
  });
}
