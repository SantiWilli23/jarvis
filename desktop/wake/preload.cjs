// Solo para la ventana oculta de captura (archivo local): la web del hub no tiene este puente.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("despertar", {
  audio: (bloque) => ipcRenderer.send("wake:audio", bloque),
  error: (msg) => ipcRenderer.send("wake:error", msg),
});
