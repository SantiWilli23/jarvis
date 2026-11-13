// Estado compartido del orbe y suscripciones simples.
// Estados del servidor: idle | listening | thinking | speaking | permiso | sin_cuota

export const LABELS = {
  idle: { label: "En espera", model: "toque el orbe", who: "Jarvis" },
  listening: { label: "Escuchando", model: "toque de nuevo para enviar", who: "Usted" },
  thinking: { label: "Pensando", model: "un momento, señor", who: "Jarvis" },
  speaking: { label: "Hablando", model: "voz de Jarvis", who: "Jarvis" },
  permiso: { label: "Esperando su permiso", model: "Claude Code · PC", who: "Jarvis" },
  sin_cuota: { label: "Sin cuota", model: "sin proveedores disponibles", who: "Jarvis" },
};

// El CSS aprobado usa "permission" y "error" para los colores ámbar y rojo.
export const VISUAL = { idle: "idle", listening: "listening", thinking: "thinking", speaking: "speaking", permiso: "permission", sin_cuota: "error" };

const subs = new Set();
export const store = { state: "idle", status: null, greeted: false, convId: null, approval: null };

export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
export function notify(what) { for (const fn of subs) fn(what, store); }

export function setState(s) {
  if (!LABELS[s]) return;
  store.state = s;
  document.body.setAttribute("data-state", VISUAL[s]);
  notify("state");
}
