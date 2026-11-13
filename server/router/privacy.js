// ÚNICO punto de control de privacidad. Lista blanca: lo privado solo puede ir a los
// proveedores permitidos (por defecto claude y groq). Nada más decide esto en el código.
//
// `localSafe` son proveedores que no sacan datos de la máquina (solo el "fake" de pruebas);
// el servidor los añade únicamente cuando corre sin claves.
export function createPrivacy({ allowed = ["claude", "groq"], localSafe = [] } = {}) {
  const white = new Set([...allowed, ...localSafe]);
  return {
    allowed: [...white],
    isAllowed(providerId, isPrivate) {
      return !isPrivate || white.has(providerId);
    },
    filter(ids, isPrivate) {
      return ids.filter((id) => this.isAllowed(id, isPrivate));
    },
    // Barrera final antes de cada llamada. Lanza si algo intenta saltarse el filtro.
    assert(providerId, isPrivate) {
      if (!this.isAllowed(providerId, isPrivate)) {
        throw new Error(`Privacidad: ${providerId} no puede recibir mensajes privados`);
      }
    },
    // Privado si el usuario lo marca, el clasificador lo detecta o entre las notas
    // usadas como contexto hay alguna privada.
    isPrivateMessage({ flag = false, classification = null, notes = [] } = {}) {
      return !!flag || !!classification?.private || notes.some((n) => n.level === "privada");
    },
  };
}
