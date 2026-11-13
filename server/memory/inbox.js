// Zona de revisión: lo que proponen escribir los modelos gratis NO entra a la memoria
// hasta que el señor lo aprueba.
export function createInbox({ notes }) {
  return {
    async propose({ userId, title = "", body, level = "normal" }) {
      return notes.add({ userId, title, body, level, source: "modelo" });
    },
    list(userId) { return notes.list(userId, { status: "revision" }); },
    approve(userId, id) { return notes.setStatus(userId, id, "activa"); },
    reject(userId, id) { return notes.remove(userId, id); },
  };
}
