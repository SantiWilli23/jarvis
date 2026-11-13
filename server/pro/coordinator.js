// Coordinador Pro (Groq): funciones puras. Groq propone acciones cerradas en JSON; el servidor las valida
// según el estado de la ronda y es quien ejecuta. Groq nunca ejecuta, commitea ni aprueba por el usuario.
import { filtrar, cita } from "./prompts.js";

export const MOTORES = ["claude", "gemini"];
export const TIPOS = ["hablar", "consultar", "proponer", "iniciar_ronda", "parar"];
const txt = (x, max) => (typeof x === "string" ? x.trim().slice(0, max) : "");

function parseJson(x) {
  const m = String(x ?? "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { const o = JSON.parse(m[0]); return o && typeof o === "object" && !Array.isArray(o) ? o : null; } catch { return null; }
}

// Acción cruda -> acción limpia, o null si no es válida (se descarta).
function norm(a) {
  if (!a || typeof a !== "object" || !TIPOS.includes(a.tipo)) return null;
  if (a.tipo === "hablar") { const t = txt(a.texto, 2000); return t ? { tipo: "hablar", texto: t } : null; }
  if (a.tipo === "consultar") {
    const p = txt(a.pregunta, 1500);
    return MOTORES.includes(a.a) && p ? { tipo: "consultar", a: a.a, pregunta: p } : null;
  }
  if (a.tipo === "proponer") {
    if (!MOTORES.includes(a.programador) || !MOTORES.includes(a.verificador) || a.programador === a.verificador) return null;
    return { tipo: "proponer", programador: a.programador, verificador: a.verificador, texto: txt(a.texto, 1500), nota: txt(a.nota, 1000) };
  }
  return { tipo: a.tipo };
}

// Texto de Groq -> { acciones, resumen } o null (JSON inválido o sin ninguna acción válida).
export function parseAcciones(raw) {
  const o = parseJson(raw);
  if (!o || !Array.isArray(o.acciones)) return null;
  const acciones = o.acciones.map(norm).filter(Boolean);
  if (!acciones.length) return null;
  return { acciones, resumen: txt(o.resumen, 1500) };
}

// Aplica las reglas del estado. est = { limite, aprobado }.
//  - limite (consultas o turnos agotados): sin consultas nuevas.
//  - iniciar_ronda solo si el usuario ya aprobó (botón); Groq no puede aprobar por él.
//  - una propuesta como máximo; tras consultar o parar no se ejecuta nada más.
export function validar(acciones, { limite = false, aprobado = false } = {}) {
  const out = []; let propuso = false;
  for (const a of acciones) {
    if (a.tipo === "consultar" && limite) continue;
    if (a.tipo === "iniciar_ronda" && !aprobado) continue;
    if (a.tipo === "proponer") { if (propuso) continue; propuso = true; }
    out.push(a);
    if (a.tipo === "consultar" || a.tipo === "parar") break;
  }
  return out.slice(0, 4);
}

// Turnos de Groq ya dados en la ronda (cada turno deja un mensaje "coordinador").
export const contarTurnos = (msgs, roundId) => msgs.filter((m) => m.round_id === roundId && m.kind === "coordinador").length;

const nom = { claude: "Claude", gemini: "Gemini", jarvis: "Jarvis", usuario: "Usuario" };
// Lo único que ve Groq: texto de la conversación, planes, NOMBRES de archivo y resultados ya redactados. Sin diffs.
export function contextoGroq({ thread, msgs, roundId }) {
  const linea = (m) => {
    const b = m.meta?.body;
    if (m.kind === "informe" && b) return `${nom[m.author] || m.author} informó: archivos ${filtrar((b.archivos_tocados || []).join(", "), 600) || "ninguno"}; resultado ${filtrar(b.resultado, 200)}`;
    if (m.kind === "verificacion") return `${nom[m.author] || m.author} verificó: ${filtrar(m.meta?.veredicto, 40)}`;
    if (!["texto", "coordinador", "consulta", "plan", "sistema"].includes(m.kind)) return null;
    const t = `${nom[m.author] || m.author} (${m.kind}): ${m.text}`;
    return m.kind === "consulta" || m.kind === "plan" ? cita(nom[m.author] || m.author, t, 1500) : filtrar(t, 1500);
  };
  const hist = msgs.slice(-14).map(linea).filter(Boolean).join("\n");
  return `Hilo: ${filtrar(thread.title, 80)} (repo: ${filtrar(String(thread.repo || "").split(/[\\/]/).pop(), 60)})
${thread.resumen ? `Resumen previo: ${filtrar(thread.resumen, 1500)}\n` : ""}Ronda actual: ${roundId}
Conversación reciente:
${hist}`;
}
