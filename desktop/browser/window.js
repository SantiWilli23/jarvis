// Ventana "Navegador de Jarvis" (Electron). NO se puede probar sin Electron: la lógica probada está en assist.js y dom-scripts.js.
// Cada sitio vive en su WebContentsView con partición persistente propia (la sesión la inicia el señor).
// Los sitios cargan SIN preload, con sandbox y contextIsolation. La barra de arriba (con Detener) es otra vista local
// cuyos botones son enlaces jarvis-cmd:... que main intercepta (tampoco necesita preload).
import { BaseWindow, WebContentsView, shell, clipboard } from "electron";
import selectors from "./selectors.json" with { type: "json" };

const MUNDO = 1000; // mundo aislado donde corren los scripts fijos
const ALTO_BARRA = 48;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const SITIOS = Object.fromEntries(Object.entries(selectors.sitios).map(([id, s]) => [id, { id, ...s }]));

const barraHtml = () => `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#31353d;color:#f2f4f7;font:13px system-ui,sans-serif;display:flex;gap:6px;align-items:center;padding:6px 8px;height:36px}
a{color:#f2f4f7;background:#3b4049;border:1px solid #50555f;padding:7px 10px;text-decoration:none;font-weight:600}
a.stop{background:#a02030;border-color:#ff4d5e}a.sel{border-color:#3fd8ff}#st{margin-left:auto;color:#b4bac3}</style>
${Object.values(SITIOS).map((s) => `<a href="jarvis-cmd:sitio:${esc(s.id)}" id="s-${esc(s.id)}">${esc(s.nombre)}</a>`).join("")}
<a href="jarvis-cmd:leer">Leer respuesta</a><a class="stop" href="jarvis-cmd:detener">Detener</a><span id="st">Inicie sesión usted mismo; Jarvis nunca escribe contraseñas.</span>`)}`;

export function createBrowserWindow({ log = () => {}, onDetener = () => {}, onLeer = () => {} } = {}) {
  let win = null, barra = null, actual = null;
  const vistas = new Map();

  const ajustar = () => {
    if (!win) return;
    const { width, height } = win.getContentBounds();
    barra.setBounds({ x: 0, y: 0, width, height: ALTO_BARRA });
    const v = vistas.get(actual);
    if (v) v.setBounds({ x: 0, y: ALTO_BARRA, width, height: Math.max(0, height - ALTO_BARRA) });
  };
  const estado = (t) => barra?.webContents.executeJavaScript(`document.getElementById("st").textContent=${JSON.stringify(String(t).slice(0, 160))}`).catch(() => {});

  function abrir() {
    if (win && !win.isDestroyed()) { win.show(); win.focus(); return win; }
    win = new BaseWindow({ width: 1180, height: 800, title: "Navegador de Jarvis", backgroundColor: "#0b0f14" });
    barra = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    win.contentView.addChildView(barra);
    barra.webContents.loadURL(barraHtml());
    barra.webContents.on("will-navigate", (e, url) => {
      e.preventDefault();
      if (!url.startsWith("jarvis-cmd:")) return;
      const [, cmd, arg] = url.split(":");
      if (cmd === "sitio" && SITIOS[arg]) mostrar(arg);
      else if (cmd === "detener") onDetener();
      else if (cmd === "leer") onLeer();
    });
    win.on("resize", ajustar);
    win.on("closed", () => { win = null; barra = null; vistas.clear(); actual = null; });
    return win;
  }

  function vista(id) {
    let v = vistas.get(id);
    if (v) return v;
    const s = SITIOS[id];
    if (!s) throw new Error("sitio_desconocido");
    // Sin preload, aislado y con partición persistente propia por sitio (sesión del señor, no de Jarvis).
    v = new WebContentsView({ webPreferences: { partition: s.particion, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
    // Los enlaces que abren ventana nuevas van al navegador del sistema; la navegación queda en https.
    v.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: "deny" }; });
    v.webContents.on("will-navigate", (e, url) => { if (!/^https:/.test(url)) e.preventDefault(); });
    vistas.set(id, v);
    v.webContents.loadURL(s.url).catch((e) => log(`no cargó ${id}: ${e?.message}`));
    return v;
  }

  function mostrar(id) {
    abrir();
    const v = vista(id);
    if (actual && actual !== id) win.contentView.removeChildView(vistas.get(actual));
    if (actual !== id) win.contentView.addChildView(v);
    actual = id; ajustar();
    barra.webContents.executeJavaScript(`document.querySelectorAll("a").forEach(a=>a.classList.toggle("sel",a.id==="s-${id}"))`).catch(() => {});
    return v;
  }

  return {
    abrir, mostrar, estado, SITIOS,
    // Interfaz "page" para assist.js: el código corre en un mundo aislado de la página.
    page(id) {
      const v = mostrar(id);
      return { exec: (code) => v.webContents.executeJavaScriptInIsolatedWorld(MUNDO, [{ code }]) };
    },
    async cargar(id) {
      const v = mostrar(id);
      const wc = v.webContents;
      if (wc.isLoading()) await new Promise((r) => { wc.once("did-stop-loading", r); setTimeout(r, 20000); });
      await new Promise((r) => setTimeout(r, 1500)); // deja que pinte la app de página única
    },
    // Degradación: si un selector falla, se copia el prompt y se deja el sitio abierto.
    degradar(id, prompt) { clipboard.writeText(prompt); mostrar(id); win?.show(); estado("Copié el prompt al portapapeles: péguelo y envíelo usted."); },
    alFrente() { if (win) { win.show(); win.focus(); } },
    cerrar() { if (win && !win.isDestroyed()) win.close(); },
  };
}
