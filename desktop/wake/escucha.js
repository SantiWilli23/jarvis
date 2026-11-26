// Escucha en reposo: una ventana oculta captura el micrófono y manda bloques al proceso principal,
// donde corren los detectores. El audio no sale del PC ni se guarda. Despertar no autoriza nada.
import { fileURLToPath } from "node:url";
import { BLOQUE } from "./detector.js";

const aqui = (f) => fileURLToPath(new URL(f, import.meta.url));

// crearDetectores() -> [{procesar, reiniciar}]; ocupado() -> Promise<boolean> (Jarvis graba o habla)
export function createEscucha({ BrowserWindow, ipcMain, crearDetectores, ocupado, alDespertar, alError, cada = 300 }) {
  let ventana = null, detectores = [], timer = null, activa = false, pausada = true, turno = 0;

  const pausar = (si) => { if (si && !pausada) detectores.forEach((d) => d.reiniciar()); pausada = si; };
  const propia = (e) => !!ventana && e.sender === ventana.webContents;
  const fallar = (msg) => { apagar(); alError(msg); };

  ipcMain.on("wake:audio", (e, bloque) => {
    if (!propia(e) || pausada || bloque?.length !== BLOQUE) return;
    const mio = turno;
    for (const d of detectores) {
      d.procesar(bloque).then((oido) => {
        if (!oido || mio !== turno || pausada) return;
        pausar(true); // la consulta de ocupado() la reanuda cuando Jarvis quede libre
        alDespertar();
      }, (err) => { if (mio === turno) fallar(err?.message); });
    }
  });
  ipcMain.on("wake:error", (e, msg) => { if (propia(e)) fallar(String(msg).slice(0, 200)); });

  async function encender() {
    if (activa) return;
    activa = true;
    const mio = ++turno;
    let nuevos;
    try { nuevos = await crearDetectores(); }
    catch (err) { if (mio === turno) activa = false; throw err; }
    if (mio !== turno) return; // la apagaron mientras cargaba
    detectores = nuevos;
    ventana = new BrowserWindow({
      show: false, width: 200, height: 100, skipTaskbar: true,
      webPreferences: { preload: aqui("./preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, autoplayPolicy: "no-user-gesture-required" },
    });
    ventana.webContents.on("will-navigate", (e) => e.preventDefault());
    ventana.webContents.on("render-process-gone", () => { if (mio === turno) fallar("se cerró la captura de audio"); });
    ventana.loadFile(aqui("./captura.html")).catch((err) => { if (mio === turno) fallar(err.message); });
    let consultando = false;
    timer = setInterval(async () => {
      if (consultando) return;
      consultando = true;
      try { const o = await ocupado(); if (mio === turno) pausar(!!o); }
      catch { if (mio === turno) pausar(true); }
      finally { consultando = false; }
    }, cada);
  }

  function apagar() {
    turno++;
    activa = false;
    clearInterval(timer);
    pausada = true;
    detectores = [];
    const v = ventana;
    ventana = null;
    if (v && !v.isDestroyed()) v.destroy(); // suelta el micrófono
  }

  return { encender, apagar, encendida: () => activa };
}
