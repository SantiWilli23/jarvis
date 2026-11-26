// Plan de estudio y repaso (docs/NAV.md). Panel de "Más". Todo texto va con textContent.
import { api, getToken } from "./api.js";

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
let aviso = "", materia = "", reloj = null;
const abiertas = new Set(); // tarjetas con la respuesta a la vista

function boton(texto, fn) {
  const b = el("button", "", texto);
  b.type = "button";
  b.addEventListener("click", async () => {
    b.disabled = true;
    try { await fn(); } catch (e) { aviso = e.data?.mensaje || "No se pudo. Reintente."; }
    await pintar();
  });
  return b;
}
const fila = (...hijos) => { const d = el("div", "menu"); d.append(...hijos); return d; };
const post = async (ruta, body = {}) => { const r = await api(`/repaso${ruta}`, { method: "POST", body }); aviso = r.mensaje || ""; };

function tarjeta(t) {
  const li = el("li");
  li.append(el("small", "", `${t.materia} · nivel ${t.nivel}`), el("div", "", t.pregunta));
  if (!abiertas.has(t.id)) li.append(fila(boton("Ver respuesta", async () => { abiertas.add(t.id); })));
  else {
    const contestar = (sabia) => async () => { await api(`/repaso/tarjetas/${t.id}`, { method: "POST", body: { sabia } }); abiertas.delete(t.id); };
    li.append(el("p", "", t.respuesta), fila(boton("La sabía", contestar(true)), boton("No la sabía", contestar(false))));
  }
  return li;
}

async function pintar() {
  const panel = $("panel-repaso");
  clearTimeout(reloj);
  if (!panel || !getToken()) return;
  let d;
  try { d = await api("/repaso"); } catch { return; }
  const hijos = [el("h2", "", "Plan y repaso")];
  if (!d.pc) hijos.push(el("p", "mem", "El PC está apagado o en pausa: no se puede preparar nada nuevo."));
  const campo = el("input");
  campo.type = "text";
  campo.maxLength = 40;
  campo.placeholder = "Materia";
  campo.setAttribute("aria-label", "Materia a repasar");
  campo.value = materia;
  campo.addEventListener("input", () => { materia = campo.value; });
  const escribiendo = document.activeElement?.getAttribute("aria-label") === "Materia a repasar";
  hijos.push(fila(boton("Plan de la semana", () => post("/plan")), campo, boton("Repasar", () => post("/materia", { materia }))));
  if (aviso) hijos.push(el("p", "mem", aviso));
  for (const t of d.trabajos) hijos.push(el("p", "mem", `${t.tipo === "plan" ? "Plan" : `Repaso de ${t.materia}`}: ${t.mensaje}`));
  if (d.tarjetas.length) {
    const ul = el("ul", "mem");
    ul.append(...d.tarjetas.map(tarjeta));
    hijos.push(ul);
  } else if (d.total) hijos.push(el("p", "mem", "No quedan tarjetas por repasar hoy."));
  if (d.plan) {
    const ul = el("ul", "mem");
    for (const x of d.plan.dias) {
      const li = el("li");
      li.append(el("b", "", x.fecha), ...x.tareas.map((s) => el("div", "", s)));
      ul.append(li);
    }
    hijos.push(el("h3", "", "Plan de estudio"), ul);
  }
  if (d.plan || d.total) {
    hijos.push(fila(boton("Borrar plan y tarjetas", async () => {
      if (window.confirm("¿Borrar el plan y las tarjetas?")) await api("/repaso/datos", { method: "DELETE" });
    })));
  }
  panel.replaceChildren(...hijos);
  panel.hidden = false;
  if (escribiendo) campo.focus();
  if (d.trabajos.some((t) => t.activo)) reloj = setTimeout(pintar, 5000); // mientras Claude trabaja
}

if (typeof document !== "undefined" && $("panel-repaso")) {
  window.addEventListener("jarvis:mas", () => { aviso = ""; pintar(); });
  window.addEventListener("jarvis:respuesta", (e) => { if (e.detail?.status === "repaso") pintar(); });
}
