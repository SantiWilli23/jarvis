// Registro de acciones (docs/CONTROL.md): lo que Jarvis hizo, en palabras. Usa la auditoría (/api/audit).
import { api, getToken } from "./api.js";

const NOMBRES = {
  "control.freno": "Freno puesto", "control.reanudar": "Reanudado", "control.activar": "Cambió el control del PC",
  "aprobacion.pedida": "Pidió su permiso", "aprobacion.aprobada": "Usted aprobó", "aprobacion.rechazada": "Se rechazó",
  "pc.creada": "Encargó una acción al PC", "pc.tope": "Llegó a un tope del PC", "phone.creada": "Encargó algo al teléfono",
  "phone.entregada": "El teléfono recogió acciones", "nav.encolar": "Encargó una consulta al navegador",
  "nav.cancelar": "Canceló una consulta del navegador", "browser.paso": "Paso en el navegador",
  "browser.cancelar": "Canceló una tarea del navegador", "pro.commit": "Guardó cambios (commit local)",
};
const GRUPOS = { "pc.control": "En su PC", pc: "PC", phone: "Teléfono", nav: "Navegador", browser: "Navegador", pro: "Modo Pro", escena: "Escena", aprobacion: "Permisos", control: "Control" };

export function describir(e) {
  const a = String(e.action || "");
  if (NOMBRES[a]) return NOMBRES[a];
  const grupo = Object.keys(GRUPOS).find((g) => a === g || a.startsWith(g + "."));
  const resto = (grupo ? a.slice(grupo.length + 1) : a).replace(/[._-]+/g, " ").trim();
  return grupo ? (resto ? `${GRUPOS[grupo]}: ${resto}` : GRUPOS[grupo]) : resto;
}

const hueco = typeof document !== "undefined" ? document.getElementById("panel-registro") : null;
if (hueco) {
  const el = (tag, cls, t) => { const x = document.createElement(tag); if (cls) x.className = cls; if (t != null) x.textContent = t; return x; };
  const lista = el("ul", "registro");
  hueco.append(el("h2", "", "Lo que hice"), lista);
  async function cargar() {
    if (!getToken()) return;
    try {
      const { entries } = await api("/audit");
      lista.replaceChildren(...(entries || []).slice(0, 40).map((e) => {
        const li = el("li");
        li.append(el("time", "", new Date(Number(e.created_at)).toLocaleString("es", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })), el("b", "", describir(e)));
        if (e.detail) li.append(el("span", "", e.detail));
        return li;
      }));
      if (!lista.children.length) lista.append(el("li", "", "Aún no hay nada, señor."));
      hueco.hidden = false;
    } catch { /* sin sesión o sin red: el panel sigue como estaba */ }
  }
  window.addEventListener("jarvis:mas", cargar);
}
