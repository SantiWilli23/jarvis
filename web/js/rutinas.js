// Rutinas (docs/CONTROL.md). Panel de "Más". Todo texto va con textContent.
import { api, getToken } from "./api.js";

const hueco = typeof document !== "undefined" ? document.getElementById("panel-rutinas") : null;
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const DIAS = [["Lu", 1], ["Ma", 2], ["Mi", 3], ["Ju", 4], ["Vi", 5], ["Sá", 6], ["Do", 0]];
let aviso = "", formAbierto = false;

function boton(texto, fn, cls) {
  const b = el("button", cls, texto);
  b.type = "button";
  b.addEventListener("click", async () => {
    b.disabled = true;
    try { await fn(); } catch (e) { aviso = e.data?.mensaje || "No se pudo. Reintente."; }
    await pintar();
  });
  return b;
}
const campo = (rotulo, control) => {
  const l = el("label", "", rotulo);
  control.style.cssText = "display:block;width:100%;font:inherit;font-size:16px";
  l.append(control);
  return l;
};

function formulario(zona) {
  const det = el("details", "mem");
  det.open = formAbierto;
  det.addEventListener("toggle", () => { formAbierto = det.open; });
  const nombre = el("input"), frase = el("input"), pasos = el("textarea"), hora = el("input");
  pasos.rows = 3;
  hora.type = "time";
  const casillas = DIAS.map(([n, v]) => {
    const c = el("input");
    c.type = "checkbox";
    c.value = String(v);
    const l = el("label", "", n);
    l.prepend(c);
    return l;
  });
  const dias = el("div", "menu");
  dias.append(...casillas);
  const error = el("p", "mem");
  error.setAttribute("role", "status");
  // Crear no pasa por boton(): si falla, se conserva lo escrito.
  const crear = el("button", "", "Crear");
  crear.type = "button";
  crear.addEventListener("click", async () => {
    const marcados = casillas.map((l) => l.firstChild).filter((c) => c.checked).map((c) => Number(c.value));
    const horario = hora.value || marcados.length ? { dias: marcados, hora: hora.value } : null;
    crear.disabled = true;
    try {
      await api("/rutinas", { method: "POST", body: { nombre: nombre.value, frase: frase.value, pasos: pasos.value.split("\n"), horario } });
      formAbierto = false;
      aviso = "Rutina creada.";
      await pintar();
    } catch (e) {
      error.textContent = e.data?.mensaje || "No se pudo. Reintente.";
      crear.disabled = false;
    }
  });
  det.append(el("summary", "", "Nueva rutina"), campo("Nombre", nombre), campo("Frase para lanzarla (opcional)", frase),
    campo("Pasos, uno por línea, como se los diría a Jarvis", pasos), campo(`Hora (opcional, ${zona})`, hora), dias, crear, error);
  return det;
}

async function pintar() {
  if (!hueco || !getToken()) return;
  let d;
  try { d = await api("/rutinas"); } catch { return; }
  const hijos = [el("h2", "", "Rutinas"), el("p", "mem", "A su hora solo se ejecuta sin preguntar lo que lee; antes de cambiar algo, Jarvis pide permiso.")];
  if (aviso) {
    const p = el("p", "mem", aviso);
    p.style.whiteSpace = "pre-line";
    hijos.push(p);
  }
  const ul = el("ul", "mem");
  for (const r of d.rutinas) {
    const li = el("li");
    const marcas = [r.cuando, r.frase ? `frase: «${r.frase}»` : null, r.activa ? null : "pausada"].filter(Boolean);
    const botones = el("div", "menu");
    botones.append(
      boton("Probar", async () => { aviso = (await api(`/rutinas/${r.id}/probar`, { method: "POST", body: {} })).mensaje; }),
      boton(r.activa ? "Pausar" : "Activar", async () => { await api(`/rutinas/${r.id}`, { method: "PATCH", body: { activa: !r.activa } }); aviso = ""; }),
      boton("Borrar", async () => {
        if (!window.confirm(`¿Borrar la rutina «${r.nombre}»?`)) return;
        await api(`/rutinas/${r.id}`, { method: "DELETE" });
        aviso = "";
      }, "danger"),
    );
    li.append(el("div", "", r.nombre), el("small", "", marcas.join(" · ")), el("div", "", r.pasos.join(" / ")), botones);
    ul.append(li);
  }
  hijos.push(d.rutinas.length ? ul : el("p", "mem", "Todavía no hay rutinas."), formulario(d.zona));
  hueco.replaceChildren(...hijos);
  hueco.hidden = false;
}

if (hueco) window.addEventListener("jarvis:mas", () => { aviso = ""; pintar(); });
