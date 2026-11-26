// Zona de revisión: lo que proponen escribir los modelos gratis NO entra a la memoria
// hasta que el señor lo aprueba.
export const MAX_TEXTO = 2000;
export const MAX_TITULO = 200;
export const MAX_PENDIENTES = 200;

export function createInbox({ notes }) {
  return {
    async propose({ userId, title = "", body, level = "normal", origen = "" }) {
      const t = String(title ?? ""), b = String(body ?? "");
      // Lo secreto ni se mira: notes.add responde sin tocar la base de datos.
      if (!String(level).toLowerCase().startsWith("secret")) {
        if (b.length > MAX_TEXTO || t.length > MAX_TITULO) return { saved: false, reason: "muy_larga" };
        if ((await notes.counts(userId)).revision >= MAX_PENDIENTES) return { saved: false, reason: "bandeja_llena" };
      }
      return notes.add({ userId, title: t, body: b, level, source: "modelo", origen: String(origen ?? "").slice(0, 40) });
    },
    list(userId) { return notes.list(userId, { status: "revision" }); },
    approve(userId, id) { return notes.setStatus(userId, id, "activa"); },
    reject(userId, id) { return notes.remove(userId, id); },
  };
}
