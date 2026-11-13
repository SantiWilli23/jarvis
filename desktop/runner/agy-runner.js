// Ejecuta Antigravity CLI (`agy -p ... --output-format stream-json`) como proceso hijo: sin shell, con stdin
// cerrado y sin claves de API. Parsea el NDJSON de forma tolerante (los eventos desconocidos se ignoran).
// Formato real (agy 1.5.8): {"event":"init"|"step_update"|"result", ...}. Ver test/fixtures/fake-agy.mjs.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, delimiter } from "node:path";
import { agyEnv } from "./agy-args.js";
import { guardTool, pathsOf, inside, POLITICAS } from "./agy-policy.js";

// Busca agy: JARVIS_AGY_PATH (o `configured`), PATH y %LOCALAPPDATA%\agy\bin\agy.exe.
export function resolveAgy({ env = process.env, platform = process.platform, exists = existsSync, configured = null } = {}) {
  const p = configured || env.JARVIS_AGY_PATH;
  if (p) return /\.m?js$/.test(p) ? { command: process.execPath, prefix: [p], nodeAsElectron: !!process.versions.electron } : { command: p, prefix: [] };
  const exe = platform === "win32" ? "agy.exe" : "agy";
  for (const dir of (env.PATH || env.Path || "").split(delimiter).filter(Boolean)) if (exists(join(dir, exe))) return { command: join(dir, exe), prefix: [] };
  const local = env.LOCALAPPDATA || (platform === "win32" ? join(env.USERPROFILE || "", "AppData", "Local") : "");
  if (local) { const f = join(local, "agy", "bin", exe); if (exists(f)) return { command: f, prefix: [] }; }
  return null;
}

// "503" (servidor saturado: permite bajar de Flash), "sin_cuota" (429/cuota: NO se baja) o null.
export function classifyAgyError(text) {
  const t = String(text || "");
  if (/\b503\b|UNAVAILABLE|overloaded|high demand|sobrecargad/i.test(t)) return "503";
  if (/\b429\b|RESOURCE_EXHAUSTED|quota|rate.?limit|cuota/i.test(t)) return "sin_cuota";
  return null;
}

const RECHAZO = /permission (denied|required|was denied)|not permitted|rejected|denied|requires? (user )?(approval|permission)|auto-?reject|no se permite|permiso/i;
const cmdOf = (params) => { const v = params?.CommandLine ?? params?.command ?? params?.Command; return typeof v === "string" ? v : null; };
export { guardTool };

// Devuelve { text, isError, errorKind, usage, commands, denials, blocked, aborted, conversationId, status, exitCode, stderr }.
export function runAgy({ command, prefix = [], args, cwd, env = process.env, onEvents = () => {}, timeoutMs = 30 * 60_000, allowedDirs = [], policy = POLITICAS.PROGRAMAR, spawnFn = spawn }) {
  return new Promise((resolveP) => {
    // Sin carpeta permitida, o con cwd fuera de ella, NO se ejecuta agy.
    if (!allowedDirs.length || !cwd || !inside(cwd, allowedDirs)) {
      return resolveP({ text: "Gemini no se ejecutó: la carpeta de trabajo no está dentro de carpetas_gemini.", isError: true, errorKind: "carpeta", usage: { tokens_in: 0, tokens_out: 0 }, commands: [], denials: ["carpeta de trabajo fuera de carpetas_gemini"], blocked: { kind: "fuera_de_carpeta", summary: "Carpeta de trabajo fuera de carpetas_gemini", detail: String(cwd) }, aborted: null, conversationId: null, status: null, exitCode: null, stderr: "" });
    }
    const child = spawnFn(command, [...prefix, ...args], { cwd, env: { ...agyEnv(env), ...(prefix.length && process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}) }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, shell: false });
    const out = { text: "", isError: false, errorKind: null, usage: { tokens_in: 0, tokens_out: 0 }, commands: [], denials: [], blocked: null, aborted: null, conversationId: null, status: null, exitCode: null, stderr: "" };
    let buf = "", finished = false, errMsg = "", gotResult = false;
    const checked = new Set();
    const deltas = new Map(); // step_index -> texto acumulado
    const plain = [];
    const kill = (why) => { if (!out.aborted) { out.aborted = why; try { child.kill(); } catch { /* ya terminó */ } } };
    const timer = setTimeout(() => kill("tiempo"), timeoutMs);
    const deny = (what, msg) => { const t = `${what}: ${String(msg).replace(/\s+/g, " ").slice(0, 160)}`; if (!out.denials.includes(t)) out.denials.push(t); };
    const usageOf = (u) => (u && typeof u === "object" ? { tokens_in: Number(u.input_tokens) || 0, tokens_out: Number(u.output_tokens) || 0 } : null);

    const handle = (line) => {
      const s = line.trim(); if (!s) return;
      let m; try { m = JSON.parse(s); } catch { plain.push(s); onEvents([{ kind: "texto", text: s.slice(0, 300) }]); return; }
      if (!m || typeof m !== "object") return;
      if (m.event === "init") {
        out.conversationId = m.init?.conversation_id || m.conversation_id || out.conversationId;
        onEvents([{ kind: "inicio", text: `Gemini empezó (${m.init?.model || "agy"})` }]);
        return;
      }
      if (m.event === "step_update" && m.step_update) {
        const u = m.step_update;
        out.conversationId ||= u.conversation_id || null;
        if (u.step_type === "agent_response" && typeof u.text_delta === "string") {
          deltas.set(u.step_index, (deltas.get(u.step_index) || "") + u.text_delta);
          if (u.state === "DONE") { const t = (deltas.get(u.step_index) || "").trim(); if (t) onEvents([{ kind: "texto", text: t.slice(0, 300) }]); }
        } else if (u.step_type === "tool") {
          const params = u.tool_info?.parameters || {};
          const tool = u.tool_name || u.tool_info?.name || "herramienta";
          if (!checked.has(u.step_index)) { // se revisa la PRIMERA vez que se ve la herramienta, sea cual sea su estado
            checked.add(u.step_index);
            const cmd = cmdOf(params);
            if (cmd) out.commands.push(cmd);
            onEvents([{ kind: "herramienta", text: cmd ? `Comando: ${cmd.slice(0, 120)}` : `${tool}: ${pathsOf(params)[0] || ""}`.slice(0, 160) }]);
            const b = guardTool({ tool, params }, allowedDirs, cwd, policy);
            if (b) { out.blocked = b; deny(b.summary, b.detail); kill("comando_bloqueado"); }
          }
          if (u.state !== "ACTIVE") {
            const bad = /ERROR|REJECT|DENIED|CANCEL/i.test(String(u.state)) ? u.tool_info?.error || u.tool_info?.output || u.state : (u.tool_info?.error || null);
            const why = bad || (RECHAZO.test(String(u.tool_info?.output || "")) ? u.tool_info.output : null);
            if (why) deny(tool, typeof why === "string" ? why : JSON.stringify(why));
          }
        }
        return;
      }
      if (m.event === "result" && m.result) {
        const r = m.result;
        out.status = r.status ?? null;
        gotResult = true;
        if (typeof r.response === "string") out.text = r.response;
        const us = usageOf(r.usage); if (us) out.usage = us;
        if (r.status && r.status !== "SUCCESS") { out.isError = true; errMsg = JSON.stringify(r.error ?? r).slice(0, 500); }
        return;
      }
      if (m.error || m.type === "error") { out.isError = true; errMsg = JSON.stringify(m.error ?? m).slice(0, 500); }
    };
    child.stdout.on("data", (d) => { buf += d.toString("utf8"); let i; while ((i = buf.indexOf("\n")) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); } });
    child.stderr.on("data", (d) => { out.stderr = (out.stderr + d.toString("utf8")).slice(-3000); });
    const done = (code, err) => {
      if (finished) return; finished = true; clearTimeout(timer);
      if (buf.trim()) handle(buf);
      out.exitCode = code;
      if (!out.text) out.text = [...deltas.values()].join("").trim() || plain.join("\n").trim();
      if (err) { out.isError = true; out.text = out.text || `No pude ejecutar Antigravity CLI (agy): ${err.message}`; }
      if (code) out.isError = true;
      if (!code && !err && !gotResult && !out.text) { out.isError = true; errMsg ||= "sin resultado de agy"; }
      if (RECHAZO.test(out.stderr)) deny("agy", out.stderr.split(/\r?\n/).find((l) => RECHAZO.test(l)) || out.stderr);
      if (out.denials.length) out.isError = true; // un rechazo de permiso cuenta como error (v1: sin ronda de aprobación)
      if (out.isError) out.errorKind = classifyAgyError(`${errMsg}\n${out.stderr}\n${out.text}`) || (out.denials.length ? "permiso" : null);
      resolveP(out);
    };
    child.on("error", (e) => done(null, e));
    child.on("close", (c) => done(c));
  });
}
