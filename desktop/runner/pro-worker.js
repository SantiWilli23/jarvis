// Worker del Modo Pro: reclama jobs de /api/agent/pro, los ejecuta con Claude Code o Gemini CLI dentro de un
// repo permitido, calcula el diff real (git-snapshot) y manda informe + diff. Contrato: docs/PRO.md §5-§7.
import { appendFileSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { buildProArgs } from "./claude-args.js";
import { policyFor } from "./agy-policy.js";
import { buildAgyArgs, prepareAgyPrompt, modelChain, isProhibited, normalizeModel, IGNORE_PRIVADOS } from "./agy-args.js";
import { classifyDenial, allowRule } from "./danger.js";
import { runClaude as realRunClaude, resolveClaude as realResolveClaude, classifyClaudeError } from "./claude-runner.js";
import { runAgy as realRunAgy } from "./agy-runner.js";
import * as gitSnap from "./git-snapshot.js";
import { isRetryable } from "./outbox.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_RONDAS = 3;

// .geminiignore (oculto para git vía .git/info/exclude para que no ensucie el diff). No pisa uno existente.
export async function ensureGeminiIgnore(repo) {
  try {
    const f = join(repo, ".geminiignore");
    if (!existsSync(f)) writeFileSync(f, IGNORE_PRIVADOS.join("\n") + "\n");
    const ex = (await gitSnap.git(repo, ["rev-parse", "--git-path", "info/exclude"])).trim();
    const exPath = isAbsolute(ex) ? ex : join(repo, ex);
    const cur = existsSync(exPath) ? readFileSync(exPath, "utf8") : "";
    if (!/^\.geminiignore$/m.test(cur)) appendFileSync(exPath, (cur && !cur.endsWith("\n") ? "\n" : "") + ".geminiignore\n");
  } catch { /* sin .git/info: no es grave */ }
}

// Intenta leer el informe JSON ({dijo_hizo, archivos_tocados, comandos, resultado}) del texto del motor.
export function parseInforme(text) {
  const t = String(text || "");
  const cand = [t.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1], t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1), t];
  for (const c of cand) {
    if (!c) continue;
    try { const j = JSON.parse(c); if (j && typeof j === "object" && !Array.isArray(j)) return j; } catch { /* siguiente */ }
  }
  return null;
}

export function createProWorker({
  hub, outbox = null, allowedFolders = () => [], log = () => {},
  claude = null, agy = null,                      // { command, prefix } o función que lo resuelve (agy = Antigravity CLI, motor "gemini" del contrato)
  runClaude = realRunClaude, runAgy = realRunAgy, resolveClaude = realResolveClaude,
  geminiActivo = () => false,            // Gemini del PC apagado por defecto (lo enciende el servidor: motores_pc.gemini.activo)
  geminiFolders = () => [],              // carpetas_gemini: el repo debe estar DENTRO de ellas
  snap = gitSnap, diffMax = 200000, approvalPollMs = 3000, approvalTtlMs = 30 * 60_000, onStatus = () => {}, cancelPollMs = 5000,
}) {
  const bin = (b, fallback) => { const v = typeof b === "function" ? b() : b; return v || (fallback ? fallback() : null); };

  // Entrega fiable: si falla por red/servidor dormido va al buzón y se reenvía luego.
  async function deliver(key, kind, jobId, body) {
    const send = (e) => (e.kind === "report" ? hub.proReport(e.jobId, e.body) : hub.proFail(e.jobId, e.body));
    try { await send({ kind, jobId, body }); }
    catch (e) {
      if (e?.status === 409 || e?.status === 404) return; // ya lo tenía
      if (outbox && isRetryable(e)) { outbox.put(key, { kind, jobId, body }); log(`Job ${jobId}: resultado guardado en el buzón (${e.message})`); }
      else log(`Job ${jobId}: no se pudo entregar (${e.message})`);
    }
  }
  const fail = (job, error) => { log(`Job ${job.id} falló: ${String(error).slice(0, 120)}`); return deliver(`fail-${job.id}`, "fail", job.id, error); };

  async function waitApproval(id) {
    const t0 = Date.now();
    while (Date.now() - t0 <= approvalTtlMs) {
      const s = await hub.approvalStatus(id);
      if (s.status !== "pendiente") return s.status;
      await sleep(approvalPollMs);
    }
    return "caducada";
  }

  // Eventos hacia el hub. Si el hub contesta { cancelado: true } (el usuario canceló la ronda) se aborta el proceso.
  // Además, mientras el job corre se consulta cada `cancelPollMs`: un motor callado también se entera.
  function eventSender(job, controller) {
    const queue = []; let timer = null;
    const post = (ev) => hub.proEvents(job.id, ev).then((r) => { if (r?.cancelado) controller.abort(); }).catch(() => {});
    const send = () => { timer = null; const ev = queue.splice(0); if (ev.length) post(ev); };
    const poll = cancelPollMs > 0 ? setInterval(() => { if (!controller.signal.aborted) post([]); }, cancelPollMs) : null;
    poll?.unref?.();
    return { push: (ev) => { queue.push(...ev); timer ||= setTimeout(send, 800); }, flush: () => { if (timer) { clearTimeout(timer); send(); } }, stop: () => { if (poll) clearInterval(poll); if (timer) { clearTimeout(timer); timer = null; } } };
  }

  // Claude: con aprobaciones (igual que el worker clásico). Devuelve { ok, text, usage, commands, error }.
  async function withClaude(job, ev, signal) {
    const b = bin(claude, resolveClaude);
    if (!b) return { error: "claude_no_instalado" };
    const timeoutMs = (job.timeout_s || 1800) * 1000;
    let stdin = Buffer.from(job.prompt, "utf8"), resume = null, approved = [], last = null; const total = { tokens_in: 0, tokens_out: 0 }; const commands = [];
    // Modelo de reserva (planear/verificar): si el principal está saturado, sin cuota o la cuenta no lo tiene, se usa el
    // de reserva UNA vez y se devuelve `fallback` + `modelo_real`; el servidor lo avisa en el hilo (nunca en silencio).
    const reservas = Array.isArray(job.fallback_models) ? job.fallback_models.filter((m) => m && m !== job.model) : [];
    let modelo = job.model, fallback = null;
    for (let ronda = 0; ronda <= MAX_RONDAS; ronda++) {
      last = await runClaude({
        ...b, args: buildProArgs({ role: job.role, model: modelo, repo: job.repo, approved, resume, fallbackModel: !fallback && reservas[0] ? reservas[0] : null }), stdin, cwd: job.repo, timeoutMs, signal,
        onEvents: (e) => { for (const x of e) if (x.kind === "herramienta" && /^Bash: /.test(x.text)) commands.push(x.text.slice(6)); ev.push(e); },
      });
      total.tokens_in += last.usage.tokens_in; total.tokens_out += last.usage.tokens_out;
      if (last.aborted === "cancelado") return { cancelado: true };
      if (last.aborted === "tiempo") return { error: "timeout" };
      if (last.isError && !fallback && reservas.length && ["sin_cuota", "saturado", "modelo_no_disponible"].includes(last.errorKind)) {
        fallback = { de: modelo, a: reservas[0], motivo: last.errorKind };
        log(`Claude ${modelo}: ${last.errorKind}; sigo con ${reservas[0]} (se avisará en el hilo)`);
        modelo = reservas[0]; resume = null; stdin = Buffer.from(job.prompt, "utf8"); ronda = -1; // desde cero con el modelo de reserva
        continue;
      }
      if (last.isError || !last.denials.length || job.role !== "programar" || ronda === MAX_RONDAS) break;
      const dec = [];
      for (const d of last.denials) {
        const c = classifyDenial(d);
        const a = (await hub.proApproval(job.id, c)).approval;
        onStatus({ waiting: c.summary });
        dec.push({ d, c, estado: await waitApproval(a.id) });
      }
      onStatus({ waiting: null });
      const ok = dec.filter((x) => x.estado === "aprobada");
      if (!ok.length) return { error: `aprobacion_${dec[0].estado}`, text: last.result, usage: total };
      approved = [...approved, ...ok.map((x) => allowRule(x.d))];
      commands.push(...ok.map((x) => x.c.detail).filter(Boolean));
      resume = last.sessionId; if (!resume) break;
      stdin = Buffer.from(`El señor aprobó: ${ok.map((x) => x.c.summary + " — " + x.c.detail).join("; ")}. Continúa.`, "utf8");
    }
    if (last.isError || last.exitCode) {
      const detalle = (last.result || last.stderr || "").replace(/\s+/g, " ").slice(0, 250);
      const kind = last.errorKind || classifyClaudeError(detalle);
      return { error: kind ? `${kind}: ${detalle || kind}`.slice(0, 300) : `claude_error: ${detalle || "sin detalle (código " + last.exitCode + ")"}`, usage: total };
    }
    const reales = last.models?.length ? last.models : [last.model || modelo].filter(Boolean);
    return { text: last.result, usage: total, commands, modelo_real: reales.join(","), ...(fallback || reales.some((m) => m !== job.model) ? { fallback: fallback || { de: job.model, a: reales.join(","), motivo: "reserva automática de Claude" } } : {}) };
  }

  // Gemini: programar baja de modelo SOLO ante 503; cuota (429) falla con sin_cuota sin bajar.
  async function withGemini(job, ev, signal) {
    const b = bin(agy);
    if (!geminiActivo()) return { error: "gemini_apagado" };
    if (!snap.isInsideAllowed(job.repo, geminiFolders())) return { error: "repo_fuera_de_carpetas_gemini" };
    if (!b) return { error: "gemini_no_instalado" };
    await ensureGeminiIgnore(job.repo);
    let lastErr = "gemini_error";
    const p = prepareAgyPrompt(job.prompt, job); // prompt largo -> archivo temporal (carpeta única fuera del repo)
    const dirs = [...geminiFolders(), ...(p.dir ? [p.dir] : [])]; // agy solo puede leer ese archivo temporal además de carpetas_gemini
    try {
    for (const model of modelChain(job.role, job.model, Array.isArray(job.fallback_models) ? job.fallback_models : null)) {
      const r = await runAgy({ ...b, args: buildAgyArgs({ prompt: p.text, model, role: job.role, mode: job.mode }), allowedDirs: dirs, policy: policyFor({ role: job.role, mode: job.mode }), cwd: job.repo, timeoutMs: (job.timeout_s || 1800) * 1000, onEvents: ev.push, signal });
      if (r.aborted === "cancelado") return { cancelado: true };
      if (r.aborted === "tiempo") return { error: "timeout" };
      if (r.blocked) return { error: `comando_bloqueado: ${r.blocked.kind}: ${r.blocked.detail}`.slice(0, 400), usage: r.usage };
      if (!r.isError) return { text: r.text, usage: r.usage, commands: r.commands, model };
      if (r.errorKind === "sin_cuota") return { error: "sin_cuota", usage: r.usage };
      if (r.errorKind === "503") { lastErr = "gemini_503"; log(`Gemini ${model}: 503${job.role === "programar" ? ", pruebo el siguiente modelo" : ""}`); continue; } // el for solo sigue si hay más en la cadena (programar)
      return { error: `gemini_error: ${(r.stderr || r.text).slice(0, 300)}`, usage: r.usage };
    }
    return { error: lastErr };
    } finally { p.cleanup(); }
  }

  // Rol "commit" (docs/PRO.md "Ampliaciones P2"): el prompt es el mensaje; commit local, nunca push.
  async function processCommit(job) {
    const repo = job.repo;
    if (!repo || !snap.isInsideAllowed(repo, allowedFolders()) || !existsSync(repo) || !(await snap.isGitRepo(repo))) return fail(job, "repo_invalido");
    try {
      // Con lista de archivos de la ronda solo se commitea eso (y se rechaza si se mezclaría con cambios ajenos).
      const solo = Array.isArray(job.commit_paths);
      const c = solo ? await snap.commitPaths(repo, job.prompt, job.commit_paths, { expectedTree: job.expected_tree || null, baseTree: job.base_tree || null }) : await snap.commitAll(repo, job.prompt);
      await deliver(`report-${job.id}`, "report", job.id, {
        informe: { dijo_hizo: [c.vacio ? "Nada que commitear" : `Commit local ${c.commit.slice(0, 8)}`], archivos_tocados: c.archivos || [], comandos: solo ? ["git add -A -- <archivos de la ronda>", "git commit -- <archivos de la ronda>"] : ["git add -A", "git commit"], resultado: "ok" },
        tree_before: null, tree_after: null, diff: "", usage: { tokens_in: 0, tokens_out: 0 },
      });
    } catch (e) {
      if (e.code === "cambios_ajenos") return fail(job, `cambios_ajenos: ${e.message}`.slice(0, 300));
      return fail(job, `commit_fallido: ${String(e.stderr || e.message).slice(0, 250)}`);
    }
  }

  async function processJob(job) {
    if (job.role === "commit") return processCommit(job);
    // "consultar" (Claude/Gemini se pasan opiniones) corre SIEMPRE como verificar en solo lectura, diga lo que diga el prompt.
    const consulta = job.role === "consultar";
    if (consulta) job = { ...job, role: "verificar", mode: "solo_lectura" };
    const roles = ["planear", "programar", "verificar"];
    if (!roles.includes(job.role) || !["claude", "gemini"].includes(job.engine)) return fail(job, "job_invalido");
    const repo = job.repo;
    if (!repo || !snap.isInsideAllowed(repo, allowedFolders())) return fail(job, "repo_invalido");
    if (!existsSync(repo) || !(await snap.isGitRepo(repo))) return fail(job, "repo_invalido");
    if (job.engine === "gemini" && isProhibited(normalizeModel(job.model || ""))) return fail(job, "modelo_prohibido");

    const controller = new AbortController();
    const ev = eventSender(job, controller);
    const edita = job.role === "programar" && job.mode === "editar";
    let treeA = null;
    try {
      if (job.engine === "gemini") await ensureGeminiIgnore(repo); // antes del snapshot, así no cuenta como cambio
      if (edita) treeA = await snap.snapshot(repo);
      const r = job.engine === "claude" ? await withClaude(job, ev, controller.signal) : await withGemini(job, ev, controller.signal);
      ev.flush(); ev.stop();
      if (r.cancelado) { log(`Job ${job.id} cancelado por el usuario: proceso detenido`); return; } // el servidor ya lo dio por cancelado
      if (r.error) return fail(job, r.error);
      if (job.role !== "programar" && !String(r.text || "").trim()) return fail(job, "respuesta_vacia");
      let treeB = treeA, diff = { files: [], text: "" };
      if (edita) { treeB = await snap.snapshot(repo); diff = await snap.diffBetween(repo, treeA, treeB, diffMax); }
      const claim = parseInforme(r.text);
      // planear: el servidor espera el plan como texto (string), no un objeto de informe.
      const informe = job.role === "planear" || consulta ? String(r.text || "") : claim
        ? { dijo_hizo: claim.dijo_hizo || [], archivos_tocados: claim.archivos_tocados || [], comandos: claim.comandos || r.commands || [], resultado: claim.resultado || "ok", ...(job.role !== "programar" ? claim : {}) }
        : { dijo_hizo: String(r.text || "").split(/\r?\n/).filter((l) => l.trim()).slice(0, 30), archivos_tocados: diff.files.map((f) => f.path), comandos: r.commands || [], resultado: "ok" };
      await deliver(`report-${job.id}`, "report", job.id, {
        informe, tree_before: treeA, tree_after: treeB, diff: diff.text,
        usage: r.usage || { tokens_in: 0, tokens_out: 0 },
        ...(r.modelo_real ? { modelo_real: r.modelo_real } : {}), ...(r.fallback ? { fallback: r.fallback } : {}),
      });
    } catch (e) {
      ev.flush(); ev.stop();
      return fail(job, `error_runner: ${e.message}`.slice(0, 300));
    }
  }

  // Un ciclo: reenvía el buzón, reclama un job y lo procesa. Devuelve "job" | "vacio".
  async function tick() {
    if (outbox) await outbox.flush((e) => (e.kind === "report" ? hub.proReport(e.jobId, e.body) : hub.proFail(e.jobId, e.body))).catch(() => {});
    const r = await hub.proClaim();
    if (!r?.job) return "vacio";
    onStatus({ pro_job: r.job.id });
    log(`Job Pro #${r.job.id} (${r.job.role}/${r.job.engine})`);
    try { await processJob(r.job); } finally { onStatus({ pro_job: null }); }
    return "job";
  }

  return { tick, processJob };
}
