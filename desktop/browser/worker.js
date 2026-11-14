// Sondeo propio (cada 3 s) del PC hacia /api/agent/browser/claim. El servidor decide si hay tarea; este
// módulo solo ejecuta el modo asistido sobre la ventana. No es Electron-dependiente: se prueba con falsos.
import { runAssist } from "./assist.js";

export function createBrowserWorker({ hub, win, selectors, log = () => {}, sondeoMs = 3000, sleep, now, pollMs }) {
  let timer = null, ocupado = false, parada = false, leerYa = false, siguiente = 0;
  const tabla = selectors.sitios;

  async function uno() {
    if (ocupado) return;
    ocupado = true; parada = false; leerYa = false;
    try {
      const c = await hub.browserClaim();
      if (!c?.task) { if (c?.reason === "inactivo") siguiente = Date.now() + 30_000; return; }
      const task = c.task;
      const s = tabla[task.site];
      // La URL y la partición salen de la tabla local, nunca del servidor.
      if (!s) { await hub.browserStep(task.id, { estado: "error" }).catch(() => {}); return; }
      log(`tarea #${task.id} en ${task.site}`);
      try {
        await win.cargar(task.site);
        const out = await runAssist({
          task, selectors: s, page: win.page(task.site), hub: { step: hub.browserStep }, limites: c.limites, log,
          degrade: async (t) => win.degradar(t.site, t.prompt),
          shouldStop: () => parada, readNow: () => leerYa, onPromptReady: () => { win.alFrente(); win.estado("Prompt listo: revíselo y pulse Enviar usted."); },
          ...(sleep ? { sleep } : {}), ...(now ? { now } : {}), ...(pollMs ? { pollMs } : {}),
        });
        log(`tarea #${task.id}: ${out.fin}`);
      } catch (e) {
        log(`tarea #${task.id} falló: ${e?.message}`);
        await hub.browserStep(task.id, { estado: "error" }).catch(() => {});
      }
    } catch (e) { log(`sondeo: ${e?.message}`); } finally { ocupado = false; }
  }

  return {
    uno,
    start() { if (!timer) timer = setInterval(() => { if (Date.now() >= siguiente) uno(); }, sondeoMs); timer.unref?.(); },
    stop() { clearInterval(timer); timer = null; },
    detener() { parada = true; },
    leerAhora() { leerYa = true; },
  };
}
