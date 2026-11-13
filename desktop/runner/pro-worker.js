// Worker del Modo Pro: reclama jobs de /api/agent/pro, los ejecuta con Claude Code o Gemini CLI dentro de un
// repo permitido, calcula el diff real (git-snapshot) y manda informe + diff. Contrato: docs/PRO.md §5-§7.
import { appendFileSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { buildProArgs } from "./claude-args.js";
import { buildAgyArgs, buildAgyPrompt, MAX_PEDIDO, modelChain, isProhibited, normalizeModel, IGNORE_PRIVADOS } from "./agy-args.js";
import { classifyDenial, allowRule } from "./danger.js";
import { runClaude as realRunClaude, resolveClaude as realResolveClaude } from "./claude-runner.js";
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
  snap = gitSnap, diffMax = 200000, approvalPollMs = 3000, approvalTtlMs = 30 * 60_000, onStatus = () => {},
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

  function eventSender(job) {
    const queue = []; let timer = null;
    const send = () => { timer = null; const ev = queue.splice(0); if (ev.length) hub.proEvents(job.id, ev).catch(() => {}); };
    return { push: (ev) => { queue.push(...ev); timer ||= setTimeout(send, 800); }, flush: () => { if (timer) { clearTimeout(timer); send(); } } };
  }

  // Claude: con aprobaciones (igual que el worker clásico). Devuelve { ok, text, usage, commands, error }.
  async function withClaude(job, ev) {
    const b = bin(claude, resolveClaude);
    if (!b) return { error: "claude_no_instalado" };
    const timeoutMs = (job.timeout_s || 1800) * 1000;
    let stdin = Buffer.from(job.prompt, "utf8"), resume = null, approved = [], last = null; const total = { tokens_in: 0, tokens_out: 0 }; const commands = [];
    for (let ronda = 0; ronda <= MAX_RONDAS; ronda++) {
      last = await runClaude({
        ...b, args: buildProArgs({ role: job.role, model: job.model, repo: job.repo, approved, resume }), stdin, cwd: job.repo, timeoutMs,
        onEvents: (e) => { for (const x of e) if (x.kind === "herramienta" && /^Bash: /.test(x.text)) commands.push(x.text.slice(6)); ev.push(e); },
      });
      total.tokens_in += last.usage.tokens_in; total.tokens_out += last.usage.tokens_out;
      if (last.aborted === "tiempo") return { error: "timeout" };
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
    if (last.isError || last.exitCode) return { error: `claude_error: ${(last.result || last.stderr || "").slice(0, 300)}`, usage: total };
    return { text: last.result, usage: total, commands };
  }

  // Gemini: programar baja de modelo SOLO ante 503; cuota (429) falla con sin_cuota sin bajar.
  async function withGemini(job, ev) {
    const b = bin(agy);
    if (!b) return { error: "gemini_no_instalado" };
    await ensureGeminiIgnore(job.repo);
    let lastErr = "gemini_error";
    const prompt = buildAgyPrompt(job.prompt, job.mode);
    if (prompt.length > MAX_PEDIDO) return { error: "pedido_largo_para_agy" }; // agy recibe el pedido en la línea de comandos
    for (const model of modelChain(job.role, job.model)) {
      const r = await runAgy({ ...b, args: buildAgyArgs({ prompt, model }), allowedDirs: [job.repo], cwd: job.repo, timeoutMs: (job.timeout_s || 1800) * 1000, onEvents: ev.push });
      if (r.aborted === "tiempo") return { error: "timeout" };
      if (r.blocked) return { error: `comando_bloqueado: ${r.blocked.kind}: ${r.blocked.detail}`.slice(0, 400), usage: r.usage };
      if (!r.isError) return { text: r.text, usage: r.usage, commands: r.commands, model };
      if (r.errorKind === "sin_cuota") return { error: "sin_cuota", usage: r.usage };
      if (r.errorKind === "503") { lastErr = "gemini_503"; log(`Gemini ${model}: 503${job.role === "programar" ? ", pruebo el siguiente modelo" : ""}`); continue; } // el for solo sigue si hay más en la cadena (programar)
      return { error: `gemini_error: ${(r.stderr || r.text).slice(0, 300)}`, usage: r.usage };
    }
    return { error: lastErr };
  }

  // Rol "commit" (docs/PRO.md "Ampliaciones P2"): el prompt es el mensaje; commit local, nunca push.
  async function processCommit(job) {
    const repo = job.repo;
    if (!repo || !snap.isInsideAllowed(repo, allowedFolders()) || !existsSync(repo) || !(await snap.isGitRepo(repo))) return fail(job, "repo_invalido");
    try {
      const c = await snap.commitAll(repo, job.prompt);
      await deliver(`report-${job.id}`, "report", job.id, {
        informe: { dijo_hizo: [c.vacio ? "Nada que commitear" : `Commit local ${c.commit.slice(0, 8)}`], archivos_tocados: [], comandos: ["git add -A", "git commit"], resultado: "ok" },
        tree_before: null, tree_after: null, diff: "", usage: { tokens_in: 0, tokens_out: 0 },
      });
    } catch (e) { return fail(job, `commit_fallido: ${String(e.stderr || e.message).slice(0, 250)}`); }
  }

  async function processJob(job) {
    if (job.role === "commit") return processCommit(job);
    const roles = ["planear", "programar", "verificar"];
    if (!roles.includes(job.role) || !["claude", "gemini"].includes(job.engine)) return fail(job, "job_invalido");
    const repo = job.repo;
    if (!repo || !snap.isInsideAllowed(repo, allowedFolders())) return fail(job, "repo_invalido");
    if (!existsSync(repo) || !(await snap.isGitRepo(repo))) return fail(job, "repo_invalido");
    if (job.engine === "gemini" && isProhibited(normalizeModel(job.model || ""))) return fail(job, "modelo_prohibido");

    const ev = eventSender(job);
    const edita = job.role === "programar" && job.mode === "editar";
    let treeA = null;
    try {
      if (job.engine === "gemini") await ensureGeminiIgnore(repo); // antes del snapshot, así no cuenta como cambio
      if (edita) treeA = await snap.snapshot(repo);
      const r = job.engine === "claude" ? await withClaude(job, ev) : await withGemini(job, ev);
      ev.flush();
      if (r.error) return fail(job, r.error);
      let treeB = treeA, diff = { files: [], text: "" };
      if (edita) { treeB = await snap.snapshot(repo); diff = await snap.diffBetween(repo, treeA, treeB, diffMax); }
      const claim = parseInforme(r.text);
      // planear: el servidor espera el plan como texto (string), no un objeto de informe.
      const informe = job.role === "planear" ? String(r.text || "") : claim
        ? { dijo_hizo: claim.dijo_hizo || [], archivos_tocados: claim.archivos_tocados || [], comandos: claim.comandos || r.commands || [], resultado: claim.resultado || "ok", ...(job.role !== "programar" ? claim : {}) }
        : { dijo_hizo: String(r.text || "").split(/\r?\n/).filter((l) => l.trim()).slice(0, 30), archivos_tocados: diff.files.map((f) => f.path), comandos: r.commands || [], resultado: "ok" };
      await deliver(`report-${job.id}`, "report", job.id, {
        informe, tree_before: treeA, tree_after: treeB, diff: diff.text,
        usage: r.usage || { tokens_in: 0, tokens_out: 0 },
      });
    } catch (e) {
      ev.flush();
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
