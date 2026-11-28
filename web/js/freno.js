// Botón de freno (docs/CONTROL.md): detiene todo lo que Jarvis hace en el PC. Reanudar es un toque aparte.
import { api, getToken } from "./api.js";
import { stopSpeaking } from "./voice.js";
import { store, setState } from "./state.js";

// Frenar también corta lo que Jarvis esté diciendo (con toda su cola de partes).
const avisarFreno = () => window.dispatchEvent(new CustomEvent("jarvis:freno")); // conversa.js corta la charla
function callar() { avisarFreno(); stopSpeaking(); if (store.state === "speaking") setState("idle"); }

const hueco = document.getElementById("panel-freno");
if (hueco) {
  const boton = document.createElement("button"); boton.type = "button"; boton.className = "freno-btn";
  const texto = document.createElement("span"); texto.className = "freno-estado"; texto.setAttribute("role", "status");
  // Control amplio y ratón/teclado: apagados por defecto, con minutos y cuenta atrás. Aquí se edita la lista autorizada.
  const crear = (tag, cls, t) => { const e = document.createElement(tag); if (cls) e.className = cls; if (t != null) e.textContent = t; return e; };
  const panel = crear("details", "control-pc"), cuerpo = crear("div", "control-cuerpo");
  panel.append(crear("summary", "", "Control del PC"), cuerpo);
  const minutos = crear("input"); minutos.type = "number"; minutos.min = 1; minutos.max = 240; minutos.value = 30;
  const lblMin = crear("label", "", "Minutos "); lblMin.append(minutos);
  cuerpo.append(lblMin);
  const hasta = { amplio: null, raton: null };
  const mandos = {};
  for (const [clave, nombre] of [["amplio", "Control amplio"], ["raton", "Ratón y teclado (experimental)"]]) {
    const caja = crear("input"); caja.type = "checkbox";
    const resta = crear("span", "control-resta");
    const lbl = crear("label"); lbl.append(caja, crear("span", "", nombre), resta);
    cuerpo.append(lbl);
    mandos[clave] = { caja, resta };
    caja.addEventListener("change", async () => {
      try { aplicar(await api("/control/activar", { method: "PUT", body: { [clave]: caja.checked, minutos: Number(minutos.value) || 30 } })); }
      catch { cargar(); }
    });
  }
  const filas = crear("ul", "control-lista"), aviso = crear("span", "control-aviso");
  const tipo = crear("select");
  for (const [v, n] of [["app", "Programa (.exe)"], ["host", "Página (dominio)"]]) { const o = crear("option", "", n); o.value = v; tipo.append(o); }
  const valor = crear("input"); valor.type = "text"; valor.maxLength = 253; valor.placeholder = "notepad.exe"; valor.title = "Programa o dominio";
  const mas = crear("button", "", "Añadir"); mas.type = "submit";
  const form = crear("form"); form.append(tipo, valor, mas);
  cuerpo.append(crear("b", "", "Solo en estos programas y páginas"), filas, form, aviso);
  let lista = [];
  async function guardarLista(nueva) {
    aviso.textContent = "";
    try { lista = (await api("/control/lista", { method: "PUT", body: { lista: nueva } })).lista; valor.value = ""; }
    catch (e) { aviso.textContent = e.data?.mensaje || "No pude guardar la lista."; }
    pintarLista();
  }
  function pintarLista() {
    filas.replaceChildren(...lista.map((e, i) => {
      const quitar = crear("button", "", "Quitar"); quitar.type = "button";
      quitar.addEventListener("click", () => guardarLista(lista.filter((_, j) => j !== i)));
      const li = crear("li"); li.append(crear("span", "", e.valor), quitar);
      return li;
    }));
  }
  form.addEventListener("submit", (ev) => { ev.preventDefault(); if (valor.value.trim()) guardarLista([...lista, { tipo: tipo.value, valor: valor.value.trim() }]); });
  panel.addEventListener("toggle", async () => { if (!panel.open) return; try { lista = (await api("/control/lista")).lista; pintarLista(); } catch { /* sin red */ } });
  hueco.append(panel, texto, boton);
  let frenado = false, ocupado = false;

  function pintarMandos() {
    for (const [clave, { caja, resta }] of Object.entries(mandos)) {
      const s = Math.max(0, Math.round(((hasta[clave] || 0) - Date.now()) / 1000));
      const on = !frenado && s > 0;
      caja.checked = on; caja.disabled = frenado;
      resta.textContent = on ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "";
    }
  }
  function aplicar(e) { frenado = !!e.frenado; hasta.amplio = e.amplio_hasta; hasta.raton = e.raton_hasta; if (frenado) avisarFreno(); pintar(); }

  const pintar = (aviso) => {
    pintarMandos();
    hueco.classList.toggle("frenado", frenado);
    boton.textContent = frenado ? "Reanudar" : "FRENO";
    boton.title = frenado ? "Volver a permitir trabajos en el PC" : "Detener todo lo que Jarvis hace en el PC";
    texto.textContent = aviso || (frenado ? "Frenado" : "");
  };
  async function cargar() {
    if (!getToken() || ocupado) { if (!getToken()) hueco.hidden = true; return; }
    try { const e = await api("/control"); hueco.hidden = false; aplicar(e); }
    catch (e) { if (e.status === 401) hueco.hidden = true; }
  }
  boton.addEventListener("click", async () => {
    if (ocupado) return;
    ocupado = true; boton.disabled = true;
    if (!frenado) callar(); // al instante, aunque la red tarde
    try {
      const r = await api(frenado ? "/control/reanudar" : "/control/freno", { method: "POST", body: {} });
      frenado = !!r.frenado;
      hasta.amplio = r.amplio_hasta; hasta.raton = r.raton_hasta;
      pintar(r.fallos?.length ? "Frenado; algo no se pudo cancelar" : "");
    } catch { pintar(frenado ? "No pude reanudar" : "No pude frenar: use el atajo del PC"); }
    finally { ocupado = false; boton.disabled = false; }
  });
  window.addEventListener("jarvis:ws", (e) => { if (e.detail?.type === "control.estado") { aplicar(e.detail); if (frenado) callar(); } });
  window.addEventListener("jarvis:mas", cargar);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) cargar(); });
  setInterval(cargar, 10_000);
  setInterval(() => { if (hasta.amplio || hasta.raton) pintarMandos(); }, 1000);
  pintar(); cargar(); setTimeout(cargar, 2000);
}
