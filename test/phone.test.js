import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createDb } from "../server/db/client.js";
import { buildContext, loadJson } from "../server/context.js";
import { createApp } from "../server/app.js";
import { createHub } from "../server/ws-hub.js";
import { parsePhoneIntent } from "../server/phone/intents.js";

let server, base, ctx, web, phoneTk, clock = Date.now();
const call = (path, { method = "GET", body, tk = web } = {}) =>
  fetch(base + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(tk ? { authorization: `Bearer ${tk}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
const json = async (p, o) => (await call(p, o)).json();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  ctx = await buildContext({ db: createDb({ url: ":memory:" }), env: { OWNER_PASSWORD: "prueba-123" }, now: () => clock });
  server = createServer(createApp(ctx));
  ctx.hub = createHub({ server, sessions: ctx.sessions, bus: ctx.bus });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  web = (await ctx.sessions.create(ctx.ownerId, { name: "t", kind: "web" })).token;
  phoneTk = (await json("/api/devices", { method: "POST", body: { name: "iPhone", kind: "phone" } })).token;
});
after(() => { ctx.hub.close(); server.close(); });

test("el token phone solo sirve en /next y /done: 403 en chat, status, aprobaciones y WebSocket", async () => {
  assert.ok(phoneTk);
  for (const [p, m] of [["/api/chat", "POST"], ["/api/status", "GET"], ["/api/approvals", "GET"], ["/api/tasks", "GET"], ["/api/devices", "GET"], ["/api/phone/actions", "GET"]]) {
    assert.equal((await call(p, { method: m, tk: phoneTk, body: m === "POST" ? { text: "hola" } : undefined })).status, 403, p);
  }
  const ws = new WebSocket(base.replace("http", "ws") + "/ws");
  const closed = new Promise((r) => (ws.onclose = (e) => r(e.code)));
  await new Promise((r) => (ws.onopen = r));
  ws.send(JSON.stringify({ type: "auth", token: phoneTk }));
  assert.equal(await closed, 4401);
  // y el token web no puede usar /next
  assert.equal((await call("/api/phone/next", { method: "POST", tk: web })).status, 403);
  assert.equal((await call("/api/phone/next", { method: "POST", tk: null })).status, 401);
  const log = await ctx.db.execute("SELECT detail FROM audit_log WHERE action='phone.token_rechazado'");
  assert.ok(log.rows.length >= 2);
  assert.ok(!log.rows.some((r) => String(r.detail).includes(phoneTk)));
});

test("la lista blanca rechaza acciones y valores desconocidos", async () => {
  assert.equal((await call("/api/phone/actions", { method: "POST", body: { accion: "formatear_telefono", valor: "on" } })).status, 400);
  assert.equal((await call("/api/phone/actions", { method: "POST", body: { accion: "brillo", valor: 250 } })).status, 400);
  assert.equal((await call("/api/phone/actions", { method: "POST", body: { accion: "linterna", valor: "casi" } })).status, 400);
  assert.equal((await call("/api/phone/actions", { method: "POST", body: { accion: "abrir_app", valor: "BancoFalso" } })).status, 400);
  assert.equal((await call("/api/phone/actions", { method: "POST", body: { accion: "enviar_mensaje", valor: "hola" } })).status, 400); // falta "para"
});

test("acción automática: queda lista, el Atajo la reclama una sola vez y reporta hecha", async () => {
  const a = await json("/api/phone/actions", { method: "POST", body: { accion: "linterna", valor: "on" } });
  assert.equal(a.action.status, "lista");
  const b = await json("/api/phone/actions", { method: "POST", body: { accion: "brillo", valor: 30 } });
  const n = await json("/api/phone/next", { method: "POST", tk: phoneTk });
  assert.deepEqual(n.acciones.map((x) => [x.accion, x.valor]), [["linterna", "on"], ["brillo", 30]]);
  assert.deepEqual((await json("/api/phone/next", { method: "POST", tk: phoneTk })).acciones, []);
  const d = await call(`/api/phone/actions/${b.action.id}/done`, { method: "POST", tk: phoneTk, body: { ok: true, result: "listo" } });
  assert.equal(d.status, 200);
  assert.equal((await call(`/api/phone/actions/${b.action.id}/done`, { method: "POST", tk: phoneTk, body: {} })).status, 409); // ya hecha
  const hist = await json("/api/phone/actions");
  assert.equal(hist.acciones.find((x) => x.id === b.action.id).status, "hecha");
  assert.equal(hist.acciones.find((x) => x.id === a.action.id).status, "entregada");
});

test("el reclamo entrega como máximo 5 acciones", async () => {
  for (let i = 0; i < 7; i++) await call("/api/phone/actions", { method: "POST", body: { accion: "vibrar" } });
  assert.equal((await json("/api/phone/next", { method: "POST", tk: phoneTk })).acciones.length, 5);
  assert.equal((await json("/api/phone/next", { method: "POST", tk: phoneTk })).acciones.length, 2);
});

test("las acciones caducan a los 10 minutos", async () => {
  const a = await json("/api/phone/actions", { method: "POST", body: { accion: "linterna", valor: "off" } });
  clock += 11 * 60_000;
  assert.deepEqual((await json("/api/phone/next", { method: "POST", tk: phoneTk })).acciones, []);
  const h = await json("/api/phone/actions");
  assert.equal(h.acciones.find((x) => x.id === a.action.id).status, "caducada");
});

test("acción con aprobación: espera, al aprobar pasa a lista; al rechazar, rechazada", async () => {
  const m = await json("/api/phone/actions", { method: "POST", body: { accion: "enviar_mensaje", valor: "llego en 5", para: "Mamá" } });
  assert.equal(m.action.status, "aprobacion");
  assert.equal(m.action.args, undefined); // contenido privado no vuelve en el historial
  assert.deepEqual((await json("/api/phone/next", { method: "POST", tk: phoneTk })).acciones, []); // aún no
  const pend = (await json("/api/approvals")).approvals.find((x) => x.kind === "phone:enviar_mensaje");
  assert.ok(pend);
  assert.ok(!pend.summary.includes("llego")); // el resumen no lleva el contenido
  await call(`/api/approvals/${pend.id}`, { method: "POST", body: { approve: true } });
  await wait(100);
  const n = await json("/api/phone/next", { method: "POST", tk: phoneTk });
  assert.equal(n.acciones[0].accion, "enviar_mensaje");
  assert.equal(n.acciones[0].para, "Mamá");
  await call(`/api/phone/actions/${n.acciones[0].id}/done`, { method: "POST", tk: phoneTk, body: { ok: true, result: "secreto" } });
  const row = await ctx.db.execute({ sql: "SELECT result FROM phone_actions WHERE id=?", args: [n.acciones[0].id] });
  assert.equal(row.rows[0].result, "[omitido]");

  const w = await json("/api/phone/actions", { method: "POST", body: { accion: "wifi", valor: "off" } });
  assert.equal(w.action.status, "aprobacion");
  const p2 = (await json("/api/approvals")).approvals.find((x) => x.kind === "phone:wifi");
  await call(`/api/approvals/${p2.id}`, { method: "POST", body: { approve: false } });
  await wait(100);
  assert.equal((await json("/api/phone/actions")).acciones.find((x) => x.id === w.action.id).status, "rechazada");
  assert.deepEqual((await json("/api/phone/next", { method: "POST", tk: phoneTk })).acciones, []);
  // wifi on y URL de la lista son automáticas; URL fuera de lista pide aprobación
  assert.equal((await json("/api/phone/actions", { method: "POST", body: { accion: "wifi", valor: "on" } })).action.status, "lista");
  assert.equal((await json("/api/phone/actions", { method: "POST", body: { accion: "abrir_url", valor: "https://es.wikipedia.org/wiki/Messi" } })).action.status, "lista");
  assert.equal((await json("/api/phone/actions", { method: "POST", body: { accion: "abrir_url", valor: "https://sitio-raro.example/x" } })).action.status, "aprobacion");
});

test("la auditoría registra el ciclo sin guardar tokens ni contenido privado", async () => {
  const r = await ctx.db.execute("SELECT action, detail FROM audit_log WHERE action LIKE 'phone.%'");
  const acts = new Set(r.rows.map((x) => x.action));
  for (const a of ["phone.creada", "phone.aprobada", "phone.entregada", "phone.hecha", "phone.rechazada"]) assert.ok(acts.has(a), a);
  const todo = JSON.stringify(r.rows) + JSON.stringify((await ctx.db.execute("SELECT summary, detail FROM approvals WHERE kind LIKE 'phone:%' AND kind <> 'phone:enviar_mensaje'")).rows);
  assert.ok(!todo.includes(phoneTk) && !todo.includes("llego en 5") && !todo.includes("Mamá"));
});

test("límite de 60 peticiones por minuto por dispositivo", async () => {
  const t2 = (await json("/api/devices", { method: "POST", body: { name: "otro", kind: "phone" } })).token;
  let last;
  for (let i = 0; i < 61; i++) last = await call("/api/phone/next", { method: "POST", tk: t2 });
  assert.equal(last.status, 429);
  assert.equal((await call("/api/phone/next", { method: "POST", tk: phoneTk })).status, 200); // el otro dispositivo no se ve afectado
});

test("el chat entiende órdenes del teléfono sin modelo", async () => {
  const r = await json("/api/chat", { method: "POST", body: { text: "enciende la linterna" } });
  assert.equal(r.status, "telefono");
  const n = await json("/api/phone/next", { method: "POST", tk: (await json("/api/devices", { method: "POST", body: { kind: "phone" } })).token });
  assert.ok(n.acciones.some((x) => x.accion === "linterna" && x.valor === "on"));
  const normal = await json("/api/chat", { method: "POST", body: { text: "¿cómo estás?" } });
  assert.equal(normal.status, "ok");
});

test("intents: reglas fijas en español", () => {
  const cfg = loadJson("phone-actions.json");
  const p = (t) => parsePhoneIntent(t, cfg);
  assert.deepEqual(p("enciende la linterna"), { action: "linterna", args: { valor: "on" } });
  assert.deepEqual(p("Jarvis, apaga la linterna por favor"), { action: "linterna", args: { valor: "off" } });
  assert.deepEqual(p("brillo al 30"), { action: "brillo", args: { valor: 30 } });
  assert.deepEqual(p("pon el volumen al 50%"), { action: "volumen", args: { valor: 50 } });
  assert.deepEqual(p("apaga el bluetooth"), { action: "bluetooth", args: { valor: "off" } });
  assert.deepEqual(p("apaga el wifi"), { action: "wifi", args: { valor: "off" } });
  assert.deepEqual(p("no molestar una hora"), { action: "no_molestar", args: { valor: "on", minutos: 60 } });
  assert.deepEqual(p("activa no molestar 30 minutos"), { action: "no_molestar", args: { valor: "on", minutos: 30 } });
  assert.deepEqual(p("desactiva no molestar"), { action: "no_molestar", args: { valor: "off" } });
  assert.deepEqual(p("activa el modo bajo consumo"), { action: "bajo_consumo", args: { valor: "on" } });
  assert.deepEqual(p("abre WhatsApp"), { action: "abrir_app", args: { valor: "WhatsApp" } });
  assert.deepEqual(p("pon una alarma a las 7:30"), { action: "alarma", args: { valor: "07:30" } });
  assert.deepEqual(p("cuánta batería tengo"), { action: "bateria", args: {} });
  assert.deepEqual(p("pausa la música"), { action: "multimedia", args: { valor: "pausa" } });
  // no secuestra la charla normal ni apps fuera de la lista
  assert.equal(p("¿cómo estás?"), null);
  assert.equal(p("explícame cómo funciona la linterna de un faro"), null);
  assert.equal(p("abre BancoFalso"), null);
  assert.equal(p("brillo al 300"), null);
  assert.equal(p("la linterna del teléfono se apagó ayer y no sé por qué razón ocurre tantas veces seguidas en la noche"), null);
});
