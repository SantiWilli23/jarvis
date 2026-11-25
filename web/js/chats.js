// Vista "Chats": historial de lo que Jarvis preguntó en otros sitios (GET /api/nav/tasks).
// Todo texto leído de la web va con textContent; los enlaces, solo https.
import { api, getToken } from "./api.js";
import { botonEnlace, nombreSitio, urlSegura } from "./nav.js";

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const ESTADOS = { pendiente: "En espera", en_curso: "En curso", ok: "Lista", necesita_login: "Falta iniciar sesión", captcha: "Pide captcha", bloqueado: "Bloqueado", vencida: "Vencida", error: "Falló", cancelada: "Detenida", cuenta_incorrecta: "Cuenta incorrecta" };
const abiertas = new Set(); // respuestas desplegadas: se conservan al repintar
let visible = false;

function fecha(v) {
  const d = new Date(typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v);
  return v && !Number.isNaN(d.getTime()) ? d.toLocaleString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
}

function tarjeta(t) {
  const li = el("li", "tarjeta");
  li.append(el("small", "", [nombreSitio(t), fecha(t.creado), ESTADOS[t.estado] || t.estado].filter(Boolean).join(" · ")));
  li.append(el("b", "", String(t.consulta || "")));
  if (t.respuesta) {
    const d = el("details"); d.open = abiertas.has(t.id);
    d.addEventListener("toggle", () => { if (d.open) abiertas.add(t.id); else abiertas.delete(t.id); });
    d.append(el("summary", "", "Respuesta"), el("div", "resp", String(t.respuesta)));
    const fuentes = (Array.isArray(t.fuentes) ? t.fuentes : []).filter((f) => urlSegura(f?.url));
    if (fuentes.length) {
      const ul = el("ul");
      for (const f of fuentes) {
        const a = el("a", "", String(f.titulo || f.url));
        a.href = f.url; a.target = "_blank"; a.rel = "noopener noreferrer";
        const item = el("li"); item.append(a); ul.append(item);
      }
      d.append(ul);
    }
    li.append(d);
  }
  const abrir = botonEnlace(t.url_conversacion, "Abrir en " + nombreSitio(t));
  if (abrir) li.append(abrir);
  return li;
}

async function cargar() {
  if (!getToken()) return;
  const msg = $("chats-msg");
  if (!$("chats-lista").childElementCount) msg.textContent = "Cargando…";
  try {
    const tasks = (await api("/nav/tasks?limit=50")).tasks || [];
    $("chats-lista").replaceChildren(...tasks.map(tarjeta));
    msg.textContent = tasks.length ? "" : "Aún no hay chats.";
  } catch (e) { msg.textContent = e.status === 404 ? "Todavía no disponible." : "No pude cargar los chats."; }
}

if (typeof document !== "undefined" && $("chats-lista")) {
  window.addEventListener("jarvis:vista", (e) => { visible = e.detail?.vista === "chats"; if (visible) cargar(); });
  window.addEventListener("jarvis:ws", (e) => { if (visible && e.detail?.type === "nav.done") cargar(); });
  new MutationObserver(() => { if (!$("login").hidden) { $("chats-lista").replaceChildren(); abiertas.clear(); } }).observe($("login"), { attributes: true, attributeFilter: ["hidden"] });
}
