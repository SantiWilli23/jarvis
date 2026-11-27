// Worker: detecta "Hey Jarvis" dentro del teléfono. El audio no sale de aquí.
// Wasm y modelos se guardan en una caché propia que sobrevive a las versiones de la app.
import { createDetector, modelosDe } from "./detector.js";

const CACHE = "jarvis-wake-v1";
let detector = null, puntaje = 0, depurar = false;

async function bajar(url, headers, usadas) {
  usadas.add(new URL(url, location.origin).href);
  let cache = null;
  try { cache = await caches.open(CACHE); const c = await cache.match(url); if (c) return await c.arrayBuffer(); } catch { /* sin Cache API */ }
  const r = await fetch(url, { headers, cache: "no-store" });
  if (!r.ok) throw new Error(`no pude bajar ${url.split("?")[0]} (HTTP ${r.status})`);
  try { await cache?.put(url, r.clone()); } catch { /* sin espacio: se baja otra vez luego */ }
  return r.arrayBuffer();
}

async function cargar({ info, token }) {
  const usadas = new Set(), v = encodeURIComponent(info.ort);
  const ort = await import(`/vendor/ort/ort.mjs?v=${v}`);
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmBinary = await bajar(`/vendor/ort/ort.wasm?v=${v}`, {}, usadas);
  const auth = { authorization: `Bearer ${token}`, "x-requested-with": "jarvis" };
  const buffers = [];
  for (const [nombre, sha] of Object.entries(info.modelos)) buffers.push(await bajar(`/api/wake/modelos/${nombre}?h=${sha}`, auth, usadas));
  const m = await modelosDe(ort, buffers.map((b) => new Uint8Array(b)));
  detector = createDetector({ ...m, clasificar: async (e) => (puntaje = await m.clasificar(e)) });
  try { const c = await caches.open(CACHE); for (const k of await c.keys()) if (!usadas.has(k.url)) await c.delete(k); } catch { /* da igual */ }
}

self.onmessage = async ({ data }) => {
  try {
    if (data.tipo === "cargar") { depurar = !!data.depurar; await cargar(data); self.postMessage({ tipo: "listo" }); }
    else if (data.tipo === "reiniciar") detector?.reiniciar();
    else if (data.tipo === "audio" && detector) {
      const oido = await detector.procesar(data.bloque);
      if (depurar) self.postMessage({ tipo: "puntaje", puntaje });
      if (oido) self.postMessage({ tipo: "oido", gen: data.gen });
    }
  } catch (e) {
    self.postMessage({ tipo: "error", msg: String(e?.message || e).slice(0, 200) });
  }
};
