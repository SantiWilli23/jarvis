// Estado del freno en el PC (docs/CONTROL.md). En memoria: los workers lo consultan antes de cada acción.
export function createControlState() {
  let activo = false;
  const oyentes = new Set();
  const avisar = (cb) => { try { cb(); } catch (e) { console.error("[freno]", e?.message); } }; // uno que falla no calla a los demás
  return {
    frenado: () => activo,
    onFreno(cb) {
      oyentes.add(cb);
      if (activo) avisar(cb);
      return () => oyentes.delete(cb);
    },
    frenar() {
      if (activo) return;
      activo = true;
      for (const cb of oyentes) avisar(cb);
    },
  };
}

export const { frenado, onFreno, frenar } = createControlState();
