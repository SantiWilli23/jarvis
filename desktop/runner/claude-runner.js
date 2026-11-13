// Ejecuta `claude` como proceso hijo y lee su stream-json. Nunca usa shell.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, delimiter } from "node:path";

// Busca el ejecutable real de Claude Code. En Windows evita .cmd (haría falta un shell): usa claude.exe
// (instalador nativo) o el cli.js del paquete npm ejecutado con node.
export function resolveClaude({ env = process.env, platform = process.platform, exists = existsSync } = {}) {
  if (env.JARVIS_CLAUDE_PATH) return { command: env.JARVIS_CLAUDE_PATH, prefix: [] };
  const exe = platform === "win32" ? "claude.exe" : "claude";
  for (const dir of (env.PATH || env.Path || "").split(delimiter).filter(Boolean)) {
    if (exists(join(dir, exe))) return { command: join(dir, exe), prefix: [] };
  }
  if (platform === "win32") {
    const home = env.USERPROFILE || "";
    const nativo = join(home, ".local", "bin", "claude.exe");
    if (exists(nativo)) return { command: nativo, prefix: [] };
    const cli = join(env.APPDATA || "", "npm", "node_modules", "@anthropic-ai", "claude-code", "cli.js");
    if (exists(cli)) return { command: process.execPath, prefix: [cli], nodeAsElectron: !!process.versions.electron };
  }
  return null;
}

// Convierte las líneas de stream-json en eventos sencillos para el hub.
export function normalizeEvent(m) {
  if (m.type === "system" && m.subtype === "init") return { kind: "inicio", text: "Claude empezó", session_id: m.session_id };
  if (m.type === "assistant") {
    const out = [];
    for (const b of m.message?.content || []) {
      if (b.type === "text" && b.text?.trim()) out.push({ kind: "texto", text: b.text.trim().slice(0, 300) });
      if (b.type === "tool_use") out.push({ kind: "herramienta", text: `${b.name}${b.input?.command ? ": " + String(b.input.command).slice(0, 120) : b.input?.file_path ? ": " + b.input.file_path : ""}` });
    }
    return out;
  }
  return null;
}

// Devuelve { result, isError, sessionId, usage:{tokens_in,tokens_out}, denials, aborted, exitCode }.
export function runClaude({ command, prefix = [], args, stdin, cwd, env = process.env, onEvents = () => {}, maxTokens = null, timeoutMs = 30 * 60_000, spawnFn = spawn }) {
  return new Promise((resolve) => {
    const child = spawnFn(command, [...prefix, ...args], { cwd, env: { ...env, ...(prefix.length && process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}) }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, shell: false });
    const out = { result: "", isError: false, sessionId: null, usage: { tokens_in: 0, tokens_out: 0 }, denials: [], aborted: null, exitCode: null, stderr: "" };
    let buf = "", running = { in: 0, out: 0 }, finished = false;
    const kill = (why) => { if (!out.aborted) { out.aborted = why; try { child.kill(); } catch { /* ya terminó */ } } };
    const timer = setTimeout(() => kill("tiempo"), timeoutMs);

    const handle = (line) => {
      if (!line.trim()) return;
      let m; try { m = JSON.parse(line); } catch { return; }
      if (m.session_id) out.sessionId = m.session_id;
      const ev = normalizeEvent(m);
      if (ev) onEvents([].concat(ev));
      if (m.type === "assistant" && m.message?.usage) {
        running.in += (m.message.usage.input_tokens || 0) + (m.message.usage.cache_creation_input_tokens || 0);
        running.out += m.message.usage.output_tokens || 0;
        if (maxTokens && running.in + running.out > maxTokens) kill("tope_tarea");
      }
      if (m.type === "result") {
        out.result = String(m.result ?? "");
        out.isError = !!m.is_error || (m.subtype && m.subtype !== "success");
        out.denials = Array.isArray(m.permission_denials) ? m.permission_denials : [];
        const u = m.usage || {};
        out.usage = { tokens_in: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0), tokens_out: u.output_tokens || 0 };
      }
    };
    child.stdout.on("data", (d) => { buf += d.toString("utf8"); let i; while ((i = buf.indexOf("\n")) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); } });
    child.stderr.on("data", (d) => { out.stderr = (out.stderr + d.toString("utf8")).slice(-2000); });
    const done = (code, err) => {
      if (finished) return; finished = true; clearTimeout(timer);
      if (buf.trim()) handle(buf);
      out.exitCode = code;
      if (err) { out.isError = true; out.result = out.result || `No pude ejecutar Claude: ${err.message}`; }
      if (out.aborted && out.usage.tokens_in + out.usage.tokens_out === 0) out.usage = { tokens_in: running.in, tokens_out: running.out };
      resolve(out);
    };
    child.on("error", (e) => done(null, e));
    child.on("close", (c) => done(c));
    child.stdin.on("error", () => {}); // el proceso pudo cerrar antes de leer todo
    child.stdin.end(stdin);
  });
}
