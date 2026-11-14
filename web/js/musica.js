// Música con YouTube: tarjeta con el reproductor oficial (iframe visible, política de YouTube).
// Todo texto se inserta con textContent. La API de YouTube se carga solo la primera vez que se pide música.
import { store, subscribe } from "./state.js";
import { speak } from "./voice.js";

const ID_RE = /^[\w-]{11}$/;
const root = () => document.getElementById("musica");
let yt = null, player = null, listo = false, desbloqueado = false, sonando = false;
let cola = [], titulos = new Map(), pendiente = null, fallos = 0, reanudar = false, wake = null, actual = "";

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function boton(txt, label, fn) { const b = el("button", "", txt); b.type = "button"; b.setAttribute("aria-label", label); b.addEventListener("click", fn); return b; }

/* ---------- tarjeta ---------- */
let ui = null;
function montar() {
  if (ui || !root()) return ui;
  const card = el("div", "musica-card");
  const marco = el("div", "musica-marco");
  const titulo = el("div", "musica-titulo", "Música");
  titulo.setAttribute("aria-live", "polite");
  const aviso = el("div", "musica-aviso"); aviso.hidden = true;
  const ctl = el("div", "musica-ctl");
  const abrir = el("a", "musica-abrir", "Abrir en YouTube Music");
  abrir.target = "_blank"; abrir.rel = "noopener noreferrer"; abrir.hidden = true;
  ctl.append(
    boton("⏮", "Anterior", () => ejecutar({ op: "prev" })),
    boton("⏯", "Reproducir o pausar", () => { if (player && listo) sonando ? player.pauseVideo() : player.playVideo(); }),
    boton("⏭", "Siguiente", () => ejecutar({ op: "next" })),
    boton("🔀", "Aleatorio", () => ejecutar({ op: "shuffle" })),
    boton("✕", "Cerrar música", () => ejecutar({ op: "stop" })),
  );
  card.append(marco, titulo, aviso, ctl, abrir);
  root().replaceChildren(card);
  root().hidden = true;
  ui = { card, marco, titulo, aviso, abrir };
  return ui;
}
function mostrarAviso(t) { if (!ui) return; ui.aviso.textContent = t || ""; ui.aviso.hidden = !t; }
function setAbrir(url) {
  if (!ui) return;
  const u = url && /^https:\/\//.test(url) ? url : actual ? `https://music.youtube.com/watch?v=${actual}` : "";
  if (u) ui.abrir.href = u;
  ui.abrir.hidden = !u;
}
function pintarTitulo() {
  if (!ui) return;
  let t = "";
  try { const d = player?.getVideoData?.(); if (d?.video_id) actual = d.video_id; t = d?.title || ""; } catch { /* sin datos */ }
  t = titulos.get(actual) || t;
  if (t) ui.titulo.textContent = t;
}

/* ---------- Wake Lock ---------- */
async function pedirWake() {
  try { if (!wake && sonando && navigator.wakeLock) { wake = await navigator.wakeLock.request("screen"); wake.addEventListener?.("release", () => { wake = null; }); } } catch { wake = null; }
}
function soltarWake() { try { wake?.release?.(); } catch { /* ya liberado */ } wake = null; }
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") pedirWake(); });

/* ---------- API de YouTube ---------- */
function cargarApi() {
  if (yt) return yt;
  yt = new Promise((ok, mal) => {
    if (window.YT?.Player) return ok();
    const previo = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { try { previo?.(); } catch { /* ignorar */ } ok(); };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api"; s.async = true;
    s.onerror = () => { yt = null; mal(new Error("api")); };
    document.head.append(s);
  });
  return yt;
}

function crearReproductor(primero) {
  const u = montar(); if (!u) return;
  const f = document.createElement("iframe");
  f.src = `https://www.youtube-nocookie.com/embed/${primero}?enablejsapi=1&playsinline=1&rel=0&origin=${encodeURIComponent(location.origin)}`;
  f.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
  f.setAttribute("allow", "autoplay; encrypted-media; picture-in-picture");
  f.setAttribute("title", "Reproductor de YouTube");
  f.setAttribute("allowfullscreen", "");
  u.marco.replaceChildren(f);
  player = new window.YT.Player(f, { events: { onReady: alEstar, onStateChange: alEstado, onError: alError } });
}
function alEstar() {
  listo = true;
  if (pendiente) { const p = pendiente; pendiente = null; cargar(p.ids, p.index); }
}
function alEstado(e) {
  const S = window.YT.PlayerState;
  if (e.data === S.PLAYING) {
    desbloqueado = true; sonando = true; fallos = 0; mostrarAviso("");
    actual = player.getVideoData?.().video_id || actual; pintarTitulo(); setAbrir(); pedirWake();
  } else if (e.data === S.PAUSED || e.data === S.ENDED) { sonando = false; soltarWake(); }
  else if (e.data === S.CUED) { pintarTitulo(); setAbrir(); }
}
function alError(e) {
  fallos++; // 100/101/150/153: vídeo no disponible o sin permiso de incrustación
  if (fallos >= Math.max(1, cola.length)) { mostrarAviso("No se puede reproducir aquí."); setAbrir(); if (ui) ui.abrir.hidden = false; return; }
  try { player.nextVideo(); } catch { /* fin de cola */ }
}

function cargar(ids, index) {
  const i = Math.min(Math.max(0, index | 0), ids.length - 1);
  fallos = 0;
  actual = ids[i];
  if (desbloqueado) player.loadPlaylist(ids, i, 0);
  else {
    player.cuePlaylist(ids, i, 0);
    mostrarAviso("Toque ▶ una vez para empezar.");
    try { speak("Toque play una vez, señor.", null, false); } catch { /* sin voz */ }
  }
  setAbrir();
}

/* ---------- órdenes ---------- */
export async function ejecutar(m) {
  if (!m || typeof m !== "object") return;
  const op = m.op;
  reanudar = false; // cualquier orden musical anula la reanudación automática
  if (op === "play") {
    const items = (Array.isArray(m.items) ? m.items : []).filter((x) => x && ID_RE.test(x.id));
    if (!items.length) return;
    const u = montar(); if (!u) return;
    cola = items.map((x) => x.id);
    titulos = new Map(items.map((x) => [x.id, x.canal ? `${x.titulo} · ${x.canal}` : x.titulo]));
    const i = Math.min(Math.max(0, Number(m.index) || 0), cola.length - 1);
    u.titulo.textContent = m.titulo || titulos.get(cola[i]) || "Música";
    root().hidden = false; document.body.classList.add("con-musica");
    setAbrir(m.abrir);
    try { await cargarApi(); } catch { mostrarAviso("No pude cargar YouTube."); setAbrir(); return; }
    if (!player) { pendiente = { ids: cola, index: i }; crearReproductor(cola[i]); }
    else if (!listo) pendiente = { ids: cola, index: i };
    else cargar(cola, i);
    return;
  }
  if (op === "listas") { window.dispatchEvent(new CustomEvent("jarvis:musica-hoja")); return; }
  if (!player || !listo) return;
  try {
    if (op === "pause") { if (sonando) { player.pauseVideo(); } }
    else if (op === "resume") player.playVideo();
    else if (op === "next") player.nextVideo();
    else if (op === "prev") player.previousVideo();
    else if (op === "shuffle") { player.setShuffle(true); if (sonando) player.nextVideo(); }
    else if (op === "info") pintarTitulo();
    else if (op === "stop") { player.stopVideo(); sonando = false; soltarWake(); root().hidden = true; document.body.classList.remove("con-musica"); }
  } catch { /* reproductor no listo */ }
}
window.addEventListener("jarvis:musica", (ev) => { ejecutar(ev.detail); });

window.jarvisMusica = {
  estado: () => ({ activo: !!player && !!root() && !root().hidden, sonando }),
  ejecutar,
  reproducir: (items, index = 0, titulo = "") => ejecutar({ op: "play", items, index, titulo }),
};

/* ---------- el micrófono tiene prioridad ---------- */
subscribe((what) => {
  if (what !== "state") return;
  if (store.state === "listening" && sonando && player) { reanudar = true; try { player.pauseVideo(); } catch { /* ignorar */ } }
  else if (store.state === "idle" && reanudar) { reanudar = false; try { player?.playVideo(); } catch { /* ignorar */ } }
});
