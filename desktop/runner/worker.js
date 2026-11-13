// Bucle del agente: avisa "PC en línea", recoge tareas de la cola y las pasa a Claude Code.
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { buildArgs, buildStdin } from "./claude-args.js";
import { classifyDenial, allowRule } from "./danger.js";
import { runClaude as realRun, resolveClaude } from "./claude-runner.js";
import { buildAgyArgs, buildAgyPrompt, MAX_PEDIDO, MODELO_DEFECTO, isProhibited, normalizeModel } from "./agy-args.js";
import { runAgy as realRunAgy, resolveAgy } from "./agy-runner.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_RONDAS = 3; // veces que una tarea puede pedir aprobaciones y continuar

export function createWorker({
  hub, log = () => {}, version = "0.1.0", host = "PC",
  claude = null,                 // { command, prefix } (por defecto se busca en el PC)
  runClaude = realRun,           // inyectable para pruebas
  agy = null,                    // { command, prefix } o función que lo resuelve (Antigravity CLI; por defecto se busca en el PC)
  runAgy = realRunAgy,           // inyectable para pruebas
  geminiFolders = null,          // carpetas de Gemini; si es null se usan carpetas_gemini del hub
  geminiDefaultDir = join(homedir(), "Documents", "Jarvis", "gemini"),
  folders = null,                // si es null se usan las que manda el hub (config/permissions.json)
  fallbackCwd = process.cwd(),
  pollMs = 5000, approvalPollMs = 3000, heartbeatMs = 15000, tapeWaitMs = 60_000,
  maxTurns = 30, model = null, onStatus = () => {},
  pro = null,                    // worker del Modo Pro ({tick}); se atiende cuando la cola clásica está vacía
  getCapabilities = null,        // () => capabilities del doctor (se manda en hello y heartbeat)
}) {
  let running = false, paused = false, current = null, serverCfg = { caps: {}, permissions: {} };
  const status = (extra = {}) => onStatus({ running, paused, current, ...extra });
  let halted = false;
  const capsBody = () => { const c = getCapabilities?.(); return c ? { capabilities: c } : {}; };
  const stopped = () => halted;

  async function waitApproval(approval, ttlMs) {
    const t0 = Date.now();
    while (!stopped() && Date.now() - t0 <= ttlMs + 5000) {
      const s = await hub.approvalStatus(approval.id);
      if (s.status !== "pendiente") return s.status;
      await sleep(approvalPollMs);
    }
    return "caducada";
  }

  // Gemini (agy): solo en carpetas_gemini (separadas de las de Claude). v1 sin ronda de aprobación: lo que agy
  // rechaza o lo que el runner bloquea queda anotado como "[Sin permiso: ...]" y la cola ofrece "Pasar a Claude".
  const geminiDirs = () => { const perm = serverCfg.permissions || {}; return (geminiFolders ?? (perm.carpetas_gemini?.length ? perm.carpetas_gemini : [geminiDefaultDir])).filter(Boolean); };
  const geminiActive = () => serverCfg.motores?.gemini?.activo === true; // apagado por defecto: solo "true" lo enciende
  async function processGemini(task) {
    if (!geminiActive()) return hub.finish(task.id, { status: "fallida", result: "Gemini del PC está apagado (motores_pc.gemini.activo=false en config/providers.json). No se ejecutó nada; use \"Pasar a Claude\"." });
    const dirs = geminiDirs();
    const cwd = dirs[0] || geminiDefaultDir;
    try { mkdirSync(cwd, { recursive: true }); } catch { /* ya existe */ }
    const original = buildStdin({ ...task, mode: "directo", prepared: null });
    if (createHash("sha256").update(original).digest("hex") !== task.sha256) {
      return hub.finish(task.id, { status: "fallida", result: "El texto llegó alterado (sha256 distinto); no se ejecutó." });
    }
    const bin = typeof agy === "function" ? agy() : agy || resolveAgy();
    if (!bin) return hub.finish(task.id, { status: "fallida", result: "No encontré Antigravity CLI (agy) en este PC. Instálela e inicie sesión con `agy`." });
    const model = normalizeModel(serverCfg.motores?.gemini?.modelo || MODELO_DEFECTO);
    if (isProhibited(model)) return hub.finish(task.id, { status: "fallida", result: `Modelo no permitido para Gemini: ${model}.` });
    const prompt = buildAgyPrompt(buildStdin(task).toString("utf8"), "editar"); // texto guardado + límites (la integridad ya se comprobó arriba)
    if (prompt.length > MAX_PEDIDO) return hub.finish(task.id, { status: "fallida", result: "El pedido es demasiado largo para la línea de comandos de agy." });
    const queue = []; let flush = null;
    const send = () => { flush = null; const ev = queue.splice(0); if (ev.length) hub.events(task.id, ev).catch(() => {}); };
    const r = await runAgy({ ...bin, args: buildAgyArgs({ prompt, model }), cwd, allowedDirs: dirs, policy: "programar", onEvents: (ev) => { queue.push(...ev); flush ||= setTimeout(send, 800); } });
    if (flush) { clearTimeout(flush); send(); }
    const usage = { tokens_in: r.usage.tokens_in, tokens_out: r.usage.tokens_out };
    const nota = r.denials.length ? `\n[Sin permiso: ${r.denials.join("; ")}]` : "";
    if (r.aborted === "tiempo") return hub.finish(task.id, { status: "fallida", result: `Detenida: pasó el tiempo máximo.${nota}`, usage });
    const status = r.blocked ? "rechazada" : r.isError ? "fallida" : "hecha";
    return hub.finish(task.id, { status, result: ((r.text || r.stderr || "") + nota).trim(), usage });
  }

  async function processTask(task, caps) {
    if (task.engine === "gemini") return processGemini(task);
    const perm = serverCfg.permissions || {};
    const dirs = (folders ?? perm.carpetas_permitidas ?? []).filter(Boolean);
    const cwd = dirs[0] || fallbackCwd;
    try { mkdirSync(cwd, { recursive: true }); } catch { /* ya existe */ }
    // Integridad: los bytes que llegan deben tener el mismo sha256 que se guardó en la cola.
    const original = buildStdin({ ...task, mode: "directo", prepared: null });
    if (createHash("sha256").update(original).digest("hex") !== task.sha256) {
      return hub.finish(task.id, { status: "fallida", result: "El texto llegó alterado (sha256 distinto); no se ejecutó." });
    }
    const total = { tokens_in: 0, tokens_out: 0 };
    let stdin = buildStdin(task), resume = null, approved = [], last = null, notes = [];
    const ttl = (perm.aprobacion_caduca_minutos ?? 30) * 60_000;
    const bin = claude || resolveClaude();
    if (!bin) return hub.finish(task.id, { status: "fallida", result: "No encontré Claude Code en este PC. Instálelo (npm i -g @anthropic-ai/claude-code o el instalador oficial) e inicie sesión con `claude`." });

    for (let ronda = 0; ronda <= MAX_RONDAS; ronda++) {
      const restante = caps.por_tarea_tokens ? caps.por_tarea_tokens - total.tokens_in - total.tokens_out : null;
      const queue = []; let flush = null;
      const send = () => { flush = null; const ev = queue.splice(0); if (ev.length) hub.events(task.id, ev).catch(() => {}); };
      last = await runClaude({
        ...bin, args: buildArgs({ task, folders: dirs, approved, resume, maxTurns, model }), stdin, cwd, maxTokens: restante,
        onEvents: (ev) => { queue.push(...ev); flush ||= setTimeout(send, 800); },
      });
      if (flush) { clearTimeout(flush); send(); }
      total.tokens_in += last.usage.tokens_in; total.tokens_out += last.usage.tokens_out;
      if (last.aborted === "tope_tarea") return hub.finish(task.id, { status: "tope_tarea", result: `Detenida: pasó el tope de ${caps.por_tarea_tokens} tokens por tarea.\n${last.result}`.trim(), usage: total });
      if (last.isError || !last.denials.length || ronda === MAX_RONDAS) break;

      // Pidió algo peligroso: se pide aprobación al señor (tarjeta ámbar) y se continúa la misma sesión.
      const dec = [];
      for (const d of last.denials) {
        const c = classifyDenial(d);
        const a = (await hub.requestApproval(task.id, c)).approval;
        log(`Aprobación pedida (#${a.id}): ${c.kind}`);
        status({ waiting: c.summary });
        dec.push({ d, c, estado: await waitApproval(a, ttl) });
      }
      status({ waiting: null });
      const ok = dec.filter((x) => x.estado === "aprobada"), no = dec.filter((x) => x.estado !== "aprobada");
      notes.push(...no.map((x) => `${x.c.summary}: ${x.estado}`));
      if (!ok.length) return hub.finish(task.id, { status: "rechazada", result: `No se hizo: ${no.map((x) => `${x.c.summary} (${x.estado})`).join("; ")}`, usage: total });
      approved = [...approved, ...ok.map((x) => allowRule(x.d))];
      resume = last.sessionId;
      stdin = Buffer.from(`El señor aprobó: ${ok.map((x) => x.c.summary + " — " + x.c.detail).join("; ")}.${no.length ? ` Rechazó: ${no.map((x) => x.c.summary).join("; ")}; sigue sin eso.` : ""} Continúa.`, "utf8");
      if (!resume) break; // sin sesión no se puede continuar
    }
    const nota = notes.length ? `\n[Sin aprobar: ${notes.join("; ")}]` : "";
    return hub.finish(task.id, { status: last.isError || last.exitCode ? "fallida" : "hecha", result: ((last.result || last.stderr || "") + nota).trim(), usage: total });
  }

  // Avisa "PC en línea" y guarda la configuración del servidor (permisos, motores, Gemini activo o no).
  const sync = async () => { serverCfg = await hub.hello({ version, host, ...capsBody() }); return serverCfg; };

  // Un ciclo: devuelve "tarea" | "vacia" | "tope_diario" | "pausada".
  async function tick() {
    if (paused) return "pausada";
    const r = await hub.claim();
    if (!r.task) return r.reason === "tope_diario" ? "tope_diario" : "vacia";
    current = { id: r.task.id, seq: r.task.seq };
    status(); log(`Tarea #${r.task.seq} (${r.task.mode})`);
    try { await processTask(r.task, r.caps || {}); }
    catch (e) { await hub.finish(r.task.id, { status: "fallida", result: `Error del agente: ${e.message}` }).catch(() => {}); }
    current = null; status();
    return "tarea";
  }

  async function loop() {
    let hbTimer = null, said = false;
    const beat = () => hub.heartbeat({ paused, current_task: current, ...capsBody() }).catch(() => { said = false; });
    hbTimer = setInterval(beat, heartbeatMs); hbTimer.unref?.();
    while (running) {
      try {
        if (!said) { await sync(); said = true; log("PC en línea"); status({ online: true }); }
        const out = await tick();
        if (out === "tarea") continue; // sigue de inmediato con la siguiente
        if (pro && out === "vacia" && !paused) { const j = await pro.tick().catch((e) => { log(`Pro: ${e.message}`); if (e.status === 401 || e.status === 403) throw e; return "vacio"; }); if (j === "job") continue; }
        await sleep(out === "tope_diario" ? tapeWaitMs : pollMs);
      } catch (e) {
        said = false; status({ online: false, error: e.message });
        if (e.status === 401 || e.status === 403) { log("Token de agente rechazado"); running = false; }
        else await sleep(Math.min(30_000, pollMs * 2));
      }
    }
    clearInterval(hbTimer);
  }

  return {
    start() { if (running) return; running = true; halted = false; loop(); status(); },
    async stop() { running = false; halted = true; try { await hub.bye(); } catch { /* sin red */ } status(); },
    pause(v = true) { paused = !!v; status(); hub.heartbeat({ paused, current_task: current }).catch(() => {}); },
    isPaused: () => paused,
    geminiActive, geminiDirs, sync, tick, processTask,
  };
}
