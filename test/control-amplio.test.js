// Control amplio (docs/CONTROL.md): permisos, orden fija, programas y archivos. Nada real: execFile y fs falsos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import path from "node:path";
import { buildContext } from "../server/context.js";
import { createApp } from "../server/app.js";
import { all } from "../server/db/client.js";
import { parsePcIntent } from "../server/pc/intents.js";
import { createPcExecutor, PS_PAPELERA, PS_ABRIR } from "../desktop/runner/pc-exec.js";
import { createPcFiles } from "../desktop/runner/pc-files.js";
import { createControlState } from "../desktop/runner/control-state.js";
import { PC_ACTIONS } from "../desktop/runner/pc-spec.js";
import { memDb } from "./helpers.js";

const RAIZ = path.resolve("/permitida");
const dec = (args) => Buffer.from(args.at(-1), "base64").toString("utf16le");

// fs falso: { ruta relativa: "dir"|"file" } dentro de RAIZ.
function fakeFs(arbol) {
  const mapa = new Map([[RAIZ, "dir"], ...Object.entries(arbol).map(([k, v]) => [path.join(RAIZ, k), v])]);
  const hay = (p) => { if (!mapa.has(p)) throw Object.assign(new Error("no existe"), { code: "ENOENT" }); return mapa.get(p); };
  const stat = async (p) => { const t = hay(p); return { isDirectory: () => t === "dir", isFile: () => t === "file", isSymbolicLink: () => false }; };
  const cambios = [];
  return { cambios, stat, lstat: stat, realpath: async (p) => { hay(p); return p; },
    rename: async (a, b) => { cambios.push(["rename", a, b]); }, mkdir: async (p) => { cambios.push(["mkdir", p]); } };
}

function equipo({ amplio = true, arbol = {}, responder = () => ({ stdout: "" }) } = {}) {
  const control = createControlState();
  control.servidor({ freno: false, amplio, raton: false });
  const llamadas = [], fs = fakeFs(arbol);
  const execFile = async (cmd, args, opts = {}) => { llamadas.push({ cmd, script: dec(args), ...opts }); return responder(dec(args), opts); };
  const ex = createPcExecutor({ control, execFile, platform: "win32", files: createPcFiles({ roots: { docs: RAIZ }, fs }) });
  const hacer = (accion, params) => ex.execute({ accion, params, aprobada: true });
  return { control, llamadas, fs, ex, hacer };
}

test("con el permiso apagado el PC no hace nada", async () => {
  const { hacer, llamadas, fs } = equipo({ amplio: false, arbol: { "a.txt": "file" } });
  for (const [a, p] of [["abrir_programa", { nombre: "Word" }], ["archivos_papelera", { raiz: "docs", ruta: "a.txt" }], ["archivos_crear_carpeta", { raiz: "docs", ruta: "x" }]]) {
    const r = await hacer(a, p);
    assert.equal(r.ok, false); assert.match(r.texto, /apagado/);
  }
  assert.equal(llamadas.length + fs.cambios.length, 0);
});

test("mover y crear: dentro de la raíz, sin pisar y sin secretos", async () => {
  const { hacer, fs } = equipo({ arbol: { "a.txt": "file", "b.txt": "file", sub: "dir" } });
  assert.equal((await hacer("archivos_mover", { raiz: "docs", de: "a.txt", a: "sub/a.txt" })).ok, true);
  assert.equal((await hacer("archivos_crear_carpeta", { raiz: "docs", ruta: "sub/nueva" })).ok, true);
  assert.deepEqual(fs.cambios.map((c) => c[0]), ["rename", "mkdir"]);
  for (const p of [{ de: "a.txt", a: "b.txt" }, { de: "a.txt", a: "../fuera.txt" }, { de: "a.txt", a: "C:/fuera.txt" }, { de: "a.txt", a: ".env" }, { de: "a.txt", a: "noexiste/x.txt" }]) {
    assert.equal((await hacer("archivos_mover", { raiz: "docs", ...p })).ok, false, p.a);
  }
  assert.equal((await hacer("archivos_mover", { raiz: "otra", de: "a.txt", a: "c.txt" })).ok, false);
  assert.equal(fs.cambios.length, 2);
});

test("papelera: script fijo y la ruta solo por variable de entorno", async () => {
  const { hacer, llamadas } = equipo({ arbol: { "informe final.txt": "file" } });
  assert.equal((await hacer("archivos_papelera", { raiz: "docs", ruta: "informe final.txt" })).ok, true);
  assert.equal(llamadas[0].script, PS_PAPELERA);
  assert.match(PS_PAPELERA, /SendToRecycleBin/);
  assert.doesNotMatch(PS_PAPELERA, /Remove-Item|informe/);
  assert.equal(llamadas[0].env.J_RUTA, path.join(RAIZ, "informe final.txt"));
  assert.ok(llamadas[0].signal);
  assert.equal((await hacer("archivos_papelera", { raiz: "docs", ruta: "" })).ok, false);
});

test("abrir programa: coincidencia única y lista negra", async () => {
  const apps = [{ Name: "Word", AppID: "Microsoft.Word" }, { Name: "Windows PowerShell", AppID: "ps" }, { Name: "Visor Uno", AppID: "v1" }, { Name: "Visor Dos", AppID: "v2" }, { Name: "Símbolo del sistema", AppID: "x\\cmd.exe" }];
  const { hacer, llamadas } = equipo({ responder: (s) => ({ stdout: s.includes("Get-StartApps") ? JSON.stringify(apps) : "" }) });
  assert.equal((await hacer("abrir_programa", { nombre: "word" })).ok, true);
  assert.equal(llamadas.at(-1).script, PS_ABRIR);
  assert.equal(llamadas.at(-1).env.J_APPID, "Microsoft.Word");
  for (const nombre of ["visor", "powershell", "Símbolo del sistema", "no existe", "Claude", "Jarvis", "Bitwarden", "Banco X", "regedit"]) {
    const antes = llamadas.filter((l) => l.script === PS_ABRIR).length;
    assert.equal((await hacer("abrir_programa", { nombre })).ok, false, nombre);
    assert.equal(llamadas.filter((l) => l.script === PS_ABRIR).length, antes);
  }
});

test("las frases fijas reconocen archivos y programas", () => {
  const p = (s, destino = "pc") => parsePcIntent(s, { apps: ["calculadora"], destino });
  assert.deepEqual(p("borra el archivo notas.txt de documentos"), { action: "archivos_papelera", params: { raiz: "documentos", ruta: "notas.txt" } });
  assert.deepEqual(p("renombra el archivo a.txt de documentos a b.txt"), { action: "archivos_mover", params: { raiz: "documentos", de: "a.txt", a: "b.txt" } });
  assert.deepEqual(p("crea la carpeta Física en documentos"), { action: "archivos_crear_carpeta", params: { raiz: "documentos", ruta: "Física" } });
  assert.deepEqual(p("abre el programa Word", null), { action: "abrir_programa", params: { nombre: "Word" } });
  assert.equal(p("abre el programa calculadora", null).action, "abrir_app");
});

async function levantar(t) {
  const { db } = await memDb();
  let ahora = Date.now();
  const ctx = await buildContext({ db, env: { OWNER_PASSWORD: "prueba-123" }, now: () => ahora });
  const server = createServer(createApp(ctx));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => { server.closeAllConnections?.(); server.close(); });
  const pedir = async (ruta, { token, method = "GET", body } = {}) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api${ruta}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  const uid = ctx.ownerId;
  await ctx.agent.heartbeat(uid, { capabilities: { pc_acciones: Object.keys(PC_ACTIONS) } });
  const filas = () => all(db, "SELECT action, status, approved, params FROM pc_actions ORDER BY id");
  const decir = (text, source = "texto") => ctx.chat.handle({ userId: uid, text, source });
  return { ctx, db, pedir, uid, filas, decir };
}

test("permiso apagado: no se encola; la orden fija no pide aprobación y lo demás sí", async (t) => {
  const { ctx, uid, filas, decir } = await levantar(t);
  const orden = "en el pc borra el archivo notas.txt de documentos";
  const sin = await decir(orden);
  assert.equal(sin.pc.error, "amplio_apagado");
  assert.match(sin.reply, /web/);
  assert.equal((await filas()).length, 0);

  await ctx.control.activar(uid, { amplio: true });
  assert.equal((await decir(orden)).pc.status, "lista");
  assert.equal((await decir(orden, "voz")).pc.status, "lista");
  for (const source of ["rutina", "atajo", "telegram"]) assert.equal((await decir(orden, source)).pc.status, "aprobacion", source);
  const params = { raiz: "documentos", ruta: "notas.txt" };
  assert.equal((await ctx.pc.create({ userId: uid, action: "archivos_papelera", params, source: "escena" })).item.status, "aprobacion");
  // La autorización nunca cuenta para apagar el equipo.
  assert.equal((await ctx.pc.create({ userId: uid, action: "apagar", autorizada: true })).item.status, "aprobacion");
  assert.deepEqual((await filas()).map((f) => Number(f.approved)).slice(0, 3), [1, 1, 0]);

  await ctx.control.activar(uid, { amplio: false });
  assert.ok((await filas()).filter((f) => f.action === "archivos_papelera").every((f) => f.status === "rechazada"));
  assert.equal((await ctx.approvals.pending(uid)).filter((a) => a.kind === "pc:archivos_papelera").length, 0);
});

test("freno: nada entra y lo pendiente se rechaza", async (t) => {
  const { ctx, uid, filas, decir } = await levantar(t);
  await ctx.control.activar(uid, { amplio: true });
  await decir("abre el programa Word");
  await ctx.control.freno(uid);
  assert.equal((await filas())[0].status, "rechazada");
  assert.equal((await ctx.pc.create({ userId: uid, action: "abrir_programa", params: { nombre: "Word" }, autorizada: true })).error, "frenado");
});
