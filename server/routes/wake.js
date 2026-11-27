// Archivos de la escucha de /m: onnxruntime-web (público, mismo origen) y modelos de openWakeWord (solo con sesión).
// Los modelos son CC BY-NC-SA (uso personal): nunca van al repo; si faltan se bajan una vez y se verifica su sha256.
import { Router } from "express";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MODELOS, url as urlOficial } from "../../desktop/wake/modelos.js";

const raiz = fileURLToPath(new URL("../..", import.meta.url));
export const DETECTOR = join(raiz, "desktop", "wake", "detector.js");
// La variante wasm más pequeña (CPU, un hilo); el .mjs "bundle" ya trae su pegamento dentro.
const ORT = { "ort.mjs": ["ort.wasm.bundle.min.mjs", "text/javascript"], "ort.wasm": ["ort-wasm-simd-threaded.wasm", "application/wasm"] };

export function createWake({ env = process.env, fetch: f = globalThis.fetch, modelos = MODELOS, tmp = join(tmpdir(), "jarvis-wake") } = {}) {
  const local = env.WAKE_MODELS_DIR || (env.APPDATA ? join(env.APPDATA, "jarvis-desktop", "wake") : null);
  const paquetes = env.ORT_DIR ? [env.ORT_DIR] : [join(raiz, "node_modules", "onnxruntime-web"), join(raiz, "desktop", "node_modules", "onnxruntime-web")];
  const listos = new Map(), enCurso = new Map();

  function ort() {
    const dir = paquetes.find((d) => existsSync(join(d, "dist", ORT["ort.wasm"][0])));
    if (!dir) return null;
    return { dir: join(dir, "dist"), version: JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version };
  }

  const correcto = (datos, nombre) => createHash("sha256").update(datos).digest("hex") === modelos[nombre];

  async function buscar(nombre) {
    for (const dir of [local, tmp].filter(Boolean)) {
      const ruta = join(dir, nombre);
      try { if (correcto(await readFile(ruta), nombre)) return ruta; } catch { /* no está */ }
    }
    const res = await f(urlOficial(nombre), { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`descarga de ${nombre}: HTTP ${res.status}`);
    const datos = Buffer.from(await res.arrayBuffer());
    if (!correcto(datos, nombre)) throw new Error(`sha256 distinto en ${nombre}`);
    await mkdir(tmp, { recursive: true });
    const ruta = join(tmp, nombre);
    await writeFile(`${ruta}.parte`, datos);
    await rename(`${ruta}.parte`, ruta);
    return ruta;
  }

  // Ruta verificada del modelo, o null si no se puede servir.
  async function modelo(nombre) {
    if (!Object.hasOwn(modelos, nombre)) return null;
    if (listos.has(nombre) && existsSync(listos.get(nombre))) return listos.get(nombre);
    if (!enCurso.has(nombre)) {
      enCurso.set(nombre, buscar(nombre)
        .then((r) => { listos.set(nombre, r); return r; })
        .catch((e) => { console.error("[wake]", e?.message); return null; })
        .finally(() => enCurso.delete(nombre)));
    }
    return enCurso.get(nombre);
  }

  const enviar = (res, next, ruta, headers) =>
    res.sendFile(ruta, { dotfiles: "allow", cacheControl: false, headers }, (e) => { if (e && !res.headersSent) next(e); });

  // Rutas públicas: /vendor/ort/ort.mjs y ort.wasm (la versión va en ?v=).
  function vendor(req, res, next) {
    const pedido = Object.hasOwn(ORT, req.params.archivo) ? ORT[req.params.archivo] : null;
    const o = pedido && ort();
    if (!o) return res.status(404).end();
    enviar(res, next, join(o.dir, pedido[0]), { "Content-Type": pedido[1] });
  }

  function routes() {
    const r = Router();
    r.get("/estado", async (_req, res, next) => {
      try {
        const faltan = [];
        for (const n of Object.keys(modelos)) if (!(await modelo(n))) faltan.push(n);
        res.json({ ort: ort()?.version ?? null, modelos, faltan });
      } catch (e) { next(e); }
    });
    r.get("/modelos/:nombre", async (req, res, next) => {
      try {
        const ruta = await modelo(req.params.nombre);
        if (!ruta) return res.status(404).json({ error: "modelo_no_disponible" });
        enviar(res, next, ruta, { "Content-Type": "application/octet-stream", "Cache-Control": "private, no-store" });
      } catch (e) { next(e); }
    });
    return r;
  }

  return { routes, vendor, modelo, ort };
}
