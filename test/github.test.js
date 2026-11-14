import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createDb } from "../server/db/client.js";
import { buildContext } from "../server/context.js";
import { createApp } from "../server/app.js";
import { createGitHub } from "../server/connectors/github.js";

const T1 = "github_pat_AAAAAAAAAAAAAAAAAAAAAA_1111111111111111111111111111";
const T2 = "github_pat_BBBBBBBBBBBBBBBBBBBBBB_2222222222222222222222222222";
const CLASICO = "ghp_" + "c".repeat(36);

const jres = (body, status = 200, headers = {}) => ({ ok: status < 400, status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, json: async () => body });
const repo = (full, priv = false) => ({ full_name: full, private: priv, default_branch: "main", pushed_at: "2026-01-01T00:00:00Z" });

function mock() {
  const calls = [];
  const f = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    const auth = opts.headers?.authorization || "";
    const u = new URL(url);
    const quien = auth.includes(T1) ? "uno" : "dos";
    if (u.pathname === "/user") return jres({ login: quien });
    if (u.pathname === "/user/repos") {
      if (quien === "uno") {
        const p = Number(u.searchParams.get("page"));
        if (p <= 3) return jres(Array.from({ length: 100 }, (_, i) => repo(`uno/r${p}-${i}`, i === 0)));
        return jres([repo("uno/nunca")]);
      }
      return jres([repo("org/privado", true)]);
    }
    if (u.pathname === "/repos/org/privado/branches") return jres([{ name: "main", commit: { sha: "abc" }, protected: false }], 200, { etag: '"e1"' });
    if (u.pathname === "/repos/org/privado/compare/main...dev/x") return jres({ status: "ahead", ahead_by: 1, behind_by: 0, total_commits: 1, commits: [{ sha: "a", commit: { message: "hola\nmas", author: { date: "d" } } }], files: [{ filename: "a.js", status: "modified", additions: 1, deletions: 0, patch: "x".repeat(50) }] });
    return jres({}, 404);
  };
  return { f, calls };
}

test("solo GET, el token no sale, varios tokens mapeados, privados, paginación con tope", async () => {
  const { f, calls } = mock();
  const gh = createGitHub({ env: { GITHUB_TOKEN: T1, GITHUB_TOKENS: `${T2}, ${T1}` }, fetch: f });
  assert.equal(gh.enabled, true);
  assert.deepEqual(await gh.cuentas(), ["uno", "dos"]);
  const repos = await gh.repos();
  assert.equal(repos.length, 301); // 3 páginas de 100 (tope) + 1 privado del segundo token
  assert.ok(!repos.some((r) => r.full_name === "uno/nunca"));
  assert.ok(repos.find((r) => r.full_name === "org/privado").private);
  assert.deepEqual(Object.keys(repos[0]).sort(), ["default_branch", "full_name", "private", "pushed_at"]);
  assert.equal(calls.filter((c) => c.url.includes("/user/repos") && c.opts.headers.authorization.includes(T1)).length, 3);
  // el repo del segundo token se pide con el segundo token
  const ramas = await gh.ramas("org/privado");
  assert.equal(ramas[0].name, "main");
  const last = calls.at(-1);
  assert.ok(last.opts.headers.authorization.includes(T2));
  // segunda lectura: manda If-None-Match
  await gh.ramas("org/privado");
  assert.equal(calls.at(-1).opts.headers["if-none-match"], '"e1"');
  const cmp = await gh.compare("org/privado", "main", "dev/x");
  assert.equal(cmp.files[0].patch.length, 50);
  assert.equal(cmp.commits[0].message, "hola");
  assert.ok(calls.every((c) => c.opts.method === "GET"));
  assert.ok(!JSON.stringify([repos, ramas, cmp, await gh.cuentas()]).includes("github_pat_"));
});

test("patches recortados y ETag 304", async () => {
  let n = 0;
  const f = async (url, o) => {
    if (String(url).includes("/user/repos")) return jres([repo("a/b")]);
    n++;
    if (o.headers["if-none-match"]) return jres(null, 304);
    return jres({ status: "ahead", files: [{ filename: "a", patch: "y".repeat(100) }], commits: [] }, 200, { etag: '"z"' });
  };
  const gh = createGitHub({ env: { GITHUB_TOKEN: T1 }, fetch: f, maxPatch: 10 });
  const a = await gh.compare("a/b", "main", "x");
  assert.ok(a.files[0].patch.startsWith("yyyyyyyyyy\n[..."));
  const b = await gh.compare("a/b", "main", "x");
  assert.equal(n, 2);
  assert.equal(b.files[0].patch, a.files[0].patch);
});

test("ghp_ clásico rechazado; sin llaves apagado", async () => {
  const gh = createGitHub({ env: { GITHUB_TOKEN: CLASICO }, fetch: async () => { throw new Error("no debe llamar"); } });
  assert.equal(gh.enabled, false);
  assert.equal(gh.rechazadas[0].motivo, "github_llave_clasica");
  assert.equal(createGitHub({ env: {}, fetch: async () => {} }).enabled, false);
  const mezcla = createGitHub({ env: { GITHUB_TOKEN: CLASICO, GITHUB_TOKENS: T1 }, fetch: mock().f });
  assert.equal(mezcla.enabled, true);
});

test("entradas inválidas rechazadas y errores sin token", async () => {
  const { f, calls } = mock();
  const gh = createGitHub({ env: { GITHUB_TOKEN: T1 }, fetch: f });
  for (const full of ["../x", "a/b/c", "a", "a/..", "-a/b", "a b/c", "a/b?x=1", ""]) await assert.rejects(gh.ramas(full), /entrada_invalida/);
  await assert.rejects(gh.rama("uno/r1-0", "../x"), /entrada_invalida/);
  await assert.rejects(gh.rama("uno/r1-0", "a?b"), /entrada_invalida/);
  await assert.rejects(gh.pr("uno/r1-0", "1;rm"), /entrada_invalida/);
  await assert.rejects(gh.checks("uno/r1-0", "zz"), /entrada_invalida/);
  await assert.rejects(gh.ramas("otro/desconocido"), /repo_desconocido/);
  const mal = createGitHub({ env: { GITHUB_TOKEN: T1 }, fetch: async () => { throw new Error(`fallo con Bearer ${T1}`); } });
  await assert.rejects(mal.cuentas(), (e) => !e.message.includes(T1));
  const m401 = createGitHub({ env: { GITHUB_TOKEN: T1 }, fetch: async () => jres({ message: T1 }, 401) });
  await assert.rejects(m401.cuentas(), (e) => !e.message.includes("github_pat_") && /401/.test(e.message));
  assert.ok(calls.every((c) => c.opts.method === "GET"));
});

test("rutas: exigen sesión, status sin token, ramas validadas", async () => {
  const { f } = mock();
  const db = createDb({ url: ":memory:" });
  const ctx = await buildContext({ db, env: { OWNER_PASSWORD: "prueba-123", GITHUB_TOKEN: T1, GITHUB_TOKENS: T2 }, fetch: f });
  const server = createServer(createApp(ctx));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const p of ["/status", "/repos", "/repos/org/privado/branches"]) assert.equal((await fetch(`${base}/api/github${p}`)).status, 401);
    const tk = (await (await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "prueba-123" }) })).json()).token;
    const h = { authorization: `Bearer ${tk}` };
    const st = await (await fetch(`${base}/api/github/status`, { headers: h })).json();
    assert.deepEqual(st, { ok: true, cuentas: ["uno", "dos"], n_repos: 301 });
    const rp = await (await fetch(`${base}/api/github/repos`, { headers: h })).text();
    assert.ok(!rp.includes("github_pat_") && rp.includes("org/privado"));
    const br = await fetch(`${base}/api/github/repos/org/privado/branches`, { headers: h });
    assert.equal(br.status, 200);
    assert.deepEqual((await br.json()).branches, [{ name: "main", sha: "abc", protected: false }]);
    assert.equal((await fetch(`${base}/api/github/repos/org/pri%20vado/branches`, { headers: h })).status, 400);
    assert.equal((await fetch(`${base}/api/github/repos/-x/y/branches`, { headers: h })).status, 400);
    assert.equal((await fetch(`${base}/api/github/repos/otro/nada/branches`, { headers: h })).status, 404);
    const gs = await (await fetch(`${base}/api/status`, { headers: h })).text();
    assert.ok(!gs.includes("github_pat_"));
    assert.ok(JSON.parse(gs).connections.find((c) => c.id === "github").ok);
  } finally { server.close(); }
});
