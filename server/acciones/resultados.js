// Resultados de las acciones del PC y del iPhone: vuelven al chat, al HUD y a la voz.
// Escucha `pc.action.result` y `phone.action.result` (los emiten las colas) y publica `accion.resultado`:
//   { origen:'pc'|'phone', id, accion, ok, texto, privado, conversationId, deviceId, hablar, at }
// Privacidad: un resultado privado (portapapeles leído, captura...) viaja SOLO en vivo por el WebSocket y queda
// 15 min en un búfer en memoria (para reconectar). Nunca va a la BD, ni a push/Telegram (esos dicen "Resultado listo").
// Si ningún dispositivo del dueño está conectado, se avisa por push y Telegram (sin contenido privado).
const BUFFER_MS = 15 * 60_000;
const BUFFER_MAX = 20;
const TEXTO_MAX = 300;

const limpiar = (s) => String(s ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, TEXTO_MAX);

// Texto corto y legible en español. `nombre` es la descripción de la acción ("Subir el volumen").
export function textoResultado({ ok, texto, nombre }) {
  const t = limpiar(texto), n = limpiar(nombre);
  if (ok) return t || (n ? `Hecho: ${n}.` : "Hecho.");
  return n ? `No pude completar «${n}».${t ? " " + t : ""}` : (t || "No pude completar la acción.");
}

export function createResultados({ bus, push = null, notify = null, getHub = () => null, audit = null, now = () => Date.now() }) {
  const buffer = new Map(); // userId -> [{ ev, exp }]

  function guardar(userId, ev) {
    const t = now();
    const lista = (buffer.get(userId) || []).filter((x) => x.exp > t);
    lista.push({ ev, exp: t + BUFFER_MS });
    buffer.set(userId, lista.slice(-BUFFER_MAX));
  }

  function entregado(userId, deviceId) {
    const hub = getHub();
    if (!hub) return false;
    return !!((deviceId != null && hub.hasDevice?.(deviceId)) || hub.hasUser?.(userId));
  }

  async function emitir(origen, p) {
    const userId = Number(p.userId);
    const privado = !!p.privado;
    const ev = {
      origen, id: Number(p.id), accion: String(p.action ?? p.accion ?? ""), ok: !!p.ok,
      texto: textoResultado({ ok: p.ok, texto: p.texto, nombre: p.nombre }),
      privado, conversationId: p.conversationId ?? null, deviceId: p.deviceId ?? null,
      hablar: !privado, at: now(),
    };
    if (privado) guardar(userId, ev);
    const vivo = entregado(userId, ev.deviceId);
    bus.emit("accion.resultado", { userId, ...ev });
    if (!vivo) {
      const aviso = privado ? "Resultado listo" : ev.texto;
      try { await push?.notify(userId, { title: "Jarvis", body: aviso }); } catch (e) { console.error("[resultados] push", e.message); }
      try { await notify?.(aviso); } catch (e) { console.error("[resultados] telegram", e.message); }
    }
    try { await audit?.log({ userId, action: "accion.resultado", detail: `${origen} ${ev.accion} ${ev.ok ? "ok" : "fallo"}` }); } catch { /* auditoría opcional */ }
    return ev;
  }

  bus.on("pc.action.result", (p) => { emitir("pc", p).catch((e) => console.error("[resultados]", e.message)); });
  bus.on("phone.action.result", (p) => { emitir("phone", p).catch((e) => console.error("[resultados]", e.message)); });

  return {
    emitir,
    // Resultados privados aún vigentes (15 min), para reenviarlos al reconectar. Sin voz: ya se dijeron (o no).
    pendientes(userId) {
      const t = now();
      const lista = (buffer.get(Number(userId)) || []).filter((x) => x.exp > t);
      buffer.set(Number(userId), lista);
      return lista.map((x) => ({ type: "accion.resultado", ...x.ev, hablar: false }));
    },
  };
}
