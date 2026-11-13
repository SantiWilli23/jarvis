import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { snapshot, diffBetween, isGitRepo, isInsideAllowed } from "../desktop/runner/git-snapshot.js";
import { blockedForGemini } from "../desktop/runner/danger.js";

const g = (cwd, ...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd, encoding: "utf8" });
const mk = (commit = true) => {
  const d = mkdtempSync(join(tmpdir(), "pro-snap-")); g(d, "init", "-q");
  writeFileSync(join(d, "a.txt"), "uno\n"); writeFileSync(join(d, "b.txt"), "dos\n");
  if (commit) { g(d, "add", "-A"); g(d, "commit", "-qm", "base"); }
  return d;
};

test("snapshot detecta cambios, nuevos y borrados sin tocar el índice", async () => {
  const d = mk();
  try {
    const a = await snapshot(d);
    writeFileSync(join(d, "a.txt"), "uno cambiado\n"); writeFileSync(join(d, "nuevo.js"), "x\n"); rmSync(join(d, "b.txt"));
    const b = await snapshot(d);
    const df = await diffBetween(d, a, b);
    const by = Object.fromEntries(df.files.map((f) => [f.path, f.status]));
    assert.deepEqual(by, { "a.txt": "M", "nuevo.js": "A", "b.txt": "D" });
    assert.match(df.text, /a\.txt/);
    assert.equal(g(d, "diff", "--cached", "--name-only").trim(), ""); // índice real intacto
    assert.ok(g(d, "status", "--porcelain").includes("?? nuevo.js"));
    assert.equal((await diffBetween(d, b, b)).files.length, 0);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("snapshot en un repo sin commits", async () => {
  const d = mk(false);
  try {
    const a = await snapshot(d); writeFileSync(join(d, "c.txt"), "3\n");
    const df = await diffBetween(d, a, await snapshot(d));
    assert.deepEqual(df.files.map((f) => f.path), ["c.txt"]);
    assert.ok(await isGitRepo(d));
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("carpetas permitidas y bloqueo de comandos para agy", () => {
  const d = mkdtempSync(join(tmpdir(), "pro-allow-"));
  assert.ok(isInsideAllowed(join(d, "x"), [d])); assert.ok(!isInsideAllowed(tmpdir(), [d]));
  assert.equal(blockedForGemini("git push origin main").kind, "git_push");
  assert.equal(blockedForGemini("npm test").kind, "terminal_libre");
  assert.equal(blockedForGemini("rm -rf x").kind, "borrar");
  assert.equal(blockedForGemini("ls"), null);
  rmSync(d, { recursive: true, force: true });
});
