// Pantalla del PC: acciones pendientes/recientes, historial y botones del catálogo.
// Todo texto del servidor se inserta con textContent (nunca HTML armado a mano). Contenedor: #pcacc (web y /m).
import { api, getToken } from "./api.js";

const ESTADOS = { aprobacion: "Esperando permiso", lista: "En cola", reclamada: "En el PC", hecha: "Hecha", fallida: "Falló", caducada: "Caducada", rechazada: "Rechazada" };
const ACTIVOS = new Set(["aprobacion", "lista", "reclamada"]);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

let box = null, datos = { pc_en_linea: null, catalogo: [], apps: [], acciones: [] };
let abierta = null, aviso = "", timer = null, visible = () => true;

export const etiquetaEstado = (s) => ESTADOS[s] || String(s || "");
export function paramsLegibles(p) {
  if (!p || typeof p !== "object") return "";
  return Object.entries(p).map(([k, v]) => `${k}: ${v}`).join(", ");
}
const hora = (t) => (t ? new Date(t).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }) : "");

async function cargar() {
  if (!box || !getToken() || document.hidden || !visible()) return;
  try { datos = { ...datos, ...(await api("/pc/actions")) }; } catch { return; }
  pintar();
}

async function lanzar(accion, params) {
  aviso = "";
  try {
    const r = await api("/pc/actions", { method: "POST", body: { accion, params } });
    aviso = r.action?.status === "aprobacion" ? "Enviada: espera su aprobación." : "Enviada al PC.";
    abierta = null;
  } catch (e) { aviso = "No se pudo: " + (e.data?.mensaje || e.data?.error || e.message); }
  await cargar(); pintar();
}
async function decidir(id, aprobar) {
  try { await api(`/pc/actions/${id}/approve`, { method: "POST", body: { aprobar } }); aviso = aprobar ? "Aprobada." : "Rechazada."; }
  catch (e) { aviso = "No se pudo: " + (e.data?.error || e.message); }
  await cargar(); pintar();
}

function campo(nombre, def) {
  const opc = def.opcional ? " (opcional)" : "";
  const lab = el("label", "pcf", nombre + opc);
  let inp;
  if (def.tipo === "enum" || def.tipo === "app") {
    inp = el("select");
    const vals = def.tipo === "enum" ? def.valores : datos.apps;
    if (def.opcional) inp.append(new Option("—", ""));
    for (const v of vals || []) inp.append(new Option(v, v));
  } else if (def.tipo === "rango") {
    inp = el("input"); inp.type = "number"; inp.min = def.min; inp.max = def.max; inp.inputMode = "numeric";
  } else { inp = el("input"); inp.type = "text"; inp.maxLength = def.max || 200; }
  inp.dataset.p = nombre; inp.dataset.t = def.tipo;
  lab.append(inp);
  return lab;
}
function formulario(a) {
  const f = el("form", "pcform");
  f.append(el("div", "pcdesc", a.descripcion));
  for (const [n, d] of Object.entries(a.params || {})) f.append(campo(n, d));
  const ok = el("button", "pcgo", a.nivel === "aprobacion" ? "Pedir permiso" : "Enviar");
  ok.type = "submit"; f.append(ok);
  f.addEventListener("submit", (e) => {
    e.preventDefault();
    const params = {};
    for (const i of f.querySelectorAll("[data-p]")) {
      if (i.value === "") continue;
      params[i.dataset.p] = i.dataset.t === "rango" ? Number(i.value) : i.value;
    }
    lanzar(a.id, params);
  });
  return f;
}

function fila(a) {
  const d = el("div", "pcrow " + a.status);
  const top = el("div", "pctop");
  top.append(el("b", "", a.descripcion || a.action), el("span", "pcst", etiquetaEstado(a.status)), el("small", "", hora(a.created_at)));
  d.append(top);
  const p = paramsLegibles(a.params);
  if (p) d.append(el("div", "pcpar", p));
  else if (a.privado) d.append(el("div", "pcpar", "Contenido privado"));
  const txt = a.result && a.result.texto;
  if (txt) d.append(el("div", "pcres", String(txt).slice(0, 300)));
  if (a.status === "aprobacion") {
    const bt = el("div", "pcbtns");
    const si = el("button", "yes", "Aprobar"), no = el("button", "no", "Rechazar");
    si.type = no.type = "button";
    si.addEventListener("click", () => decidir(a.id, true));
    no.addEventListener("click", () => decidir(a.id, false));
    bt.append(si, no); d.append(bt);
  }
  return d;
}

function pintar() {
  if (!box) return;
  const kids = [];
  const on = datos.pc_en_linea;
  const est = el("div", "pcest");
  est.append(el("i", "dot " + (on ? "on" : "off")), el("span", "", on == null ? "Estado del PC desconocido" : on ? "PC en línea" : "PC sin conexión"));
  kids.push(est);
  if (aviso) kids.push(el("div", "pcaviso", aviso));

  const grid = el("div", "pcgrid");
  const soportadas = (datos.catalogo || []).filter((a) => a.soportada !== false);
  for (const a of soportadas) {
    const sinParams = !Object.values(a.params || {}).some((p) => !p.opcional);
    const b = el("button", "pcbtn" + (a.nivel === "aprobacion" ? " ask" : ""));
    b.type = "button"; b.title = a.descripcion;
    b.append(el("span", "", a.descripcion), el("small", "", a.nivel === "aprobacion" ? "pide permiso" : "automática"));
    b.addEventListener("click", () => {
      if (sinParams) lanzar(a.id, {});
      else { abierta = abierta === a.id ? null : a.id; pintar(); }
    });
    grid.append(b);
  }
  kids.push(grid);
  if (soportadas.length < (datos.catalogo || []).length) kids.push(el("div", "pcaviso", "Actualice la app del PC para ver más acciones."));
  const ab = soportadas.find((a) => a.id === abierta);
  if (ab) kids.push(formulario(ab));

  const lista = datos.acciones || [];
  const pend = lista.filter((a) => ACTIVOS.has(a.status)), hist = lista.filter((a) => !ACTIVOS.has(a.status));
  kids.push(el("h3", "", `Pendientes (${pend.length})`));
  if (pend.length) for (const a of pend) kids.push(fila(a)); else kids.push(el("div", "empty", "Nada pendiente."));
  kids.push(el("h3", "", "Historial"));
  if (hist.length) for (const a of hist.slice(0, 20)) kids.push(fila(a)); else kids.push(el("div", "empty", "Sin historial todavía."));
  box.replaceChildren(...kids);
}

// opts.visible: función que dice si el panel está a la vista (en /m solo cuando la pestaña PC está abierta).
export function initAccionesPc(opts = {}) {
  box = document.getElementById("pcacc");
  if (!box || timer) return;
  if (opts.visible) visible = opts.visible;
  window.addEventListener("jarvis:ws", (ev) => { const t = ev.detail && ev.detail.type; if (t === "pc.actions" || t === "accion.resultado") cargar(); });
  timer = setInterval(cargar, 15000); // respaldo suave si el WS aún no avisa
  document.addEventListener("visibilitychange", () => { if (!document.hidden) cargar(); });
  cargar();
}
export const refrescarAccionesPc = () => cargar();

if (document.getElementById("pcacc") && !document.body.classList.contains("movil")) initAccionesPc();
