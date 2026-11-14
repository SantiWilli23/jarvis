// Estudio de Jarvis: chat de código por la API de Gemini (servidor). Las claves nunca llegan aquí.
// Las funciones de render son puras (HTML escapado) y se prueban sin navegador.
import { api, getToken } from "./api.js";

export const AI_STUDIO_URL = "https://aistudio.google.com";
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Parte una respuesta en texto y bloques ``` con su lenguaje.
export function partes(texto) {
  const out = [];
  const s = String(texto ?? "");
  const re = /```([\w+#.-]*)[^\S\n]*\n?([\s\S]*?)(?:```|$)/g;
  let i = 0, m;
  while (i < s.length && (m = re.exec(s))) {
    if (m.index > i) out.push({ tipo: "texto", texto: s.slice(i, m.index) });
    out.push({ tipo: "codigo", lang: m[1] || "", texto: m[2].replace(/\n$/, "") });
    i = re.lastIndex;
    if (m[0].length === 0) re.lastIndex++;
  }
  if (i < s.length) out.push({ tipo: "texto", texto: s.slice(i) });
  return out.filter((p) => p.texto.trim() || p.tipo === "codigo");
}

// HTML de una respuesta; cada bloque de código lleva su botón Copiar (data-copiar = índice global desde `base`).
export function renderRespuesta(texto, base = 0) {
  let n = base;
  return partes(texto).map((p) => p.tipo === "codigo"
    ? `<div class="code"><div class="code-h"><span>${esc(p.lang || "código")}</span><button type="button" class="mini" data-copiar="${n++}">Copiar</button></div><pre><code>${esc(p.texto)}</code></pre></div>`
    : `<p class="txt">${esc(p.texto.trim()).replace(/\n/g, "<br>")}</p>`).join("");
}

export const codigosDe = (texto) => partes(texto).filter((p) => p.tipo === "codigo").map((p) => p.texto);

export function renderOpciones(modelos, elegido) {
  return (modelos || []).map((m) => `<option value="${esc(m.id)}"${m.gratis ? "" : " disabled"}${m.id === elegido ? " selected" : ""}>${esc(m.nombre)}${m.gratis ? "" : " (sin nivel gratis)"}</option>`).join("");
}

export const MENSAJES = {
  privado_no_gemini: "Eso es privado, señor: no se lo paso a Gemini.",
  sin_nivel_gratis: "Ese modelo no tiene nivel gratis.",
  gemini_sin_clave: "Gemini no tiene clave en el servidor.",
  tope_diario: "Llegó al tope diario del Estudio.",
  limite_gemini: "Gemini llegó a su límite gratis por ahora.",
  gemini_fallo: "Gemini no respondió. Intente de nuevo.",
  texto_largo: "El mensaje es demasiado largo.",
};
export const errorTexto = (e) => e?.data?.mensaje || MENSAJES[e?.data?.error] || (e?.status === 401 ? "Inicie sesión en Jarvis primero." : "No se pudo completar.");

// ---- Interfaz (solo en el navegador) ----
function init() {
  const $ = (id) => document.getElementById(id);
  if (!$("est-form")) return;
  let session = "";
  try { session = localStorage.getItem("jarvis_estudio_sesion") || ""; } catch { /* sin storage */ }
  if (!session) { session = "s" + Date.now().toString(36); try { localStorage.setItem("jarvis_estudio_sesion", session); } catch { /* sin storage */ } }
  const codigos = [];
  const msgs = $("est-msgs");
  const burbuja = (rol, html) => { const d = document.createElement("div"); d.className = "msg " + rol; d.innerHTML = html; msgs.append(d); msgs.scrollTop = msgs.scrollHeight; };
  const pintar = (m) => {
    if (m.role === "user") return burbuja("user", `<p class="txt">${esc(m.content).replace(/\n/g, "<br>")}</p>`);
    const base = codigos.length; codigos.push(...codigosDe(m.content));
    return burbuja("bot", renderRespuesta(m.content, base));
  };
  const estado = (t, err) => { $("est-estado").textContent = t || ""; $("est-estado").classList.toggle("err", !!err); };

  msgs.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-copiar]"); if (!b) return;
    const t = codigos[Number(b.dataset.copiar)] ?? "";
    try { await navigator.clipboard.writeText(t); } catch {
      const ta = document.createElement("textarea"); ta.value = t; document.body.append(ta); ta.select();
      try { document.execCommand("copy"); } catch { /* sin portapapeles */ }
      ta.remove();
    }
    b.textContent = "Copiado"; setTimeout(() => { b.textContent = "Copiar"; }, 1500);
  });
  $("est-ai").href = AI_STUDIO_URL;

  (async () => {
    if (!getToken()) { estado("Inicie sesión en Jarvis (pantalla principal) y vuelva aquí.", true); return; }
    try {
      const m = await api("/studio/models");
      $("est-modelo").innerHTML = renderOpciones(m.modelos, m.por_defecto);
      $("est-aviso").textContent = m.aviso;
      if (!m.disponible) estado("Gemini no tiene clave en el servidor.", true);
      const h = await api(`/studio/history?session=${encodeURIComponent(session)}`);
      for (const x of h.messages) pintar(x);
    } catch (e) { estado(errorTexto(e), true); }
  })();

  $("est-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = $("est-in").value; if (!text.trim()) return;
    $("est-in").value = ""; $("est-send").disabled = true; estado("Gemini está pensando…");
    pintar({ role: "user", content: text });
    try {
      const r = await api("/studio/chat", { method: "POST", body: { text, model: $("est-modelo").value, session, private: $("est-priv").checked } });
      pintar({ role: "assistant", content: r.reply }); estado("");
    } catch (x) { estado(errorTexto(x), true); }
    $("est-send").disabled = false;
  });
  $("est-nuevo").addEventListener("click", async () => {
    try { await api(`/studio/history?session=${encodeURIComponent(session)}`, { method: "DELETE" }); } catch { /* ya vacío */ }
    msgs.replaceChildren(); codigos.length = 0; estado("");
  });
}
if (typeof document !== "undefined") init();
