// Panel "En vivo": lo que hace el navegador (sitio, pasos, captura) y el botón Detener. Escritorio y /m.
// Todo lo leído de páginas va con textContent; la captura solo entra como data: URL de image/*.
import { api, getToken } from "./api.js";
import { nombreSitio } from "./nav.js";

const $ = (id) => document.getElementById(id);
const MIMES = /^image\/(png|jpeg|webp)$/;
const ACTIVOS = new Set(["en_curso", "pendiente"]);
const FIN = { ok: "Listo", cancelada: "Detenida", necesita_login: "Falta iniciar sesión", captcha: "Pide un captcha", bloqueado: "Sitio bloqueado", cuenta_incorrecta: "Cuenta incorrecta", vencida: "Se venció", error: "Falló" };
const MAX_PASOS = 30, ESPERA = 240000;
let actual = null, ocultar = null, vigilante = null;

const msg = (t) => { $("ev-msg").textContent = t || ""; };
function host(url) { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } }

function cerrar() {
  clearTimeout(ocultar); clearTimeout(vigilante);
  actual = null;
  $("envivo").hidden = true;
  $("ev-pasos").replaceChildren();
  $("ev-img").removeAttribute("src"); $("ev-img").hidden = true;
  $("ev-consulta").textContent = ""; msg("");
}
function vigilar() { clearTimeout(vigilante); vigilante = setTimeout(cerrar, ESPERA); } // si se pierde nav.done

function abrir(task) {
  if (actual?.id !== task.id) cerrar();
  clearTimeout(ocultar);
  actual = { id: task.id };
  $("ev-sitio").textContent = nombreSitio(task);
  $("ev-consulta").textContent = String(task.consulta || "");
  $("ev-titulo").textContent = "En vivo";
  $("ev-stop").hidden = false; $("ev-stop").disabled = false;
  $("envivo").classList.add("activa");
  $("envivo").hidden = false;
  vigilar();
}

function paso(texto, url) {
  const h = host(url);
  if (h) $("ev-sitio").textContent = h;
  if (!texto) return;
  const li = document.createElement("li");
  li.textContent = String(texto).slice(0, 200);
  const lista = $("ev-pasos");
  lista.append(li);
  while (lista.children.length > MAX_PASOS) lista.firstChild.remove();
  li.scrollIntoView?.({ block: "nearest" });
}

function frame(mime, data) {
  if (!MIMES.test(mime || "") || typeof data !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return;
  $("ev-img").src = `data:${mime};base64,${data}`;
  $("ev-img").hidden = false;
}

function terminar(estado) {
  clearTimeout(vigilante);
  $("ev-titulo").textContent = FIN[estado] || "Terminó";
  $("ev-stop").hidden = true;
  $("envivo").classList.remove("activa");
  msg("");
  ocultar = setTimeout(cerrar, 6000);
}

function onWs(m) {
  if (m.type === "nav.inicio" && m.task) return abrir(m.task);
  if (m.type === "nav.done") { if (actual && m.task?.id === actual.id) terminar(m.task.estado); return; }
  if (m.type !== "nav.paso" && m.type !== "nav.frame") return;
  if (actual?.id !== m.task_id) abrir({ id: m.task_id }); // la página se abrió a mitad de la tarea
  else vigilar();
  if (m.type === "nav.paso") paso(m.texto, m.url); else frame(m.mime, m.data);
}

// Al entrar (o recargar) con una tarea en marcha, se muestra.
async function recuperar() {
  if (actual || !getToken()) return;
  try {
    const t = ((await api("/nav/tasks?limit=5")).tasks || []).find((x) => ACTIVOS.has(x.estado));
    if (!t || actual) return;
    abrir(t);
    for (const p of Array.isArray(t.pasos) ? t.pasos : []) paso(p?.texto, p?.url);
  } catch { /* servidor sin historial: se verá con el primer evento */ }
}

if (typeof document !== "undefined" && $("envivo")) {
  const vistos = new WeakSet(); // main.js y ws.js despachan el mismo objeto
  window.addEventListener("jarvis:ws", (ev) => {
    const m = ev.detail;
    if (!m || typeof m !== "object" || vistos.has(m)) return;
    vistos.add(m); onWs(m);
  });
  $("ev-stop").addEventListener("click", async () => {
    if (!actual) return;
    const { id } = actual;
    $("ev-stop").disabled = true; msg("Deteniendo…");
    try {
      await api(`/nav/tasks/${encodeURIComponent(id)}/cancel`, { method: "POST", body: {} });
      if (actual?.id === id) terminar("cancelada");
    } catch { $("ev-stop").disabled = false; msg("No pude detenerlo."); }
  });
  new MutationObserver(() => { if ($("login").hidden) setTimeout(recuperar, 500); else cerrar(); }).observe($("login"), { attributes: true, attributeFilter: ["hidden"] });
  setTimeout(recuperar, 1500);
}
