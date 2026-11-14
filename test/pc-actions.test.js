import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { EventEmitter } from "node:events";
import { createDb } from "../server/db/client.js";
import { buildContext, loadJson } from "../server/context.js";
import { createApp } from "../server/app.js";
import { createHub } from "../server/ws-hub.js";
import { PC_ACTIONS, validateParams, DEFAULT_APPS } from "../desktop/runner/pc-spec.js";
import { createPcExecutor, keysScript } from "../desktop/runner/pc-exec.js";
import { createPcWorker } from "../desktop/runner/pc-worker.js";
import { parsePcIntent, detectDestino, stripDestino, interpretWithModel } from "../server/pc/intents.js";
import { classify } from "../server/router/classify.js";
import { createTools } from "../server/tools/index.js";

let server, base, ctx, web, pcTk, phoneTk, clock = Date.now();
const call = (path, { method = "GET", body, tk = web, headers = {} } = {}) =>
  fetch(base + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(tk ? { authorization: `Bearer ${tk}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
const json = async (p, o) => (await call(p, o)).json();
const chat = (text, origen) => json("/api/chat", { method: "POST", body: { text, origen } });
const enqueue = (accion, params) => call("/api/pc/actions", { method: "POST", body: { accion, params } });
const rows = async () => (await ctx.db.execute("SELECT * FROM pc_actions ORDER BY id")).rows;

before(async () => {
  ctx = await buildContext({ db: createDb({ url: ":memory:" }), env: { OWNER_PASSWORD: "prueba-123" }, now: () => clock });
  server = createServer(createApp(ctx));
  ctx.hub = createHub({ server, sessions: ctx.sessions, bus: ctx.bus });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  web = (await ctx.sessions.create(ctx.ownerId, { name: "t", kind: "web" })).token;
  pcTk = (await json("/api/devices", { method: "POST", body: { name: "PC", kind: "pc" } })).token;
  phoneTk = (await json("/api/devices", { method: "POST", body: { name: "iPhone", kind: "phone" } })).token;
});
after(() => { ctx.hub.close(); server.close(); });

// ---------- validación de parámetros ----------
test("la validación rechaza acciones fuera de la lista y parámetros malos", () => {
  const apps = Object.keys(DEFAULT_APPS);
  for (const id of ["formatear", "__proto__", "constructor", "", undefined, "powershell"]) assert.equal(validateParams(id, {}, { apps }).ok, false, String(id));
  assert.equal(validateParams("volumen", { accion: "fijar" }).error, "falta_nivel");
  assert.equal(validateParams("volumen", { accion: "fijar", nivel: 101 }).error, "nivel_fuera_de_rango");
  assert.equal(validateParams("volumen", { accion: "fijar", nivel: "50; calc" }).ok, false);
  assert.equal(validateParams("volumen", { accion: "fijar", nivel: 12.5 }).ok, false);
  assert.equal(validateParams("volumen", { accion: "explotar" }).error, "accion_invalido");
  assert.equal(validateParams("multimedia", { valor: "play_pausa; calc" }).ok, false);
  assert.equal(validateParams("temporizador", { minutos: 0 }).ok, false);
  assert.equal(validateParams("temporizador", { minutos: 721 }).ok, false);
  assert.equal(validateParams("abrir_app", { app: "cmd.exe" }, { apps }).error, "app_no_permitida");
  assert.equal(validateParams("abrir_app", { app: "..\\..\\x" }, { apps }).error, "app_no_permitida");
  assert.equal(validateParams("portapapeles_escribir", { texto: "a\u0000b" }).ok, false);
  assert.equal(validateParams("portapapeles_escribir", { texto: "x".repeat(2001) }).ok, false);
  assert.equal(validateParams("portapapeles_escribir", { texto: ["a"] }).ok, false);
  // claves extra se descartan y el nivel sobra si no es "fijar"
  const v = validateParams("volumen", { accion: "subir", nivel: 90, cmd: "calc", pasos: "3" });
  assert.deepEqual(v.params, { accion: "subir", pasos: 3 });
  assert.equal(validateParams("abrir_app", { app: "Calculadora" }, { apps }).params.app, "calculadora");
});

test("config/pc-actions.json coincide con la verdad del PC (pc-spec.js)", () => {
  const cfg = loadJson("pc-actions.json");
  assert.deepEqual(Object.keys(cfg.acciones).sort(), Object.keys(PC_ACTIONS).sort());
  for (const [id, d] of Object.entries(cfg.acciones)) {
    assert.equal(d.nivel, PC_ACTIONS[id].nivel, id);
    assert.deepEqual(d.params, PC_ACTIONS[id].params, id);
    assert.equal(!!d.privado, !!PC_ACTIONS[id].privado, id);
  }
  for (const a of cfg.apps) assert.ok(DEFAULT_APPS[a], `app sin comando en el PC: ${a}`);
  for (const id of ["apagar", "reiniciar", "portapapeles_leer"]) assert.equal(cfg.acciones[id].nivel, "aprobacion");
  assert.equal(cfg.acciones.suspender.nivel, "automatico");
});

// ---------- cola: PC apagado ----------
test("con el PC apagado no se encola nada y se dice claro", async () => {
  const r = await enqueue("bloquear", {});
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error, "pc_apagado");
  assert.equal((await rows()).length, 0);
  const c = await chat("bloquea el pc");
  assert.equal(c.status, "pc");
  assert.match(c.reply, /apagado/);
  assert.equal((await rows()).length, 0);
});

test("la lista blanca del servidor rechaza antes de encolar (y el token pc/phone no encolan)", async () => {
  assert.equal((await call("/api/agent/hello", { method: "POST", body: { version: "1", host: "MI-PC" }, tk: pcTk })).status, 200);
  assert.equal((await enqueue("formatear_disco", {})).status, 400);
  assert.equal((await enqueue("volumen", { accion: "fijar", nivel: 500 })).status, 400);
  assert.equal((await enqueue("abrir_app", { app: "powershell" })).status, 400);
  assert.equal((await call("/api/pc/actions", { method: "POST", body: { accion: "bloquear" }, tk: pcTk })).status, 403);
  assert.equal((await call("/api/pc/actions", { method: "POST", body: { accion: "bloquear" }, tk: phoneTk })).status, 403);
  assert.equal((await rows()).length, 0);
});

// ---------- ciclo completo ----------
test("automática: queda lista, el PC la reclama una vez y devuelve el resultado", async () => {
  const c = await enqueue("volumen", { accion: "fijar", nivel: 30 });
  assert.equal(c.status, 201);
  const { action } = await c.json();
  assert.equal(action.status, "lista");
  assert.equal((await call("/api/agent/pc/next", { method: "POST", tk: web })).status, 403);
  assert.equal((await call("/api/agent/pc/next", { method: "POST", tk: phoneTk })).status, 403);
  const n = await json("/api/agent/pc/next", { method: "POST", tk: pcTk });
  assert.deepEqual(n.accion, { id: action.id, accion: "volumen", params: { accion: "fijar", nivel: 30 }, aprobada: true });
  assert.equal((await json("/api/agent/pc/next", { method: "POST", tk: pcTk })).accion, null); // no se entrega dos veces
  const ok = await call(`/api/agent/pc/${action.id}/result`, { method: "POST", tk: pcTk, body: { ok: true, texto: "Volumen fijado" } });
  assert.equal(ok.status, 200);
  assert.equal((await call(`/api/agent/pc/${action.id}/result`, { method: "POST", tk: pcTk, body: { ok: true } })).status, 409);
  const got = (await json(`/api/pc/actions/${action.id}`)).action;
  assert.equal(got.status, "hecha");
  assert.equal(got.result.texto, "Volumen fijado");
  assert.equal((await call("/api/agent/pc/9999/result", { method: "POST", tk: pcTk, body: {} })).status, 404);
});

test("apagar y reiniciar SIEMPRE piden aprobación; sin ella el PC no recibe nada", async () => {
  const { action } = await (await enqueue("apagar", {})).json();
  assert.equal(action.status, "aprobacion");
  assert.equal((await json("/api/agent/pc/next", { method: "POST", tk: pcTk })).accion, null);
  assert.equal((await call(`/api/pc/actions/${action.id}/approve`, { method: "POST", body: { aprobar: true }, tk: pcTk })).status, 403);
  const ap = await call(`/api/pc/actions/${action.id}/approve`, { method: "POST", body: { aprobar: true } });
  assert.equal(ap.status, 200);
  await new Promise((r) => setTimeout(r, 20));
  const n = (await json("/api/agent/pc/next", { method: "POST", tk: pcTk })).accion;
  assert.equal(n.accion, "apagar");
  assert.equal(n.aprobada, true);
  await call(`/api/agent/pc/${n.id}/result`, { method: "POST", tk: pcTk, body: { ok: true, texto: "Apagando" } });
  // rechazada: nunca llega al PC
  const r2 = (await (await enqueue("reiniciar", {})).json()).action;
  assert.equal((await json(`/api/pc/actions/${r2.id}/approve`, { method: "POST", body: { aprobar: false } })).action.status, "rechazada");
  assert.equal((await json("/api/agent/pc/next", { method: "POST", tk: pcTk })).accion, null);
});

test("aprobar por /api/approvals también la deja lista, y leer el portapapeles es privado", async () => {
  const { action } = await (await enqueue("portapapeles_leer", {})).json();
  assert.equal(action.status, "aprobacion");
  assert.equal(action.privado, true);
  assert.equal(action.params, undefined);
  const pend = (await json("/api/approvals")).approvals ?? (await json("/api/approvals"));
  const a = (Array.isArray(pend) ? pend : pend.pendientes || []).find((x) => x.kind === "pc:portapapeles_leer");
  assert.ok(a);
  await call(`/api/approvals/${a.id}`, { method: "POST", body: { aprobar: true, approve: true, decision: "aprobada" } });
  const st = (await json(`/api/pc/actions/${action.id}`)).action.status;
  assert.ok(["lista", "aprobacion"].includes(st));
  await ctx.pc.decide(1, action.id, true).catch(() => {});
  await new Promise((r) => setTimeout(r, 20));
  const n = (await json("/api/agent/pc/next", { method: "POST", tk: pcTk })).accion;
  assert.equal(n.accion, "portapapeles_leer");
  await call(`/api/agent/pc/${n.id}/result`, { method: "POST", tk: pcTk, body: { ok: true, texto: "contenido copiado" } });
  const log = await ctx.db.execute("SELECT detail FROM audit_log WHERE action LIKE 'pc.%'");
  assert.ok(!log.rows.some((r) => String(r.detail).includes("contenido copiado")));
});

// ---------- chat: reglas, origen y modelo tipado ----------
test("chat: lo ambiguo va al dispositivo desde el que habla; lo explícito, al nombrado", async () => {
  const desdePc = await chat("sube el volumen", "pc");
  assert.equal(desdePc.status, "pc");
  const desdeMovil = await chat("pon el volumen al 40", "movil");
  assert.equal(desdeMovil.status, "telefono");
  const explicitoPc = await chat("pon el volumen al 40 en el pc", "movil");
  assert.equal(explicitoPc.status, "pc");
  const explicitoTel = await chat("pon el volumen al 40 en el móvil", "pc");
  assert.equal(explicitoTel.status, "telefono");
  const ap = await chat("apaga el ordenador", "movil");
  assert.equal(ap.status, "pc");
  assert.equal(ap.pc.status, "aprobacion");
  const sin = await chat("apaga", "pc");
  assert.notEqual(sin.pc?.status, "aprobacion"); // sin nombrar el PC, "apaga" no apaga nada
  // ninguna acción de texto libre
  const rows2 = await rows();
  assert.ok(rows2.every((r) => !/calc|powershell|cmd/i.test(r.params || "")));
});

test("reglas de intención: sinónimos de PC y órdenes típicas", () => {
  for (const w of ["pc", "ordenador", "computador", "computadora", "compu", "portátil"]) assert.equal(detectDestino(`bloquea el ${w}`), "pc", w);
  assert.equal(detectDestino("sube el volumen"), null);
  assert.equal(detectDestino("sube el volumen en el pc y en el móvil"), null);
  assert.equal(stripDestino("apaga mi computador"), "apaga");
  assert.deepEqual(parsePcIntent("siguiente canción"), { action: "multimedia", params: { valor: "siguiente" } });
  assert.deepEqual(parsePcIntent("silencia"), { action: "volumen", params: { accion: "silencio" } });
  assert.deepEqual(parsePcIntent("avisame en media hora", { destino: "pc" }), { action: "temporizador", params: { minutos: 30 } });
  assert.deepEqual(parsePcIntent("lee el portapapeles"), { action: "portapapeles_leer", params: {} });
  assert.equal(parsePcIntent("abre la calculadora", { apps: [] }), null);
  assert.equal(parsePcIntent("abre el bloc de notas y borra todo", { apps: ["bloc de notas"] }), null);
  assert.equal(parsePcIntent("apaga", { destino: null }), null);
});

test("el modelo solo puede elegir de la lista y se valida; lo privado se marca", async () => {
  const mk = (text, seen = []) => ({ route: async (a) => { seen.push(a); return { ok: true, text }; } });
  const seen = [];
  const good = await interpretWithModel({ router: mk('Claro: {"accion":"volumen","params":{"accion":"fijar","nivel":20}}', seen), pc: ctx.pc, userId: 1, text: "deja el volumen bajito", isPrivate: true });
  assert.deepEqual(good, { action: "volumen", params: { accion: "fijar", nivel: 20 } });
  assert.equal(seen[0].isPrivate, true);
  assert.equal(seen[0].prefer, "groq");
  assert.match(seen[0].system, /SOLO con JSON/);
  for (const bad of ['{"accion":"ejecutar","params":{"cmd":"del *"}}', '{"accion":"volumen","params":{"accion":"fijar","nivel":900}}', '{"accion":"abrir_app","params":{"app":"cmd"}}', "no es json", '{"accion":null}', '{"accion":["apagar"]}'])
    assert.equal(await interpretWithModel({ router: mk(bad), pc: ctx.pc, userId: 1, text: "x" }), null, bad);
  assert.equal(await interpretWithModel({ router: { route: async () => ({ ok: false }) }, pc: ctx.pc, userId: 1, text: "x" }), null);
});

// ---------- arreglos previos ----------
test("classify reconoce computador/compu/ordenador/pc/portátil", () => {
  for (const w of ["computador", "computadora", "compu", "ordenador", "pc", "portátil"]) assert.equal(classify(`ejecuta las pruebas en mi ${w}`).kind, "accion_pc", w);
  assert.equal(classify("haz esto en el computador").kind, "accion_pc");
  assert.equal(classify("hola, ¿cómo estás?").kind, "charla");
});

test("telefono.accion separa la frase por espacios (\\s+)", async () => {
  let got;
  const tools = createTools({ phone: { config: {}, create: async (a) => { got = a; return { ok: true, item: { status: "lista", nombre: "x" } }; } } });
  await tools.run({ userId: 1, name: "telefono.accion", args: { frase: "foo   bar   baz" } });
  assert.equal(got.action, "foo");
  assert.equal(got.args.valor, "bar baz");
});

// ---------- el PC simulado: nada real se ejecuta ----------
function fakePc(over = {}) {
  const calls = { exec: [], spawn: [], notify: [], clip: [], timers: [] };
  const clipboard = { text: "portapapeles de prueba", readText() { return this.text; }, writeText(t) { this.text = t; calls.clip.push(t); } };
  const exec = {
    execFile: async (cmd, args) => { calls.exec.push([cmd, args]); return { stdout: cmd === "powershell.exe" ? '{"EstimatedChargeRemaining":80,"BatteryStatus":2}' : "" }; },
    spawn: (cmd, args) => { calls.spawn.push([cmd, args]); const c = new EventEmitter(); c.unref = () => {}; process.nextTick(() => c.emit("spawn")); return c; },
    clipboard, notify: (t, b) => calls.notify.push([t, b]), platform: "win32", sleep: async () => {},
    os: { cpus: (() => { let n = 0; return () => { n++; return [{ times: { user: 100 * n, nice: 0, sys: 100 * n, idle: 800 * n, irq: 0 } }]; }; })(), totalmem: () => 16 * 1024 ** 3, freemem: () => 8 * 1024 ** 3 },
    statfs: () => ({ bavail: 100 * 1024, bsize: 1024 ** 2, blocks: 500 * 1024 }),
    setTimer: (fn, ms) => { calls.timers.push(ms); calls.fire = fn; return calls.timers.length; }, clearTimer: () => {},
    ...over,
  };
  return { calls, ex: createPcExecutor(exec) };
}
const decode = (b64) => Buffer.from(b64, "base64").toString("utf16le");

test("PC simulado: volumen y multimedia mandan scripts fijos con solo enteros", async () => {
  const { calls, ex } = fakePc();
  assert.equal((await ex.execute({ accion: "multimedia", params: { valor: "play_pausa" } })).ok, true);
  const [cmd, args] = calls.exec[0];
  assert.equal(cmd, "powershell.exe");
  assert.ok(args.includes("-EncodedCommand") && args.includes("-NoProfile"));
  assert.match(decode(args.at(-1)), /keybd_event\(179,0,0/);
  await ex.execute({ accion: "volumen", params: { accion: "fijar", nivel: 30 } });
  const s = decode(calls.exec[1][1].at(-1));
  assert.match(s, /1\.\.50/); assert.match(s, /1\.\.15/); assert.match(s, /keybd_event\(174/); assert.match(s, /keybd_event\(175/);
  assert.doesNotMatch(s, /calc|Invoke-Expression|iex/i);
  await ex.execute({ accion: "volumen", params: { accion: "silencio" } });
  assert.match(decode(calls.exec[2][1].at(-1)), /keybd_event\(173/);
  assert.throws(() => keysScript([[179, "1; calc"]]));
  assert.throws(() => keysScript([[179, 999]]));
});

test("PC simulado: bloquear, suspender y apagar usan comandos fijos; apagar exige aprobación", async () => {
  const { calls, ex } = fakePc();
  await ex.execute({ accion: "bloquear", params: {} });
  assert.deepEqual(calls.exec[0], ["rundll32.exe", ["user32.dll,LockWorkStation"]]);
  await ex.execute({ accion: "suspender", params: {} });
  assert.deepEqual(calls.exec[1], ["rundll32.exe", ["powrprof.dll,SetSuspendState", "0,1,0"]]);
  const sin = await ex.execute({ accion: "apagar", params: {}, aprobada: false });
  assert.equal(sin.ok, false); assert.match(sin.texto, /aprobación/);
  assert.equal((await ex.execute({ accion: "reiniciar", params: {} })).ok, false);
  assert.equal(calls.exec.length, 2); // nada más se ejecutó
  assert.equal((await ex.execute({ accion: "apagar", params: {}, aprobada: true })).ok, true);
  assert.deepEqual(calls.exec[2][1].slice(0, 3), ["/s", "/t", "30"]);
  assert.equal((await ex.execute({ accion: "portapapeles_leer", params: {}, aprobada: false })).ok, false);
  const leido = await ex.execute({ accion: "portapapeles_leer", params: {}, aprobada: true });
  assert.equal(leido.texto, "portapapeles de prueba");
});

test("PC simulado: rechaza lo que el servidor no debería mandar", async () => {
  const { calls, ex } = fakePc();
  for (const a of [{ accion: "ejecutar", params: { cmd: "calc" } }, { accion: "volumen", params: { accion: "fijar", nivel: 1000 } }, { accion: "abrir_app", params: { app: "cmd.exe" } }, { accion: "temporizador", params: { minutos: -5 } }, { accion: "toString", params: {} }, { accion: "multimedia", params: { valor: "x" } }]) {
    const r = await ex.execute(a);
    assert.equal(r.ok, false, JSON.stringify(a));
  }
  assert.equal(calls.exec.length + calls.spawn.length, 0);
});

test("PC simulado: abrir app (lista), portapapeles, temporizador y estado", async () => {
  const { calls, ex } = fakePc();
  assert.equal((await ex.execute({ accion: "abrir_app", params: { app: "Calculadora" } })).ok, true);
  assert.deepEqual(calls.spawn[0], ["calc.exe", []]);
  await ex.execute({ accion: "abrir_app", params: { app: "configuracion" } });
  assert.deepEqual(calls.spawn[1], ["explorer.exe", ["ms-settings:"]]);
  assert.equal((await ex.execute({ accion: "abrir_app", params: { app: "regedit" } })).ok, false);
  await ex.execute({ accion: "portapapeles_escribir", params: { texto: "hola; calc & dir" } });
  assert.deepEqual(calls.clip, ["hola; calc & dir"]); // se copia como texto, no se ejecuta
  assert.equal(calls.exec.length, 0);
  const t = await ex.execute({ accion: "temporizador", params: { minutos: 10, texto: "pizza" } });
  assert.equal(t.ok, true);
  assert.deepEqual(calls.timers, [600_000]);
  calls.fire();
  assert.deepEqual(calls.notify[0], ["Jarvis", "Aviso: pizza"]);
  const e = await ex.execute({ accion: "estado_sistema", params: {} });
  assert.equal(e.ok, true);
  assert.equal(e.datos.ram_total_gb, 16); assert.equal(e.datos.bateria_pct, 80); assert.equal(e.datos.cargando, true); assert.equal(e.datos.disco_libre_gb, 100);
  assert.match(e.texto, /CPU \d+%/);
});

test("PC simulado: apps extra del config del PC se suman, las mal formadas se ignoran", async () => {
  const { calls, ex } = fakePc({ apps: { discord: { cmd: "C:\\x\\discord.exe", args: [] }, malo: { cmd: 5 }, peor: "cmd" } });
  assert.ok(ex.appNames().includes("discord")); assert.ok(!ex.appNames().includes("malo")); assert.ok(!ex.appNames().includes("peor"));
  await ex.execute({ accion: "abrir_app", params: { app: "discord" } });
  assert.equal(calls.spawn[0][0], "C:\\x\\discord.exe");
});

test("PC simulado en Linux/Mac: las acciones de Windows fallan limpio", async () => {
  const { calls, ex } = fakePc({ platform: "linux" });
  const r = await ex.execute({ accion: "bloquear", params: {} });
  assert.equal(r.ok, false); assert.match(r.texto, /Windows/);
  assert.equal(calls.exec.length, 0);
});

test("el bucle del PC reclama, ejecuta y devuelve el resultado (hub simulado)", async () => {
  const { ex } = fakePc();
  const sent = [];
  const queue = [{ id: 7, accion: "bloquear", params: {}, aprobada: true }, { id: 8, accion: "apagar", params: {}, aprobada: false }];
  const hub = { pcNext: async () => ({ accion: queue.shift() || null }), pcResult: async (id, out) => sent.push([id, out.ok]) };
  const w = createPcWorker({ hub, executor: ex });
  assert.deepEqual(await w.tick(), { done: 7, ok: true });
  assert.deepEqual(await w.tick(), { done: 8, ok: false }); // sin aprobación el PC la rechaza aunque llegue
  assert.deepEqual(await w.tick(), { idle: true });
  assert.deepEqual(sent, [[7, true], [8, false]]);
  const caido = createPcWorker({ hub: { pcNext: async () => { throw new Error("sin red"); } }, executor: ex });
  assert.equal((await caido.tick()).error, "sin red");
});

test("de punta a punta contra el servidor real: encolar, reclamar con el worker y ver el resultado", async () => {
  const { ex, calls } = fakePc();
  const hub = {
    pcNext: async () => (await json("/api/agent/pc/next", { method: "POST", tk: pcTk })),
    pcResult: async (id, out) => (await call(`/api/agent/pc/${id}/result`, { method: "POST", tk: pcTk, body: out })).json(),
  };
  const { action } = await (await enqueue("estado_sistema", {})).json();
  const w = createPcWorker({ hub, executor: ex });
  let r; do { r = await w.tick(); } while (r.done !== action.id && !r.idle); // las acciones que dejaron otras pruebas se atienden antes (cola en orden)
  assert.equal(r.done, action.id);
  const got = (await json(`/api/pc/actions/${action.id}`)).action;
  assert.equal(got.status, "hecha");
  assert.equal(got.result.datos.bateria_pct, 80);
  assert.ok(calls.exec.length >= 1);
});

test("caducan las acciones que el PC no recogió y las reclamadas sin respuesta", async () => {
  const { action } = await (await enqueue("bloquear", {})).json();
  clock += 6 * 60_000;
  await call("/api/agent/hello", { method: "POST", body: { version: "1" }, tk: pcTk }); // el PC sigue en línea
  assert.equal((await json(`/api/pc/actions/${action.id}`)).action.status, "caducada");
  assert.equal((await json("/api/agent/pc/next", { method: "POST", tk: pcTk })).accion, null);
  const b = (await (await enqueue("bloquear", {})).json()).action;
  await json("/api/agent/pc/next", { method: "POST", tk: pcTk });
  clock += 3 * 60_000;
  await call("/api/agent/hello", { method: "POST", body: { version: "1" }, tk: pcTk });
  assert.equal((await json(`/api/pc/actions/${b.id}`)).action.status, "fallida");
});
