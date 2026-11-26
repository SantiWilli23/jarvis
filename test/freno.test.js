// Freno de emergencia (docs/CONTROL.md). Sin Claude real: fake-claude colgado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildContext } from "../server/context.js";
import { createApp } from "../server/app.js";
import { all } from "../server/db/client.js";
import { createHubClient } from "../desktop/runner/hub-client.js";
import { createWorker } from "../desktop/runner/worker.js";
import { createPcWorker } from "../desktop/runner/pc-worker.js";
import { createControlState } from "../desktop/runner/control-state.js";
import { memDb, clock } from "./helpers.js";

const FAKE = fileURLToPath(new URL("./fixtures/fake-claude.mjs", import.meta.url));
const espera = async (fn, ms = 5000) => { const t0 = Date.now(); while (!(await fn())) { if (Date.now() - t0 > ms) throw new Error("no llegó a tiempo"); await new Promise((r) => setTimeout(r, 25)); } };

async function levantar(t) {
  const { db } = await memDb();
  const ctx = await buildContext({ db, env: { OWNER_PASSWORD: "prueba-123" } });
  const server = createServer(createApp(ctx));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => { server.closeAllConnections?.(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const pedir = async (path, { token, method = "GET", body } = {}) => {
    const res = await fetch(`${base}/api${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  const web = (await pedir("/auth/login", { method: "POST", body: { password: "prueba-123" } })).data.token;
  const pcToken = (await pedir("/devices", { token: web, method: "POST", body: { name: "pc", kind: "pc" } })).data.token;
  return { ctx, db, base, pedir, web, pcToken, uid: ctx.ownerId };
}

test("el freno mata una tarea en curso en menos de 5 s; reanudar solo con sesión web", async (t) => {
  const { ctx, base, pedir, web, pcToken, uid } = await levantar(t);
  const tmp = mkdtempSync(join(tmpdir(), "freno-"));
  const salida = join(tmp, "out.json");
  process.env.FAKE_OUT = salida; process.env.FAKE_SLEEP_MS = "60000";
  t.after(() => { delete process.env.FAKE_OUT; delete process.env.FAKE_SLEEP_MS; });

  const hub = createHubClient({ baseUrl: base, token: pcToken });
  const control = createControlState();
  const worker = createWorker({ hub, control, claude: { command: process.execPath, prefix: [FAKE] }, fallbackCwd: tmp, folders: [tmp] });
  const pcWorker = createPcWorker({ hub, control, executor: { execute: async () => ({ ok: true }), stop() {} }, pollMs: 100 });
  await worker.sync();
  const tarea = (await pedir("/tasks", { token: web, method: "POST", body: { text: "espera" } })).data.task;
  let fin = false;
  const corre = worker.tick().then(() => { fin = true; });
  await espera(async () => (await ctx.tasks.get(uid, tarea.id)).status === "reclamada");
  await new Promise((r) => setTimeout(r, 500));
  pcWorker.start(); t.after(() => pcWorker.stop());

  const t0 = Date.now();
  const f = await pedir("/control/freno", { token: web, method: "POST", body: {} });
  assert.equal(f.status, 200); assert.equal(f.data.frenado, true);
  await corre;
  assert.ok(fin && Date.now() - t0 < 5000, `tardó ${Date.now() - t0} ms`);
  assert.equal((await ctx.tasks.get(uid, tarea.id)).status, "cancelada");
  assert.equal(control.frenado(), true);
  assert.equal(await worker.tick(), "frenada");

  // Con freno no entra ni sale nada.
  assert.equal((await pedir("/tasks", { token: web, method: "POST", body: { text: "otra" } })).status, 409);
  assert.equal((await ctx.pc.create({ userId: uid, action: "volumen", params: {} })).error, "frenado");
  await assert.rejects(ctx.nav.enqueue({ userId: uid, tipo: "buscar", sitio: "google", consulta: "x" }), (e) => e.error === "frenado");
  assert.deepEqual((await hub.claim()).task, null);
  assert.deepEqual((await hub.pcNext()).control, { freno: true, amplio: false, raton: false });
  assert.equal((await hub.heartbeat({})).control.freno, true);
  assert.equal((await pedir("/control/activar", { token: web, method: "PUT", body: { amplio: true } })).status, 409);

  // Reanudar: ni sin sesión ni con el token del PC.
  assert.equal((await pedir("/control/reanudar", { method: "POST" })).status, 401);
  assert.equal((await pedir("/control/reanudar", { token: pcToken, method: "POST" })).status, 403);
  assert.ok((await pedir("/agent/control/reanudar", { token: pcToken, method: "POST" })).status >= 400);
  assert.equal((await ctx.control.estado(uid)).frenado, true);
  assert.equal((await pedir("/control/reanudar", { token: web, method: "POST", body: {} })).data.frenado, false);
  await espera(() => !control.frenado());
  assert.ok((await ctx.audit.list(uid)).some((e) => e.action === "control.freno"));
});

test("freno cancela pc_actions, textos y repartos pendientes; el registro del PC no guarda lo tecleado", async (t) => {
  const { ctx, db, pedir, web, pcToken, uid } = await levantar(t);
  await ctx.agent.hello(uid, { version: "1", host: "x" });
  await ctx.control.activar(uid, { amplio: true, raton: true, minutos: 5 });
  const { run } = await import("../server/db/client.js");
  await run(db, "INSERT INTO pc_actions (user_id, action, params, status, expires_at, created_at) VALUES (?,'volumen','{}','lista',?,?)", [uid, Date.now() + 60000, Date.now()]);
  await run(db, "INSERT INTO memoria_repartos (user_id, tipo, destino, creado) VALUES (?,'reparto','x',?)", [uid, Date.now()]);
  const r = await ctx.control.freno(uid);
  assert.deepEqual(r.fallos, []);
  assert.equal(r.amplio, false); assert.equal(r.raton, false);
  assert.equal((await all(db, "SELECT status FROM pc_actions"))[0].status, "rechazada");
  assert.equal((await all(db, "SELECT estado FROM memoria_repartos"))[0].estado, "cancelado");

  const log = await pedir("/agent/control/log", { token: pcToken, method: "POST", body: { accion: "clic", detalle: "botón Aceptar", texto: "secreto-tecleado" } });
  assert.deepEqual(log.data, { ok: true, frenado: true });
  assert.equal((await pedir("/agent/control/log", { token: web, method: "POST", body: { accion: "x" } })).status, 403);
  assert.ok(!JSON.stringify(await ctx.audit.list(uid)).includes("secreto-tecleado"));
});

test("PC: freno sin red se mantiene hasta que el servidor lo confirma; sin servidor se apagan los permisos", () => {
  const reloj = clock();
  const c = createControlState({ now: reloj, sinServidorMs: 1000 });
  let avisos = 0; c.onFreno(() => avisos++);
  c.frenar({ local: true });
  c.servidor({ freno: false, amplio: true, raton: true });
  assert.equal(c.frenado(), true); assert.equal(c.amplio(), false); assert.equal(avisos, 1);
  c.servidor({ freno: true }); c.servidor({ freno: false });
  assert.equal(c.frenado(), false);

  let t = 0;
  const d = createControlState({ now: () => t, sinServidorMs: 1000 });
  d.servidor({ freno: false, amplio: true, raton: false });
  t = 900; assert.equal(d.amplio(), true);
  t = 1100; assert.equal(d.amplio(), false); assert.equal(d.porApagar(), true);
  d.servidor({ freno: false, amplio: true, raton: false });
  assert.equal(d.amplio(), false, "no se vuelve a encender solo");
  d.servidor({ freno: false, amplio: false, raton: false });
  assert.equal(d.porApagar(), false);
});

test("web: freno y registro sin innerHTML y en sus huecos", async () => {
  const { readFileSync } = await import("node:fs");
  const web = (f) => readFileSync(new URL(`../web/${f}`, import.meta.url), "utf8");
  for (const f of ["js/freno.js", "js/registro.js"]) assert.ok(!/innerHTML|insertAdjacentHTML/.test(web(f)), f);
  assert.match(web("js/freno.js"), /\/control\/reanudar/);
  assert.match(web("js/registro.js"), /jarvis:mas/);
  const { describir } = await import("../web/js/registro.js");
  assert.equal(describir({ action: "control.freno" }), "Freno puesto");
  assert.equal(describir({ action: "pc.control.clic" }), "En su PC: clic");
});
