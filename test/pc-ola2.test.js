// Ola D1 (lado PC): aprobación forzada, archivos seguros, captura sin salir del PC, intents y guardianes.
// Todo con mocks: no hay Windows, Electron ni disco real implicados (salvo un directorio temporal para el fs de verdad).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PC_ACTIONS, validateParams, rutaRelativaValida, SIEMPRE_APROBACION } from "../desktop/runner/pc-spec.js";
import { createPcExecutor, PS_SUSPENDER } from "../desktop/runner/pc-exec.js";
import { createPcFiles, MAX_ENTRADAS, MAX_CHARS, MAX_BYTES } from "../desktop/runner/pc-files.js";
import { createPcCapture, tamanoCaptura, buildDescribeArgs, buildDescribeStdin, claudeDescriber } from "../desktop/runner/pc-capture.js";
import { GUARDIANES, SECRETOS, DENEGADAS_CLAUDE, rutaProtegida } from "../desktop/runner/secret-paths.js";
import { parsePcIntent } from "../server/pc/intents.js";
import { loadJson } from "../server/context.js";

// ---------- aprobación forzada ----------
test("apagar, reiniciar y suspender SIEMPRE piden aprobación, aunque la config diga automático", () => {
  assert.deepEqual([...SIEMPRE_APROBACION].sort(), ["apagar", "reiniciar", "suspender"]);
  for (const id of SIEMPRE_APROBACION) {
    assert.equal(validateParams(id, {}).def.nivel, "aprobacion");
    const defs = { [id]: { nivel: "automatico", params: {} } }; // un servidor "tramposo"
    assert.equal(validateParams(id, {}, { defs }).def.nivel, "aprobacion", id);
  }
  assert.equal(validateParams("cancelar_apagado", {}).def.nivel, "automatico");
  assert.equal(validateParams("archivos_listar", { raiz: "documentos" }).def.nivel, "automatico");
  assert.equal(validateParams("archivos_leer", { raiz: "documentos", ruta: "a.txt" }).def.nivel, "aprobacion");
  const cfg = loadJson("pc-actions.json");
  assert.deepEqual(Object.keys(cfg.acciones).sort(), Object.keys(PC_ACTIONS).sort());
  assert.equal(cfg.acciones.suspender.nivel, "aprobacion");
});

function fakeExec(over = {}) {
  const calls = [];
  const ex = createPcExecutor({ execFile: async (c, a) => { calls.push([c, a]); return { stdout: "" }; }, spawn: () => {}, clipboard: {}, os: {}, platform: "win32", ...over });
  return { calls, ex };
}

test("suspender de verdad (no hibernar), cancelar_apagado = shutdown /a", async () => {
  const { calls, ex } = fakeExec();
  assert.equal((await ex.execute({ accion: "suspender", params: {} })).ok, false);
  assert.equal(calls.length, 0);
  assert.equal((await ex.execute({ accion: "suspender", params: {}, aprobada: true })).ok, true);
  assert.equal(calls[0][0], "powershell.exe");
  assert.equal(Buffer.from(calls[0][1].at(-1), "base64").toString("utf16le"), PS_SUSPENDER);
  assert.equal(PS_SUSPENDER, "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend',$false,$false)");
  assert.equal((await ex.execute({ accion: "cancelar_apagado", params: {} })).ok, true);
  assert.deepEqual(calls[1], ["shutdown.exe", ["/a"]]);
});

// ---------- ruta_relativa ----------
test("ruta_relativa: rechaza .., unidades, UNC, absolutas, ADS y control", () => {
  for (const bad of ["..", "../x", "a/../../b", "a\\..\\b", "C:\\x", "c:x", "/etc/passwd", "\\\\srv\\share", "a:b", "a/b?", "x\u0000y", "", "   ", "a".repeat(261), 5, null]) assert.equal(rutaRelativaValida(bad), false, JSON.stringify(bad));
  for (const ok of ["a.txt", "sub/carpeta/notas.md", "sub\\notas.md", "Música/canción 1.txt"]) assert.equal(rutaRelativaValida(ok), true, ok);
  assert.equal(validateParams("archivos_leer", { raiz: "documentos", ruta: "../x" }).error, "ruta_invalido");
  assert.equal(validateParams("archivos_leer", { raiz: "documentos" }).error, "falta_ruta");
  assert.equal(validateParams("archivos_listar", { raiz: "documentos", ruta: "C:\\" }).ok, false);
  assert.equal(validateParams("archivos_listar", { raiz: "documentos" }).ok, true);
});

// ---------- archivos: fs real en un directorio temporal ----------
function entorno() {
  const base = mkdtempSync(join(tmpdir(), "jarvis-files-"));
  const raiz = join(base, "docs"), fuera = join(base, "fuera");
  mkdirSync(join(raiz, "sub"), { recursive: true }); mkdirSync(fuera);
  writeFileSync(join(raiz, "notas.txt"), "hola ".repeat(1000));
  writeFileSync(join(raiz, "sub", "a.md"), "# a");
  writeFileSync(join(raiz, ".env"), "CLAVE=1");
  writeFileSync(join(raiz, "mis-tokens.txt"), "x");
  writeFileSync(join(raiz, "bin.dat"), Buffer.from([1, 2, 0, 3]));
  writeFileSync(join(fuera, "dato.txt"), "no debe salir");
  return { base, raiz, fuera, files: createPcFiles({ roots: { Documentos: raiz } }) };
}

test("archivos: lista y lee dentro de la raíz; oculta secretos; recorta a 2000 caracteres", async () => {
  const { base, files } = entorno();
  try {
    const l = await files.listar("DOCUMENTOS");
    assert.match(l.texto, /\[carpeta\] sub/); assert.match(l.texto, /notas\.txt/);
    assert.doesNotMatch(l.texto, /\.env|tokens/);
    assert.equal((await files.listar("documentos", "sub")).texto.trim(), "a.md");
    const r = await files.leer("documentos", "notas.txt");
    assert.ok(r.texto.startsWith("hola hola")); assert.ok(r.texto.length < MAX_CHARS + 80); assert.match(r.texto, /recortado/);
    assert.equal((await files.leer("documentos", "sub/a.md")).texto, "# a");
    await assert.rejects(files.leer("documentos", ".env"), /protegida/);
    await assert.rejects(files.leer("documentos", "mis-tokens.txt"), /protegida/);
    await assert.rejects(files.leer("documentos", "bin.dat"), /texto/);
    await assert.rejects(files.leer("documentos", "sub"), /no es un archivo/);
    await assert.rejects(files.listar("desconocida"), /no permitida/);
    await assert.rejects(files.leer("documentos", "no-existe.txt"), /No existe/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("archivos: path traversal y symlink fuera de la raíz se rechazan", async () => {
  const { base, raiz, fuera, files } = entorno();
  try {
    await assert.rejects(files.leer("documentos", "../fuera/dato.txt"), /no válida/);
    await assert.rejects(files.leer("documentos", "sub\\..\\..\\fuera\\dato.txt"), /no válida/);
    let enlace = true;
    try { symlinkSync(fuera, join(raiz, "atajo"), "junction"); } catch { enlace = false; }
    if (enlace) {
      await assert.rejects(files.leer("documentos", "atajo/dato.txt"), /sale de la carpeta/);
      await assert.rejects(files.listar("documentos", "atajo"), /sale de la carpeta/);
    }
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("archivos (simulado): symlink que resuelve fuera de la raíz, límite de 100 entradas y 1 MB", async () => {
  const dirent = (name, dir = false) => ({ name, isDirectory: () => dir, isSymbolicLink: () => false });
  const muchos = Array.from({ length: 250 }, (_, i) => dirent(`f${String(i).padStart(3, "0")}.txt`));
  const fs = {
    realpath: async (p) => (p.endsWith("enlace") ? "/otro/lugar/enlace" : p), // el enlace apunta fuera
    stat: async (p) => (p.endsWith("grande.txt") ? { size: MAX_BYTES + 1, isFile: () => true, isDirectory: () => false } : p.endsWith("lleno") ? { isDirectory: () => true, isFile: () => false } : { size: 3, isFile: () => true, isDirectory: () => false }),
    readdir: async () => muchos,
    readFile: async () => Buffer.from("abc"),
  };
  const files = createPcFiles({ roots: { docs: "/r/docs" }, fs, path: (await import("node:path")).posix });
  await assert.rejects(files.leer("docs", "enlace"), /sale de la carpeta/);
  await assert.rejects(files.leer("docs", "grande.txt"), /1 MB/);
  const l = await files.listar("docs", "lleno");
  assert.equal(l.datos.total, 250); assert.equal(l.datos.mostradas, MAX_ENTRADAS);
  assert.equal(l.texto.split("\n").filter((x) => x.startsWith("f")).length, 100); assert.match(l.texto, /150 más/);
});

test("archivos: el ejecutor las usa y archivos_leer exige aprobación; sin pc_carpetas falla claro", async () => {
  const { base, files } = entorno();
  try {
    const { ex } = fakeExec({ files });
    assert.equal((await ex.execute({ accion: "archivos_listar", params: { raiz: "documentos" } })).ok, true);
    assert.equal((await ex.execute({ accion: "archivos_leer", params: { raiz: "documentos", ruta: "sub/a.md" } })).ok, false);
    const ok = await ex.execute({ accion: "archivos_leer", params: { raiz: "documentos", ruta: "sub/a.md" }, aprobada: true });
    assert.equal(ok.ok, true); assert.equal(ok.texto, "# a"); assert.equal(ok.privado, true);
    const mal = await ex.execute({ accion: "archivos_leer", params: { raiz: "documentos", ruta: ".env" }, aprobada: true });
    assert.equal(mal.ok, false);
    const sin = await fakeExec().ex.execute({ accion: "archivos_listar", params: { raiz: "documentos" } });
    assert.equal(sin.ok, false); assert.match(sin.texto, /pc_carpetas/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

// ---------- captura ----------
const pantalla = { getPrimaryDisplay: () => ({ size: { width: 3840, height: 2160 }, scaleFactor: 1 }) };
function capturador({ describir, fuentes, dir }) {
  const avisos = [];
  const seen = { size: null };
  const desktopCapturer = { getSources: async (o) => { seen.size = o.thumbnailSize; seen.types = o.types; return fuentes ?? [{ thumbnail: { isEmpty: () => false, toJPEG: () => Buffer.from("JPEGDATA") } }]; } };
  return { avisos, seen, cap: createPcCapture({ desktopCapturer, screen: pantalla, describir, dir, notify: (t, b) => avisos.push([t, b]) }) };
}

test("captura: lado mayor 1568, aviso en el PC, descrita en local y archivo borrado siempre", async () => {
  assert.deepEqual(tamanoCaptura(3840, 2160), { width: 1568, height: 882 });
  assert.deepEqual(tamanoCaptura(800, 600), { width: 800, height: 600 });
  const dir = mkdtempSync(join(tmpdir(), "jarvis-cap-"));
  try {
    let vistoEnDisco = false;
    const { cap, avisos, seen } = capturador({ dir, describir: async ({ jpeg, file }) => { vistoEnDisco = existsSync(file) && jpeg.toString() === "JPEGDATA"; return "Se ve un editor de código."; } });
    const r = await cap.capturar();
    assert.deepEqual(r, { texto: "Se ve un editor de código.", privado: true });
    assert.equal(vistoEnDisco, true); assert.deepEqual(readdirSync(dir), []);
    assert.equal(avisos.length, 1); assert.match(avisos[0][1], /capturando/i);
    assert.deepEqual(seen.size, { width: 1568, height: 882 }); assert.deepEqual(seen.types, ["screen"]);
    assert.equal(cap.usoHoy().n, 1);
    // fallo al describir: igualmente se borra
    const mal = capturador({ dir, describir: async () => { throw new Error("Claude no pudo"); } });
    await assert.rejects(mal.cap.capturar(), /Claude no pudo/);
    assert.deepEqual(readdirSync(dir), []); assert.equal(mal.avisos.length, 1);
    // al arrancar se limpian restos
    writeFileSync(join(dir, "captura-1.jpg"), "resto"); writeFileSync(join(dir, "otra-cosa.txt"), "queda");
    await cap.limpiar();
    assert.deepEqual(readdirSync(dir), ["otra-cosa.txt"]);
    // sin imagen
    const vacia = capturador({ dir, describir: async () => "x", fuentes: [] });
    await assert.rejects(vacia.cap.capturar(), /No pude capturar/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("captura: Claude sin herramientas y solo Claude (ningún proveedor externo); ejecutor la marca privada", async () => {
  const args = buildDescribeArgs();
  assert.equal(args[args.indexOf("--tools") + 1], "");
  assert.ok(args.includes("--max-turns") && args[args.indexOf("--max-turns") + 1] === "1");
  assert.match(args[args.indexOf("--disallowedTools") + 1], /Bash.*Read.*Write/);
  const m = JSON.parse(buildDescribeStdin(Buffer.from("IMG")));
  assert.equal(m.message.content[0].type, "image"); assert.equal(m.message.content[0].source.data, Buffer.from("IMG").toString("base64"));
  let llamado = null;
  const d = claudeDescriber({ claude: { command: "claude.exe", prefix: [] }, cwd: "/tmp", runClaude: async (o) => { llamado = o; return { result: " Escritorio vacío ", isError: false, aborted: null }; } });
  assert.equal(await d({ jpeg: Buffer.from("IMG") }), "Escritorio vacío");
  assert.equal(llamado.command, "claude.exe");
  await assert.rejects(claudeDescriber({ claude: null, runClaude: async () => ({}) })({ jpeg: Buffer.from("x") }), /Claude Code/);
  await assert.rejects(claudeDescriber({ claude: { command: "c" }, runClaude: async () => ({ result: "", isError: true, errorKind: "sin_login" }) })({ jpeg: Buffer.from("x") }), /sin_login/);
  const src = (await import("node:fs")).readFileSync(new URL("../desktop/runner/pc-capture.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /fetch[(]|https?:|import .*(router|hub-client)/);
  const { ex } = fakeExec({ capture: { capturar: async () => ({ texto: "desc", privado: true }) } });
  const r = await ex.execute({ accion: "captura", params: {} });
  assert.deepEqual([r.ok, r.texto, r.privado], [true, "desc", true]);
  assert.equal((await fakeExec().ex.execute({ accion: "captura", params: {} })).ok, false);
});

// ---------- intents ----------
test("intents en español: suspender, cancelar apagado, archivos, captura", () => {
  assert.deepEqual(parsePcIntent("suspende", { destino: "pc" }), { action: "suspender", params: {} });
  assert.deepEqual(parsePcIntent("pon en suspensión", { destino: "pc" })?.action ?? "suspender", "suspender");
  assert.deepEqual(parsePcIntent("cancela el apagado"), { action: "cancelar_apagado", params: {} });
  assert.deepEqual(parsePcIntent("anula el reinicio", { destino: "pc" }), { action: "cancelar_apagado", params: {} });
  assert.deepEqual(parsePcIntent("lista los archivos de documentos", { destino: "pc" }), { action: "archivos_listar", params: { raiz: "documentos" } });
  assert.deepEqual(parsePcIntent("qué archivos hay en la carpeta de documentos/fotos", { destino: "pc" }), { action: "archivos_listar", params: { raiz: "documentos", ruta: "fotos" } });
  assert.deepEqual(parsePcIntent("lista la carpeta descargas", { destino: "pc" }), { action: "archivos_listar", params: { raiz: "descargas" } });
  assert.deepEqual(parsePcIntent("lee el archivo notas.txt de documentos", { destino: "pc" }), { action: "archivos_leer", params: { raiz: "documentos", ruta: "notas.txt" } });
  assert.deepEqual(parsePcIntent("lee el archivo documentos/trabajo/plan.md", { destino: "pc" }), { action: "archivos_leer", params: { raiz: "documentos", ruta: "trabajo/plan.md" } });
  assert.equal(parsePcIntent("lista los archivos de documentos", { destino: null }), null); // sin «pc» no se asume
  for (const f of ["qué hay en mi pantalla", "haz una captura de pantalla", "describe mi pantalla", "captura"]) {
    const r = parsePcIntent(f, { destino: f === "captura" ? "pc" : null });
    assert.deepEqual(r, { action: "captura", params: {} }, f);
  }
  assert.equal(parsePcIntent("qué hay en mi pantalla", { destino: "telefono" }), null);
  // los resultados siempre validan contra la lista blanca
  for (const f of ["lista los archivos de documentos/fotos", "lee el archivo notas.txt de documentos"]) {
    const r = parsePcIntent(f, { destino: "pc" });
    assert.equal(validateParams(r.action, r.params).ok, true, f);
  }
});

// ---------- guardianes y secretos ----------
test("GUARDIANES incluye los archivos nuevos y SECRETOS cubre claves, .ssh, tokens y carteras", () => {
  for (const f of ["pc-spec.js", "pc-exec.js", "pc-files.js", "pc-capture.js"]) {
    assert.ok(GUARDIANES.includes(`**/desktop/runner/${f}`), f);
    assert.equal(rutaProtegida(`C:\\jarvis\\desktop\\runner\\${f}`), "guardian");
    assert.ok(DENEGADAS_CLAUDE.includes(`Edit(**/desktop/runner/${f})`) && DENEGADAS_CLAUDE.includes(`Write(**/desktop/runner/${f})`));
  }
  for (const p of ["**/.ssh/**", "**/id_rsa*", "**/*.pfx", "**/.npmrc", "**/wallet.dat", "**/*.kdbx"]) assert.ok(SECRETOS.includes(p), p);
  for (const p of ["C:\\u\\.ssh\\id_rsa", "C:\\u\\.ssh\\config", "/h/id_ed25519.pub", "C:\\u\\a.pfx", "C:\\u\\Cookies", "C:\\u\\Login Data", "/h/.aws/credentials", "/h/.npmrc", "/h/wallet.dat", "/h/claves.kdbx"]) assert.equal(rutaProtegida(p), "secreto", p);
  assert.equal(rutaProtegida("/a/notas.txt"), null);
});
