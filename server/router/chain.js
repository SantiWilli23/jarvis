// Enrutador con cadena de respaldo. Prueba proveedores en orden; salta al siguiente si
// no hay cuota, si dio 429 o si falla. Si ninguno responde devuelve { status: "sin_cuota" }.
// Lo privado pasa siempre por privacy (lista blanca) y jamás se degrada a otro proveedor.
import { ProviderError } from "../providers/base.js";

export function createRouter({ providers, chain, orderByKind = {}, quota, privacy, onUse = () => {} }) {
  // prefer: proveedor que va primero si se pide (p. ej. "/gemini"); lo privado sigue pasando por privacy.filter.
  function candidates(kind, isPrivate, prefer = null) {
    const pref = orderByKind[kind] || [];
    const ids = [...new Set([...(prefer ? [prefer] : []), ...pref, ...chain])].filter((id) => providers[id]);
    return privacy.filter(ids, isPrivate);
  }

  async function route({ userId, kind = "charla", messages, system, isPrivate = false, images, prefer = null }) {
    const tried = [];
    for (const id of candidates(kind, isPrivate, prefer)) {
      const p = providers[id];
      if (!p.enabled) { tried.push({ id, skip: "apagado" }); continue; }
      const q = await quota.check(userId, id);
      if (!q.ok) { tried.push({ id, skip: q.reason, until: q.until }); continue; }
      privacy.assert(id, isPrivate); // barrera final
      try {
        onUse(id, { userId });
        const r = await p.chat({ messages, system, images });
        await quota.record(userId, id, r.tokens || 0);
        await quota.ingestHeaders(userId, id, r.headers);
        return { ok: true, provider: id, text: r.text, tokens: r.tokens || 0, tried };
      } catch (e) {
        const status = e instanceof ProviderError ? e.status : 0;
        const until = await quota.pauseOnError(userId, id, { status, headers: e.headers || {}, message: e.message });
        tried.push({ id, error: status || "red", until });
      }
    }
    return { ok: false, status: "sin_cuota", tried };
  }

  return { route, candidates };
}
