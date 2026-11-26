// Vista "Estudiar": pendientes de Classroom y Lirmi (/api/escolar). Todo texto leído de la web va con textContent.
import { api, getToken } from "./api.js";
import { urlSegura } from "./nav.js";

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const FUENTES = { classroom: "Classroom", lirmi: "Lirmi" };
let visible = false;

const msg = (t) => { $("esc-msg").textContent = t || ""; };
const errorTexto = (e) => (e.status === 404 ? "Todavía no disponible." : e.data?.error === "pc_apagado" ? "El PC está apagado." : e.data?.mensaje || "No se pudo. Reintente.");

function tarjeta(i) {
  const li = el("li", "tarjeta");
  li.append(el("small", "", [FUENTES[i.fuente] || i.fuente, i.curso, i.tipo, i.fecha].filter(Boolean).join(" · ")));
  li.append(el("b", "", String(i.titulo || "Sin título")));
  if (i.resumen) li.append(el("p", "", String(i.resumen)));
  if (urlSegura(i.url)) {
    const a = el("a", "boton", "Abrir");
    a.href = i.url; a.target = "_blank"; a.rel = "noopener noreferrer";
    li.append(a);
  }
  return li;
}

// Vista previa de los eventos de las pruebas: solo se crea lo que se mostró.
let porCrear = [];
const calMsg = (t) => { $("esc-cal-msg").textContent = t || ""; };
function pintarEventos(eventos) {
  porCrear = eventos.filter((e) => !e.existe).map((e) => e.id);
  $("esc-cal-lista").replaceChildren(...eventos.map((e) => {
    const li = el("li", "tarjeta");
    const hora = e.inicio.length > 10 ? e.inicio.slice(11, 16) + " a " + e.fin.slice(11, 16) : "Día completo";
    li.append(el("small", "", [e.dia, hora, e.existe ? "Ya está en Calendar" : ""].filter(Boolean).join(" · ")), el("b", "", String(e.titulo)));
    return li;
  }));
}
async function verEventos() {
  calMsg("Buscando…"); $("esc-cal-acc").hidden = true;
  try {
    const r = await api("/escolar/calendario");
    pintarEventos(r.eventos || []);
    $("esc-cal-acc").hidden = !(r.conectado && porCrear.length);
    const sin = r.sinFecha ? `Pruebas sin fecha clara: ${r.sinFecha}.` : "";
    calMsg([r.mensaje || (porCrear.length ? "Revise la lista antes de crear." : "Ya está todo en Calendar."), sin].filter(Boolean).join(" "));
  } catch (e) { pintarEventos([]); calMsg(errorTexto(e)); }
}
async function crearEventos() {
  $("esc-cal-crear").disabled = true; calMsg("Creando…");
  try {
    const r = await api("/escolar/calendario", { method: "POST", body: { ids: porCrear } });
    await verEventos();
    calMsg(r.mensaje);
  } catch (e) { calMsg(errorTexto(e)); }
  $("esc-cal-crear").disabled = false;
}
const limpiarEventos = () => { pintarEventos([]); calMsg(""); $("esc-cal-acc").hidden = true; };

async function cargar() {
  if (!getToken()) return;
  try {
    const r = await api("/escolar");
    const correo = r.cuentas?.find((c) => c.id === "classroom")?.correo || "";
    if (document.activeElement !== $("esc-correo") && !$("esc-correo").dataset.editado) $("esc-correo").value = correo;
    const items = r.items || [];
    $("esc-lista").replaceChildren(...items.map(tarjeta));
    const d = r.actualizado ? new Date(r.actualizado) : null;
    const cuando = d && !Number.isNaN(d.getTime()) ? "Actualizado " + d.toLocaleString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
    msg(items.length ? cuando : "Nada pendiente.");
  } catch (e) { msg(errorTexto(e)); }
}

if (typeof document !== "undefined" && $("esc-lista")) {
  window.addEventListener("jarvis:vista", (e) => { visible = e.detail?.vista === "estudiar"; if (visible) cargar(); });
  window.addEventListener("jarvis:ws", (e) => { if (visible && e.detail?.type === "nav.done") cargar(); });
  $("esc-correo").addEventListener("input", () => { $("esc-correo").dataset.editado = "1"; });
  $("esc-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/escolar/cuentas", { method: "PUT", body: { classroom_correo: $("esc-correo").value.trim() } });
      delete $("esc-correo").dataset.editado;
      msg("Guardado.");
    } catch (x) { msg(errorTexto(x)); }
  });
  $("esc-cal-ver").addEventListener("click", verEventos);
  $("esc-cal-crear").addEventListener("click", crearEventos);
  for (const b of document.querySelectorAll("[data-esc]")) {
    b.addEventListener("click", async () => {
      b.disabled = true; msg("Pidiendo…");
      try {
        await api("/escolar/actualizar", { method: "POST", body: { fuente: b.dataset.esc } });
        msg("Revisando " + FUENTES[b.dataset.esc] + "…");
      } catch (x) { msg(errorTexto(x)); }
      b.disabled = false;
    });
  }
  new MutationObserver(() => {
    if ($("login").hidden) return;
    $("esc-lista").replaceChildren(); $("esc-correo").value = ""; delete $("esc-correo").dataset.editado; msg(""); limpiarEventos();
  }).observe($("login"), { attributes: true, attributeFilter: ["hidden"] });
}
