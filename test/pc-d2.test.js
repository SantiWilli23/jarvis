// Ola D2: tope diario de capturas en el servidor, registro de uso sin contenido y capabilities.pc_acciones.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../server/db/client.js";
import { buildContext, loadJson } from "../server/context.js";
import { createApp } from "../server/app.js";
import { createPcQueue, ACCIONES_ANTIGUAS } from "../server/pc/queue.js";
import { PC_ACTIONS } from "../desktop/runner/pc-spec.js";
import { createPcCapture } from "../desktop/runner/pc-capture.js";

let ctx, server, base, web, pcTk;
let now = Date.UTC(2026, 10, 20, 12);
const call = (path, { method = "GET", body, tk = web } = {}) =>
  fetch(base + path, { method, headers: { "content-type": "application/json", authorization: `Bearer ${tk}` }, body: body ? JSON.stringify(body) : undefined });
const json = async (...a) => (await call(...a)).json();
const hello = (pc_acciones) => call("/api/agent/hello", { method: "POST", tk: pcTk, body: { host: "pc", capabilities: pc_acciones ? { pc_acciones } : undefined } });
const pedir = (accion = "captura", params = {}) => call("/api/pc/actions", { method: "POST", body: { accion, params } });
const siguiente = async () => (await json("/api/agent/pc/next", { method: "POST", tk: pcTk })).accion;
const usos = async () => (await ctx.db.execute("SELECT * FROM claude_usage ORDER BY id")).rows.map((r) => ({ ...r }));
const limpiar = async () => { await ctx.db.execute("DELETE FROM pc_actions"); await ctx.db.execute("DELETE FROM claude_usage"); };
const TODAS = Object.keys(PC_ACTIONS);

before(async () => {
  ctx = await buildContext({ db: createDb({ url: ":memory:" }), env: { OWNER_PASSWORD: "prueba-123" }, now: () => now });
  server = createApp(ctx).listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
  web = (await ctx.sessions.create(ctx.ownerId, { name: "web", kind: "web" })).token;
  pcTk = (await json("/api/devices", { method: "POST", body: { name: "PC", kind: "pc" } })).token;
});
after(() => server.close());

test("tope: se aplica también en paralelo, deja registro sin contenido y vuelve al día siguiente (UTC)", async () => {
  const agente = { view: () => ({ online: true }), accionesPc: () => TODAS };
  const cola = (max) => createPcQueue({ db: ctx.db, agent: agente, config: { ...ctx.pc.config, capturas_por_dia: max }, now: () => now });
  const q = cola(3);
  await limpiar();
  const pedidos = await Promise.all(Array.from({ length: 6 }, () => q.create({ userId: ctx.ownerId, action: "captura" })));
  assert.equal(pedidos.filter((p) => p.ok).length, 3);
  const no = pedidos.find((p) => !p.ok);
  assert.equal(no.error, "tope_capturas");
  assert.match(no.mensaje, /tope diario de capturas \(3\)/);
  assert.equal((await q.create({ userId: ctx.ownerId, action: "bloquear" })).ok, true); // lo demás sigue
  let hechas = 0, a;
  while ((a = await q.next(ctx.ownerId, { deviceId: 7 }))) {
    if (a.accion === "captura") await q.result(ctx.ownerId, a.id, { ok: hechas++ !== 0, texto: "SECRETO en pantalla" });
  }
  assert.equal((await q.create({ userId: ctx.ownerId, action: "captura" })).error, "tope_capturas");
  const u = await usos();
  assert.deepEqual(u.map((x) => [x.tipo, x.day, Number(x.device_id), Number(x.ok)]), [["captura", "2026-11-20", 7, 0], ["captura", "2026-11-20", 7, 1], ["captura", "2026-11-20", 7, 1]]);
  assert.doesNotMatch(JSON.stringify(u), /SECRETO/);
  assert.equal((await ctx.agent.usageToday(ctx.ownerId)).tareas, 0); // no cuentan como tareas de Claude
  now += 24 * 3600_000;
  assert.equal((await q.create({ userId: ctx.ownerId, action: "captura" })).ok, true);
  // Si el tope baja con algo ya en cola, tampoco se entrega.
  assert.equal(await cola(0).next(ctx.ownerId), null);
});

test("por HTTP con el tope de la config (20): 429 con mensaje; sin respuesta del PC queda como error", async () => {
  assert.equal(loadJson("pc-actions.json").capturas_por_dia, 20);
  await limpiar();
  await hello(TODAS);
  for (let i = 0; i < 20; i++) { assert.equal((await pedir()).status, 201); await siguiente(); }
  const r = await pedir();
  assert.equal(r.status, 429);
  assert.match((await r.json()).mensaje, /tope diario/);
  now += 3 * 60_000;
  await hello(TODAS);
  await json("/api/pc/actions"); // barrido
  const u = await usos();
  assert.equal(u.length, 20);
  assert.ok(u.every((x) => x.ok !== null && Number(x.ok) === 0 && x.device_id !== null));
});

test("PC antiguo (sin pc_acciones): solo las acciones antiguas", async () => {
  await limpiar();
  await hello();
  for (const [a, p] of [["captura", {}], ["archivos_listar", { raiz: "documentos" }], ["cancelar_apagado", {}]]) {
    const r = await pedir(a, p);
    assert.equal(r.status, 409, a);
    const j = await r.json();
    assert.equal(j.error, "accion_no_soportada");
    assert.match(j.mensaje, /Actualice la app del PC/);
  }
  assert.equal((await pedir("bloquear")).status, 201);
  const cat = (await json("/api/pc/actions")).catalogo;
  assert.deepEqual(cat.filter((a) => a.soportada).map((a) => a.id).sort(), [...ACCIONES_ANTIGUAS].sort());
});

test("PC que informa pc_acciones: manda su lista, sin pisar capacidades; el heartbeat la conserva", async () => {
  await limpiar();
  await call("/api/agent/hello", { method: "POST", tk: pcTk, body: { capabilities: { claude: { ok: true } } } });
  await hello(["captura"]);
  assert.equal(ctx.agent.capabilities().claude.ok, true);
  await call("/api/agent/heartbeat", { method: "POST", tk: pcTk, body: {} });
  assert.deepEqual(ctx.agent.accionesPc(), ["captura"]);
  assert.equal((await pedir("captura")).status, 201);
  assert.equal((await pedir("bloquear")).status, 409);
  // Cambia a una app que ya no admite captura: lo encolado no se entrega ni cuenta.
  await hello(["bloquear"]);
  assert.equal(await siguiente(), null);
  assert.equal((await usos()).length, 0);
});

test("PC: la segunda barrera usa el contador guardado y el día UTC", async () => {
  const cap = createPcCapture({ maxPorDia: 2, usoInicial: { fecha: "2026-11-20", n: 2 }, now: () => new Date(Date.UTC(2026, 10, 20, 23, 30)), dir: "x", describir: async () => "" });
  await assert.rejects(cap.capturar(), /Tope diario/);
});
