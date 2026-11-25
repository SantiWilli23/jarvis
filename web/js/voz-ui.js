// Voz para las vistas Pro (escritorio y móvil): dictado al cuadro de texto (nunca envía) y lectura de las respuestas de Jarvis.
// Reutiliza las mismas piezas que el Clásico: voice.js (grabar y hablar) y /api/stt.
import { canRecord, startRecording, speak, stopSpeaking, desbloquearVoz } from "./voice.js";
import { transcribe } from "./api.js";
import { store, setState } from "./state.js";

const CLAVE = "jarvis_leer_pro";
const TIPOS = new Set(["coordinador", "sistema", "resultado"]);
const MAX_VOZ = 600;

// Quita todo lo que parezca código, diff o enlace: eso se mira, no se lee.
export function limpiarParaVoz(texto) {
  const t = String(texto ?? "")
    .replace(/(```|~~~)[\s\S]*?(\1|$)/g, "\n")
    .replace(/`[^`\n]*`?/g, " ")
    .replace(/https?:\/\/\S+/g, "enlace");
  const lineas = [];
  for (const l of t.split("\n")) {
    if (/^(diff --git |@@|index [0-9a-f]{6}|--- |\+\+\+ )/.test(l)) break; // empieza un diff: no se lee nada más
    if (/^([+<>|]|-\S| {4}|\t|[AMDRCT]\d*\t)/.test(l) || /[;{}]\s*$|=>|^\s*(const|let|var|function|import|export|class|def|return)\b.*[=({]/.test(l)) continue;
    lineas.push(l);
  }
  return lineas.join(" ").replace(/\s+/g, " ").trim().slice(0, MAX_VOZ);
}

// Texto que se puede leer en voz alta, o "" si el mensaje no está permitido.
export function textoLegible(msg) {
  if (!msg || msg.author !== "jarvis" || !TIPOS.has(msg.kind)) return "";
  const m = msg.meta || {};
  if (msg.private || msg.privado || m.private || m.privado) return "";
  return limpiarParaVoz(msg.text);
}

// Preferencia por dispositivo, apagada por defecto.
export function leerActivo() { try { return localStorage.getItem(CLAVE) === "1"; } catch { return false; } }
export function guardarLeer(v) { try { localStorage.setItem(CLAVE, v ? "1" : "0"); } catch { /* modo privado */ } }

// Lee solo lo que llega nuevo: al abrir (o cambiar de) hilo, el historial se da por visto.
export function crearLector({ hablar = speak, callar = stopSpeaking, activo = leerActivo } = {}) {
  let hilo = null, vistos = new Set(), cola = [], hablando = false, turno = 0, seguro = null;
  function siguiente() {
    if (hablando || !cola.length) return;
    const t = cola.shift(), mio = ++turno;
    hablando = true;
    const fin = () => { if (mio !== turno) return; clearTimeout(seguro); hablando = false; siguiente(); };
    seguro = setTimeout(fin, Math.max(8000, t.length * 120)); // por si otro corta el audio y no avisa
    hablar(t, fin, false);
  }
  function parar() {
    const sonaba = hablando;
    turno++; clearTimeout(seguro); cola = []; hablando = false;
    if (sonaba) callar();
  }
  function revisar(id, msgs, visible = true) {
    if (id == null) return;
    if (id !== hilo) { parar(); hilo = id; vistos = new Set(msgs.map((m) => m.id)); return; }
    for (const m of msgs) {
      if (vistos.has(m.id)) continue;
      vistos.add(m.id);
      const t = visible && activo() && store.state !== "listening" ? textoLegible(m) : "";
      if (t) cola.push(t);
    }
    siguiente();
  }
  return { revisar, parar };
}

// Ciclo grabar -> transcribir. alTexto recibe lo dictado; aquí nunca se envía nada.
export function crearDictado({ alTexto, alEstado = () => {}, alError = () => {}, grabar = startRecording, transcribir = transcribe, puede = canRecord, estado = setState }) {
  let rec = null, fase = "libre"; // libre | pidiendo | grabando | transcribiendo
  const pasar = (f) => { fase = f; alEstado(f); };
  async function empezar() {
    if (!puede()) return alError("Este navegador no puede grabar.");
    if (store.state === "listening" || store.state === "thinking") return alError("Jarvis está ocupado; espere un momento.");
    if (store.state === "speaking") { stopSpeaking(); estado("idle"); }
    pasar("pidiendo");
    try { rec = await grabar(() => parar()); } catch { pasar("libre"); return alError("No tengo permiso para el micrófono."); }
    estado("listening"); // el estado compartido es el que pausa y reanuda la música
    pasar("grabando");
  }
  async function parar() {
    if (fase !== "grabando") return;
    const r = rec; rec = null;
    pasar("transcribiendo");
    estado("thinking");
    try {
      const blob = await r.stop();
      if (blob.size < 800) alError("No le oí nada.");
      else {
        const { text } = await transcribir(blob);
        if (text?.trim()) alTexto(text.trim()); else alError("No le entendí. ¿Puede repetirlo?");
      }
    } catch { alError("Falló la transcripción."); }
    if (store.state !== "permiso") estado("idle"); // no tapa una aprobación pendiente
    pasar("libre");
  }
  return { alternar: () => (fase === "libre" ? empezar() : parar()), parar, fase: () => fase };
}

// Cablea botón de micrófono, cuadro de texto y casilla "Leer respuestas".
export function montarVoz({ mic, input, leer, error }) {
  const lector = crearLector();
  const dictado = crearDictado({
    alTexto: (t) => {
      const antes = input.value.trim();
      input.value = (antes ? antes + " " : "") + t;
      if (input.maxLength > 0) input.value = input.value.slice(0, input.maxLength);
      if (!input.disabled) input.focus();
    },
    alEstado: (f) => {
      const on = f === "grabando";
      mic.setAttribute("aria-pressed", String(on));
      mic.setAttribute("aria-label", on ? "Detener el dictado" : "Dictar por voz");
      mic.setAttribute("aria-busy", String(f === "transcribiendo"));
      mic.disabled = f === "transcribiendo" || (f === "libre" && input.disabled);
    },
    alError: error,
  });
  mic.addEventListener("click", () => { desbloquearVoz(); lector.parar(); dictado.alternar(); });
  leer.checked = leerActivo();
  leer.addEventListener("change", () => { guardarLeer(leer.checked); if (leer.checked) desbloquearVoz(); else lector.parar(); });
  return {
    lector,
    habilitar: (si) => { if (dictado.fase() === "libre") mic.disabled = !si; },
    parar: () => { dictado.parar(); lector.parar(); },
  };
}
