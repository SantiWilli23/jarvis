// Buzón persistente en disco: si Render está dormido o sin red, el informe/fallo de un job se guarda y se
// reenvía después. Idempotente: una sola entrada por clave (p. ej. "report-12"), y el servidor responde 409/404
// si ya lo tenía, lo cual se da por entregado.
import { mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";

// Errores que merece la pena reintentar (red, servidor dormido/caído, límite, no autorizado por reinicio).
export const isRetryable = (e) => !e?.status || e.status >= 500 || e.status === 429 || e.status === 401 || e.status === 403;

export function createOutbox(dir, { log = () => {} } = {}) {
  mkdirSync(dir, { recursive: true });
  const file = (key) => join(dir, `${String(key).replace(/[^\w.-]/g, "_")}.json`);
  return {
    // Guarda de forma atómica (tmp + rename); misma clave = reemplaza.
    put(key, entry) {
      const f = file(key);
      writeFileSync(`${f}.tmp`, JSON.stringify({ key, at: Date.now(), ...entry }));
      renameSync(`${f}.tmp`, f);
    },
    list() {
      const out = [];
      for (const n of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
        try { out.push(JSON.parse(readFileSync(join(dir, n), "utf8"))); } catch { rmSync(join(dir, n), { force: true }); }
      }
      return out.sort((a, b) => a.at - b.at);
    },
    remove(key) { rmSync(file(key), { force: true }); },
    // send(entry) debe lanzar si falla. Devuelve cuántas se entregaron. Se detiene en el primer error reintentable.
    async flush(send) {
      let n = 0;
      for (const e of this.list()) {
        try { await send(e); this.remove(e.key); n++; }
        catch (err) {
          if (err?.status === 409 || err?.status === 404 || err?.status === 410) { this.remove(e.key); n++; continue; } // ya estaba
          if (isRetryable(err)) { log(`Buzón: sin entregar ${e.key} (${err.message})`); break; }
          log(`Buzón: descartado ${e.key} (${err.message})`); this.remove(e.key);
        }
      }
      return n;
    },
  };
}
