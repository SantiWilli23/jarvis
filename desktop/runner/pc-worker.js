// Bucle propio de la cola de acciones del PC: sondea /api/agent/pc/next cada 2-3 s (aparte de la cola de Claude),
// ejecuta con pc-exec.js y devuelve el resultado. Una acción a la vez.
export function createPcWorker({ hub, executor, log = () => {}, pollMs = 2500, setT = setTimeout, clearT = clearTimeout }) {
  let timer = null, running = false, busy = false, fails = 0;

  async function tick() {
    if (busy) return { busy: true };
    busy = true;
    try {
      const { accion } = await hub.pcNext();
      fails = 0;
      if (!accion) return { idle: true };
      log(`acción PC #${accion.id}: ${accion.accion}`);
      const out = await executor.execute(accion);
      for (let i = 0; i < 2; i++) { try { await hub.pcResult(accion.id, out); break; } catch (e) { if (i) log(`no pude informar #${accion.id}: ${e.message}`); } }
      return { done: accion.id, ok: out.ok };
    } catch (e) {
      fails++;
      if (fails === 1 || fails % 20 === 0) log(`cola PC: ${e.message}`);
      return { error: e.message };
    } finally { busy = false; }
  }
  const loop = async () => { if (!running) return; await tick(); if (running) timer = setT(loop, Math.min(30_000, pollMs * (1 + Math.min(fails, 10)))); };
  return {
    tick,
    start() { if (running) return; running = true; timer = setT(loop, 500); },
    stop() { running = false; if (timer) clearT(timer); executor.stop?.(); },
  };
}
