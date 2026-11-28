// Estado del freno en el PC (docs/CONTROL.md). En memoria: los workers lo consultan antes de cada acción.
// El freno puesto en el PC (bandeja o atajo) funciona sin red y no se quita hasta que el servidor lo haya
// confirmado y después diga que ya no hay freno (reanudar solo se hace desde la web).
export const SIN_SERVIDOR_MS = 30_000; // sin consultar el servidor este tiempo, se apagan amplio y ratón

export function createControlState({ now = () => Date.now(), sinServidorMs = SIN_SERVIDOR_MS } = {}) {
  let activo = false, porAvisar = false, amplio = false, raton = false, caido = false, ultimo = 0, lista = [];
  const oyentes = new Set();
  const avisar = (cb) => { try { cb(); } catch (e) { console.error("[freno]", e?.message); } }; // uno que falla no calla a los demás
  function frenar({ local = false } = {}) {
    if (local) porAvisar = true;
    amplio = raton = false; lista = [];
    if (activo) return;
    activo = true;
    for (const cb of oyentes) avisar(cb);
  }
  // Se comprueba al leer: pasado el plazo queda apagado hasta que el servidor también lo apague.
  function vigilar() {
    if ((amplio || raton) && now() - ultimo > sinServidorMs) { amplio = raton = false; lista = []; caido = true; }
  }
  return {
    frenado: () => activo,
    onFreno(cb) {
      oyentes.add(cb);
      if (activo) avisar(cb);
      return () => oyentes.delete(cb);
    },
    frenar,
    reanudar() { activo = false; porAvisar = false; },
    amplio: () => (vigilar(), amplio),
    raton: () => (vigilar(), raton),
    lista: () => (vigilar(), lista.map((e) => ({ ...e }))), // lista autorizada de ratón y teclado
    porAvisar: () => porAvisar, // freno local que el servidor aún no conoce
    porApagar: () => caido,     // permisos apagados aquí que el servidor aún da por encendidos
    // control = { freno, amplio, raton, lista? } tal como lo mandan next y heartbeat.
    servidor(control) {
      if (!control || typeof control.freno !== "boolean") return;
      vigilar();
      ultimo = now();
      if (control.freno) { porAvisar = false; frenar(); }
      else if (!porAvisar) activo = false;
      if (!control.amplio && !control.raton) caido = false;
      amplio = !activo && !caido && !!control.amplio;
      raton = !activo && !caido && !!control.raton;
      lista = raton && Array.isArray(control.lista) ? control.lista.slice(0, 20) : [];
    },
  };
}

export const controlState = createControlState();
export const { frenado, onFreno, frenar, reanudar } = controlState;
