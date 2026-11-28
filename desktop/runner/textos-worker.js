// Claude sin herramientas (docs/CONTROL.md): reclama un pedido de texto, lo pasa por stdin a `claude -p` sin
// herramientas en una carpeta temporal vacía y devuelve el texto. El freno mata el proceso y no se envía nada.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildTextosArgs } from "./claude-args.js";
import { runClaude as realRun, resolveClaude as realResolve, TTL_CORTO } from "./claude-runner.js";
import { controlState } from "./control-state.js";

export const TEXTOS_TIMEOUT_MS = 5 * 60_000;

export function createTextosWorker({ hub, claude = null, runClaude = realRun, resolveClaude = realResolve, control = controlState, log = () => {}, model = "sonnet", timeoutMs = TEXTOS_TIMEOUT_MS }) {
  async function enviar(id, out) {
    try { await hub.textosResult(id, out); }
    catch (e) { if (e.status !== 409 && e.status !== 404) throw e; } // frenada, vencida o cancelada en el servidor
  }

  async function tick() {
    if (control.frenado()) return "frenada";
    const { task } = (await hub.textosClaim()) || {};
    if (!task) return "vacio";
    const abort = new AbortController();
    const soltar = control.onFreno(() => abort.abort());
    let cwd = null, herramienta = false;
    try {
      if (abort.signal.aborted) return "frenada";
      const bin = claude || resolveClaude();
      if (!bin) { await enviar(task.id, { estado: "error", error: "sin_claude" }); return "tarea"; }
      log(`Texto #${task.id} (${task.tipo})`);
      cwd = mkdtempSync(join(tmpdir(), "jarvis-textos-"));
      const r = await runClaude({
        ...bin, args: buildTextosArgs({ model }), stdin: Buffer.from(String(task.texto), "utf8"), cwd,
        env: { ...process.env, ...TTL_CORTO },
        signal: abort.signal, killTree: true, timeoutMs,
        onMessage: (m) => { if (m.type === "assistant" && m.message?.content?.some((b) => b.type === "tool_use")) { herramienta = true; abort.abort(); } },
      });
      if (control.frenado()) return "frenada";
      const mal = herramienta || r.aborted || r.isError || r.exitCode || !r.result;
      const error = herramienta ? "herramienta" : r.aborted === "tiempo" ? "tiempo" : r.errorKind || "error";
      await enviar(task.id, mal ? { estado: "error", error } : { estado: "ok", texto: r.result });
      return "tarea";
    } finally {
      soltar();
      if (cwd) try { rmSync(cwd, { recursive: true, force: true }); } catch { /* lo limpia el sistema */ }
    }
  }

  return { tick };
}
