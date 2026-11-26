// Memoria central y reparto mensual (docs/MEMORIA.md). Panel de "Más". Todo texto va con textContent.
import { api, getToken } from "./api.js";

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const ESTADOS = { pendiente: "en espera", en_curso: "en curso", ok: "recogida", enviado: "enviado", necesita_login: "falta iniciar sesión", captcha: "pide captcha", bloqueado: "bloqueado", vencida: "venció", error: "falló", cancelada: "cancelado" };
const fecha = (v) => (v ? new Date(v).toLocaleString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
let abierta = false, aviso = "", previa = null;

function boton(texto, fn, cls) {
  const b = el("button", cls, texto);
  b.type = "button";
  b.addEventListener("click", async () => {
    b.disabled = true;
    try {
      await fn();
    } catch (e) {
      aviso = e.data?.mensaje || "No se pudo. Reintente.";
      previa = null;
    }
    await pintar();
  });
  return b;
}
const fila = (...botones) => {
  const d = el("div", "menu");
  d.append(...botones);
  return d;
};
const post = (ruta, body = {}) => api(`/memoria-reparto${ruta}`, { method: "POST", body });

function nota(n) {
  const li = el("li");
  const marcas = [n.status === "revision" ? "por revisar" : null, n.level === "privada" ? "privada" : null, n.origen || null, n.sale ? "se reparte" : "no sale"];
  li.append(el("div", "", (n.title ? `${n.title}: ` : "") + n.body), el("small", "", marcas.filter(Boolean).join(" · ")));
  const botones = n.status === "revision" ? [boton("Aprobar", () => post(`/notas/${n.id}/aprobar`))] : [];
  botones.push(boton("Borrar", () => api(`/memoria-reparto/notas/${n.id}`, { method: "DELETE" })));
  li.append(fila(...botones));
  return li;
}

async function pintar() {
  const panel = $("panel-memoria");
  if (!panel || !getToken()) return;
  let d;
  try {
    d = await api("/memoria-reparto");
  } catch {
    return;
  }
  const hijos = [el("h2", "", "Memoria central")];
  hijos.push(el("p", "mem", d.automatico.activo ? `Reparto automático cada 30 días (con el PC encendido). Próximo: ${fecha(d.automatico.proximo)}.` : "El reparto automático empieza cuando apruebe el primero."));
  hijos.push(fila(
    boton("Recoger", async () => { aviso = (await post("/recoger")).mensaje; }),
    boton("Repartir", async () => {
      previa = await api("/memoria-reparto/vista");
      aviso = previa.cantidad ? "" : "No hay nada que se pueda repartir.";
    }),
  ));
  if (aviso) hijos.push(el("p", "mem", aviso));
  if (previa?.cantidad) {
    const caja = el("div", "mem");
    caja.append(el("p", "", `Vista previa (${previa.cantidad}): esto se enviará a Claude, ChatGPT y Gemini.${previa.fuera ? ` Sin espacio para ${previa.fuera}.` : ""}`), el("p", "", previa.texto));
    const { hash } = previa;
    caja.append(fila(
      boton("Aprobar y enviar", async () => {
        aviso = (await post("/repartir", { hash })).mensaje;
        previa = null;
      }),
      boton("Cancelar", async () => { previa = null; }),
    ));
    hijos.push(caja);
  }
  if (d.repartos.length) {
    const ul = el("ul", "mem");
    for (const r of d.repartos.slice(0, 9)) ul.append(el("li", "", `${r.nombre} · ${r.tipo} · ${ESTADOS[r.estado] || r.estado}${r.cantidad ? ` (${r.cantidad})` : ""} · ${fecha(r.terminado || r.creado)}`));
    hijos.push(ul, el("p", "mem", "\"Enviado\" no garantiza que la IA lo haya guardado."));
  }
  const det = el("details");
  det.open = abierta;
  det.addEventListener("toggle", () => { abierta = det.open; });
  const lista = el("ul", "mem");
  lista.append(...d.notas.map(nota));
  det.append(el("summary", "", `Ver memoria (${d.notas.length})`), lista, fila(boton("Borrar todo", async () => {
    if (!window.confirm("¿Borrar toda la memoria de Jarvis? No se puede deshacer. Lo ya enviado a otras IA no se borra allí.")) return;
    await api("/memoria-reparto/datos", { method: "DELETE" });
    aviso = "Memoria borrada.";
    previa = null;
  }, "danger")));
  hijos.push(det);
  panel.replaceChildren(...hijos);
  panel.hidden = false;
}

if (typeof document !== "undefined" && $("panel-memoria")) {
  window.addEventListener("jarvis:mas", () => {
    aviso = "";
    previa = null;
    pintar();
  });
  window.addEventListener("jarvis:ws", (e) => {
    if (!$("panel-memoria").hidden && String(e.detail?.task?.tipo || "").startsWith("memoria_")) pintar();
  });
}
