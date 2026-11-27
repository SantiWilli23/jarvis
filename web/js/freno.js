// Botón de freno (docs/CONTROL.md): detiene todo lo que Jarvis hace en el PC. Reanudar es un toque aparte.
import { api, getToken } from "./api.js";
import { stopSpeaking } from "./voice.js";
import { store, setState } from "./state.js";

// Frenar también corta lo que Jarvis esté diciendo (con toda su cola de partes).
function callar() { stopSpeaking(); if (store.state === "speaking") setState("idle"); }

const hueco = document.getElementById("panel-freno");
if (hueco) {
  const boton = document.createElement("button"); boton.type = "button"; boton.className = "freno-btn";
  const texto = document.createElement("span"); texto.className = "freno-estado"; texto.setAttribute("role", "status");
  hueco.append(texto, boton);
  let frenado = false, ocupado = false;

  const pintar = (aviso) => {
    hueco.classList.toggle("frenado", frenado);
    boton.textContent = frenado ? "Reanudar" : "FRENO";
    boton.title = frenado ? "Volver a permitir trabajos en el PC" : "Detener todo lo que Jarvis hace en el PC";
    texto.textContent = aviso || (frenado ? "Frenado" : "");
  };
  async function cargar() {
    if (!getToken() || ocupado) { if (!getToken()) hueco.hidden = true; return; }
    try { frenado = !!(await api("/control")).frenado; hueco.hidden = false; pintar(); }
    catch (e) { if (e.status === 401) hueco.hidden = true; }
  }
  boton.addEventListener("click", async () => {
    if (ocupado) return;
    ocupado = true; boton.disabled = true;
    if (!frenado) callar(); // al instante, aunque la red tarde
    try {
      const r = await api(frenado ? "/control/reanudar" : "/control/freno", { method: "POST", body: {} });
      frenado = !!r.frenado;
      pintar(r.fallos?.length ? "Frenado; algo no se pudo cancelar" : "");
    } catch { pintar(frenado ? "No pude reanudar" : "No pude frenar: use el atajo del PC"); }
    finally { ocupado = false; boton.disabled = false; }
  });
  window.addEventListener("jarvis:ws", (e) => { if (e.detail?.type === "control.estado") { frenado = !!e.detail.frenado; if (frenado) callar(); pintar(); } });
  window.addEventListener("jarvis:mas", cargar);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) cargar(); });
  setInterval(cargar, 10_000);
  pintar(); cargar(); setTimeout(cargar, 2000);
}
