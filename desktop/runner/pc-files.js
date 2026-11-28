// Archivos del PC (Ola D1): listar y leer SOLO dentro de las carpetas que el señor dio por nombre en el config.json del
// escritorio (`pc_carpetas`: { "documentos": "C:\\Users\\...\\Documents" }). El servidor solo manda NOMBRE de raíz + ruta
// relativa; aquí se resuelve con realpath (anti "..\\" y anti enlaces simbólicos/uniones) y se comprueba que sigue dentro
// de la raíz. Los secretos (secret-paths.js + nombres sospechosos) se rechazan siempre. Módulo sin Electron: fs inyectable.
import nodeFs from "node:fs/promises";
import nodePath from "node:path";
import { rutaProtegida } from "./secret-paths.js";
import { rutaRelativaValida, norm } from "./pc-spec.js";

export const MAX_ENTRADAS = 100;
export const MAX_BYTES = 1024 * 1024; // 1 MB
export const MAX_CHARS = 2000;
// Nombres que huelen a secreto aunque no tengan extensión conocida (más estricto que rutaProtegida, solo para estas acciones).
const SENSIBLE = /(token|secret|secreto|passw|contrase|credential|cookie|wallet|cartera|private|privad|apikey|api_key|\.kdbx$)/i;

export function sanitizeRoots(raw) {
  const out = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw)) if (typeof v === "string" && v.trim() && String(k).trim()) out[norm(k)] = v;
  }
  return out;
}

export function createPcFiles({ roots, fs = nodeFs, path = nodePath } = {}) {
  const map = sanitizeRoots(roots);
  const fail = (m) => { throw new Error(m); };
  const bloqueado = (p) => !!rutaProtegida(p) || String(p).split(/[\\/]/).some((seg) => SENSIBLE.test(seg));
  const dentro = (raiz, real) => {
    const rel = path.relative(raiz, real);
    return rel === "" || (!path.isAbsolute(rel) && rel.split(/[\\/]/)[0] !== "..");
  };

  async function resolver(raiz, ruta) {
    const nombre = norm(raiz || "");
    if (!Object.hasOwn(map, nombre)) fail(`Carpeta «${nombre}» no permitida en este PC.`);
    const rel = ruta === undefined || ruta === null || ruta === "" ? "" : ruta;
    if (rel !== "" && !rutaRelativaValida(rel)) fail("Ruta no válida.");
    if (rel !== "" && bloqueado(rel)) fail("Ruta protegida (secretos): no la toco.");
    let raizReal;
    try { raizReal = await fs.realpath(map[nombre]); } catch { fail("La carpeta permitida no existe en este PC."); }
    let real;
    try { real = await fs.realpath(path.resolve(raizReal, rel)); } catch { fail("No existe esa ruta."); }
    if (!dentro(raizReal, real)) fail("Esa ruta sale de la carpeta permitida.");
    if (rel !== "" && bloqueado(path.relative(raizReal, real))) fail("Ruta protegida (secretos): no la toco.");
    return { real, raizReal };
  }

  // Algo que ya existe y se puede mover o tirar: nunca la raíz ni un enlace (resolver seguiría hasta su destino).
  async function existente(raiz, ruta) {
    if (!ruta) fail("Falta la ruta.");
    const { real, raizReal } = await resolver(raiz, ruta);
    if (path.relative(raizReal, real) === "") fail("La carpeta permitida entera no se toca.");
    if ((await fs.lstat(path.resolve(raizReal, ruta))).isSymbolicLink()) fail("Es un enlace; no lo toco.");
    return { real, raizReal };
  }
  // Algo que todavía no existe: su carpeta sí existe y está dentro de la raíz.
  async function nuevo(raiz, ruta) {
    if (!ruta || !rutaRelativaValida(ruta)) fail("Ruta no válida.");
    if (bloqueado(ruta)) fail("Ruta protegida (secretos): no la toco.");
    const partes = String(ruta).trim().split(/[\\/]/).filter(Boolean);
    if (!partes.length || partes.some((p) => /[. ]$/.test(p))) fail("Ruta no válida.");
    const nombre = partes.pop();
    const { real } = await resolver(raiz, partes.join("/"));
    if (!(await fs.stat(real)).isDirectory()) fail("La carpeta de destino no existe.");
    const destino = path.join(real, nombre);
    try { await fs.lstat(destino); } catch (e) { if (e?.code === "ENOENT") return destino; fail("No pude comprobar el destino."); }
    return fail("Ya existe algo con ese nombre; no lo piso.");
  }

  return {
    nombres: () => Object.keys(map),
    // revisar() se llama justo antes de cambiar nada (freno o permiso apagado).
    async mover(raiz, de, a, revisar = () => {}) {
      const { real } = await existente(raiz, de);
      const destino = await nuevo(raiz, a);
      revisar();
      await fs.rename(real, destino);
      return { texto: `Movido a ${a}.` };
    },
    async crearCarpeta(raiz, ruta, revisar = () => {}) {
      const destino = await nuevo(raiz, ruta);
      revisar();
      await fs.mkdir(destino);
      return { texto: `Carpeta ${ruta} creada.` };
    },
    async paraPapelera(raiz, ruta) { return (await existente(raiz, ruta)).real; },
    async listar(raiz, ruta) {
      const { real } = await resolver(raiz, ruta);
      const st = await fs.stat(real);
      if (!st.isDirectory()) fail("Eso no es una carpeta.");
      const ents = (await fs.readdir(real, { withFileTypes: true })).filter((e) => !bloqueado(e.name));
      ents.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || String(a.name).localeCompare(String(b.name)));
      const shown = ents.slice(0, MAX_ENTRADAS);
      const marca = (e) => (e.isSymbolicLink?.() ? "[enlace] " : e.isDirectory() ? "[carpeta] " : "");
      const lineas = shown.map((e) => `${marca(e)}${e.name}`);
      const extra = ents.length > shown.length ? `\n… y ${ents.length - shown.length} más (se muestran ${MAX_ENTRADAS}).` : "";
      return { texto: (lineas.length ? lineas.join("\n") : "(carpeta vacía)") + extra, datos: { total: ents.length, mostradas: shown.length } };
    },
    async leer(raiz, ruta) {
      if (ruta === undefined || ruta === null || ruta === "") fail("Falta la ruta del archivo.");
      const { real } = await resolver(raiz, ruta);
      const st = await fs.stat(real);
      if (!st.isFile()) fail("Eso no es un archivo.");
      if (st.size > MAX_BYTES) fail("El archivo pasa de 1 MB; no lo leo.");
      const buf = await fs.readFile(real);
      if (buf.subarray(0, 8000).includes(0)) fail("No es un archivo de texto.");
      const todo = buf.toString("utf8");
      const texto = todo.slice(0, MAX_CHARS);
      return { texto: texto + (todo.length > MAX_CHARS ? `\n… (recortado a ${MAX_CHARS} de ${todo.length} caracteres)` : ""), datos: { caracteres: todo.length } };
    },
  };
}
