// Ratón y teclado (docs/CONTROL.md). Nada real: execFile falso; los scripts solo se analizan, nunca se ejecutan.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { buildContext } from "../server/context.js";
import { createApp } from "../server/app.js";
import { all } from "../server/db/client.js";
import { createPcExecutor, PS_PROGRAMAS, PS_ABRIR, PS_PAPELERA } from "../desktop/runner/pc-exec.js";
import { createControlState } from "../desktop/runner/control-state.js";
import { UI_SCRIPTS, SOLTAR } from "../desktop/runner/pc-ui.js";
import { entradaValida, objetivoPermitido, bloqueado } from "../desktop/runner/pc-reglas.js";
import { PC_ACTIONS } from "../desktop/runner/pc-spec.js";
import { memDb, clock } from "./helpers.js";

const dec = (args) => Buffer.from(args.at(-1), "base64").toString("utf16le");
const LISTA = [{ tipo: "app", valor: "notepad.exe" }, { tipo: "host", valor: "example.com" }];
const SECRETO = "zanahoria violeta 42";

function equipo({ raton = true, respuesta = { ok: true, proceso: "notepad.exe", host: "" }, now, colgar = false } = {}) {
  const control = createControlState(now ? { now } : {});
  control.servidor({ freno: false, amplio: false, raton, lista: LISTA });
  const llamadas = [], registro = [];
  const execFile = (cmd, args, opts = {}) => {
    llamadas.push({ script: dec(args), ...opts });
    if (!colgar || dec(args) === SOLTAR) return Promise.resolve({ stdout: JSON.stringify(respuesta) });
    return new Promise((_, fail) => opts.signal.addEventListener("abort", () => fail(new Error("abortado"))));
  };
  const ex = createPcExecutor({ control, execFile, platform: "win32", registrar: (e) => registro.push(e) });
  const escribir = (objetivo = "notepad.exe") => ex.execute({ accion: "ui_escribir", params: { objetivo, texto: SECRETO }, aprobada: true });
  return { control, ex, llamadas, registro, escribir };
}

test("el texto viaja solo por entorno y el registro lleva solo acción y objetivo", async () => {
  const { escribir, llamadas, registro } = equipo();
  const r = await escribir();
  assert.equal(r.ok, true);
  assert.equal(llamadas[0].script, UI_SCRIPTS.ui_escribir);
  assert.ok(!llamadas[0].script.includes(SECRETO));
  assert.equal(JSON.parse(llamadas[0].env.J_DATOS).texto, SECRETO);
  assert.deepEqual(registro, [{ accion: "ui_escribir", detalle: "notepad.exe" }]);
  assert.ok(!r.texto.includes(SECRETO));
});

test("fuera de lista o con el permiso apagado no se lanza nada", async () => {
  for (const e of [equipo(), equipo({ raton: false })]) {
    assert.equal((await e.escribir("calc.exe")).ok, false);
    assert.equal(e.llamadas.length, 0);
  }
  const apagado = equipo({ raton: false });
  assert.equal((await apagado.escribir()).ok, false);
  assert.equal(apagado.llamadas.length, 0);
});

test("hwnd=0, contraseña, host ilegible y ventana ajena se informan como fallo", async () => {
  for (const motivo of ["sin_ventana", "campo_contrasena", "host_ilegible"]) {
    const r = await equipo({ respuesta: { ok: false, motivo } }).escribir();
    assert.equal(r.ok, false, motivo);
  }
  // Aunque el script dijera ok, Node repite la decisión.
  for (const proceso of ["consent.exe", "jarvis.exe", "electron.exe", "claude.exe", "calc.exe", "chrome.exe", ""]) {
    assert.equal((await equipo({ respuesta: { ok: true, proceso } }).escribir()).ok, false, proceso);
  }
  assert.equal((await equipo({ respuesta: { ok: true, proceso: "chrome.exe", host: "" } }).escribir("example.com")).ok, false);
  assert.equal((await equipo({ respuesta: { ok: true, proceso: "chrome.exe", host: "www.example.com" } }).escribir("example.com")).ok, true);
  const s = UI_SCRIPTS.ui_escribir;
  const orden = ["GetForegroundWindow()\n", "GetWindowThreadProcessId($hwnd", "host_ilegible", "fuera_de_objetivo", "campo_contrasena", "Delante\n", "[JU]::Letra($c)"].map((x) => s.indexOf(x));
  assert.deepEqual([...orden].sort((a, b) => a - b), orden);
  assert.ok(s.indexOf("no_es_campo") > 0 && s.indexOf("no_es_campo") < s.indexOf("[JU]::Letra($c)")); // nunca sobre un botón
});

test("no pulsa botones de pago ni de permisos", async () => {
  for (const elemento of ["Pagar ahora", "Comprar", "Transferir", "Permitir", "Allow", "Aprobar"]) {
    const e = equipo();
    assert.equal((await e.ex.execute({ accion: "ui_pulsar", params: { objetivo: "notepad.exe", elemento }, aprobada: true })).ok, false, elemento);
    assert.equal(e.llamadas.length, 0);
  }
});

test("31 s sin servidor apaga el ratón y vacía la lista", async () => {
  const now = clock();
  const e = equipo({ now });
  now.advance(31_000);
  assert.equal((await e.escribir()).ok, false);
  assert.deepEqual(e.control.lista(), []);
  assert.equal(e.llamadas.length, 0);
});

test("freno a mitad: aborta lo que corre y suelta teclas y botones", async () => {
  const e = equipo({ colgar: true });
  e.control.onFreno(() => e.ex.stop());
  const p = e.escribir();
  await new Promise((r) => setImmediate(r));
  e.control.frenar();
  const r = await p;
  assert.equal(r.ok, false);
  assert.ok(e.llamadas[0].signal.aborted);
  await new Promise((r2) => setImmediate(r2));
  assert.ok(e.llamadas.some((l) => l.script === SOLTAR));
});

test("reglas puras de la lista", () => {
  const negados = ["mi-hub.onrender.com"];
  for (const valor of ["claude.exe", "cmd.exe", "powershell.exe", "windowsterminal.exe", "taskmgr.exe", "regedit.exe", "consent.exe", "logonui.exe", "keepass.exe", "chrome.exe", "..\\x.exe"]) assert.equal(entradaValida({ tipo: "app", valor }), null, valor);
  for (const valor of ["claude.ai", "api.anthropic.com", "mibanco.cl", "paypal.com", "webpay.cl", "mercadopago.com", "localhost", "192.168.0.1", "mi-hub.onrender.com", "https://x.com/a"]) assert.equal(entradaValida({ tipo: "host", valor }, { negados }), null, valor);
  assert.deepEqual(entradaValida({ tipo: "host", valor: "WWW.Example.com" }), { tipo: "host", valor: "example.com" });
  assert.equal(objetivoPermitido({ proceso: "notepad.exe" }, LISTA[0]), true);
  assert.equal(objetivoPermitido({ proceso: "msedge.exe", host: "evil.com" }, LISTA[1]), false);
  assert.equal(bloqueado("CredentialUIBroker.exe"), true);
});

test("los scripts de PowerShell parsean (sin ejecutarlos)", { skip: process.platform !== "win32" }, () => {
  const revisar = "$e=$null;$t=$null;[void][System.Management.Automation.Language.Parser]::ParseInput($env:J_S,[ref]$t,[ref]$e); if($e.Count){ $e | ForEach-Object { $_.Message }; exit 1 }";
  for (const [nombre, script] of Object.entries({ ...UI_SCRIPTS, SOLTAR, PS_PROGRAMAS, PS_ABRIR, PS_PAPELERA })) {
    try { execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", revisar], { env: { ...process.env, J_S: script }, stdio: "pipe" }); }
    catch (e) { assert.fail(`${nombre}: ${e.stdout}`); }
  }
});

async function levantar(t) {
  const { db } = await memDb();
  const ctx = await buildContext({ db, env: { OWNER_PASSWORD: "prueba-123", PUBLIC_URL: "https://mi-hub.example.org" } });
  const server = createServer(createApp(ctx));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => { server.closeAllConnections?.(); server.close(); });
  const pedir = async (ruta, { token, method = "GET", body } = {}) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api${ruta}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  const web = (await pedir("/auth/login", { method: "POST", body: { password: "prueba-123" } })).data.token;
  const pc = (await pedir("/devices", { token: web, method: "POST", body: { name: "pc", kind: "pc" } })).data.token;
  const uid = ctx.ownerId;
  await ctx.agent.heartbeat(uid, { capabilities: { pc_acciones: Object.keys(PC_ACTIONS) } });
  return { ctx, db, pedir, web, pc, uid };
}

test("la lista solo la cambia la web y rechaza banca, Jarvis y el propio servidor", async (t) => {
  const { ctx, pedir, web, pc, uid } = await levantar(t);
  const poner = (lista, token = web) => pedir("/control/lista", { token, method: "PUT", body: { lista } });
  assert.equal((await poner(LISTA, pc)).status, 403);
  assert.equal((await pedir("/control/lista", { token: pc })).status, 403);
  for (const e of [{ tipo: "host", valor: "mibanco.cl" }, { tipo: "app", valor: "jarvis.exe" }, { tipo: "host", valor: "mi-hub.example.org" }]) assert.equal((await poner([e])).status, 400, e.valor);
  assert.equal((await poner(Array.from({ length: 21 }, (_, i) => ({ tipo: "app", valor: `a${i}.exe` })))).status, 400);
  assert.equal((await poner(LISTA)).status, 200);
  assert.equal((await ctx.control.paraPc(uid)).lista, undefined);
  await ctx.control.activar(uid, { raton: true });
  assert.deepEqual((await ctx.control.paraPc(uid)).lista, LISTA);
});

test("el texto tecleado no queda en la base, ni en la aprobación ni en el chat; la orden fija pulsa sin tarjeta", async (t) => {
  const { ctx, db, pedir, web, uid } = await levantar(t);
  await pedir("/control/lista", { token: web, method: "PUT", body: { lista: LISTA } });
  const decir = (text, source = "texto") => ctx.chat.handle({ userId: uid, text, source });
  assert.equal((await decir("en notepad pulsa Guardar")).pc.error, "raton_apagado");
  await ctx.control.activar(uid, { raton: true });
  assert.equal((await decir("en notepad pulsa Guardar")).pc.status, "lista");
  assert.equal((await decir("en example.com presiona enter", "voz")).pc.status, "lista");
  assert.equal((await decir("en notepad pulsa Guardar", "rutina")).pc.status, "aprobacion");
  assert.equal((await ctx.pc.create({ userId: uid, action: "ui_pulsar", params: { objetivo: "calc.exe", elemento: "x" } })).error, "objetivo_no_permitido");

  const r = await decir(`en notepad escribe ${SECRETO}`);
  assert.equal(r.pc.status, "aprobacion"); // escribir pide aprobación siempre
  const aprob = (await ctx.approvals.pending(uid)).find((a) => a.kind === "pc:ui_escribir");
  assert.match(aprob.summary, new RegExp(`Escribir ${SECRETO.length} caracteres en notepad.exe`));
  await ctx.pc.decide(uid, r.pc.id, false);
  assert.equal((await all(db, "SELECT params FROM pc_actions WHERE id=?", [r.pc.id]))[0].params, "{}");

  // Aprobada, entregada y terminada: también se borra.
  const otra = await decir(`en notepad escribe ${SECRETO}`);
  await ctx.pc.decide(uid, otra.pc.id, true);
  for (let a = await ctx.pc.next(uid); a; a = await ctx.pc.next(uid)) await ctx.pc.result(uid, a.id, { ok: true, texto: "hecho" });
  const tablas = await all(db, "SELECT name FROM sqlite_master WHERE type='table'");
  for (const { name } of tablas) {
    let filas = [];
    try { filas = await all(db, `SELECT * FROM "${name}"`); } catch { continue; }
    assert.ok(!JSON.stringify(filas, (_, v) => (typeof v === "bigint" ? Number(v) : v)).includes("zanahoria"), name);
  }
});
