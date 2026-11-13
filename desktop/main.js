// Jarvis para Windows (Electron). Carga la web del hub, bandeja, atajo global, arranque con Windows,
// saludo y el runner que pasa la cola a Claude Code.
//   Prueba de arranque:  npm start -- --smoke-test   (abre, comprueba y cierra solo; usa datos temporales)
import { app, BrowserWindow, Tray, Menu, globalShortcut, safeStorage, shell, nativeImage } from "electron";
import { mkdtempSync } from "node:fs";
import { tmpdir, hostname } from "node:os";
import { join } from "node:path";
import { loadConfig, saveConfig, configPath } from "./lib/config.js";
import { createHubClient } from "./runner/hub-client.js";
import { createWorker } from "./runner/worker.js";
import { createProWorker } from "./runner/pro-worker.js";
import { createOutbox } from "./runner/outbox.js";
import { runDoctor, resolveAgy } from "./runner/doctor.js";

const smoke = process.argv.includes("--smoke-test") || process.env.JARVIS_SMOKE === "1";
if (smoke) app.setPath("userData", mkdtempSync(join(tmpdir(), "jarvis-smoke-")));
const dataDir = app.getPath("userData");

const gotLock = smoke || app.requestSingleInstanceLock(); // instancia única
if (!gotLock) app.quit();
let win = null, tray = null, worker = null, cfg = null, quitting = false, lastStatus = {};

const origin = () => new URL(cfg.hubUrl).origin;

function readToken() {
  if (cfg.agentTokenEnc && safeStorage.isEncryptionAvailable()) {
    try { return safeStorage.decryptString(Buffer.from(cfg.agentTokenEnc, "base64")); } catch { return null; }
  }
  return cfg.agentToken || null;
}
function storeToken(t) {
  if (safeStorage.isEncryptionAvailable()) { cfg.agentTokenEnc = safeStorage.encryptString(t).toString("base64"); cfg.agentToken = null; }
  else { cfg.agentToken = t; }
  saveConfig(dataDir, cfg);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180, height: 780, minWidth: 420, minHeight: 520, backgroundColor: "#0b0f14", title: "Jarvis",
    alwaysOnTop: !!cfg.alwaysOnTop, autoHideMenuBar: true, show: !smoke,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, autoplayPolicy: "no-user-gesture-required" },
  });
  win.loadURL(cfg.hubUrl).catch(() => win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<body style="background:#0b0f14;color:#cfe;font:16px sans-serif;padding:40px">No encuentro el servidor de Jarvis en ${cfg.hubUrl}.<br>Inícielo con <code>npm start</code> en la carpeta del proyecto. Reintento en 10 s…</body>`)}`).then(() => setTimeout(() => win?.loadURL(cfg.hubUrl).catch(() => {}), 10000)));
  // Solo se navega dentro del hub; los enlaces externos se abren en el navegador.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("data:") && new URL(url).origin !== origin()) e.preventDefault(); });
  win.on("close", (e) => { if (!quitting) { e.preventDefault(); win.hide(); } }); // se queda en la bandeja
  win.webContents.on("did-finish-load", () => { if (win.webContents.getURL().startsWith(origin())) onPageReady(); });
}

let greeted = false, enrolling = null;
async function onPageReady() {
  if (!readToken()) enrolling ||= setInterval(tryEnroll, 4000);
  if (cfg.greeting && !greeted) { greeted = true; setTimeout(greet, 1500); }
}
// "Hola señor." con la cadena de voz del servidor (/api/tts) vía la misma función que usa la web.
async function greet() {
  try { await win.webContents.executeJavaScript(`import("/js/voice.js").then(m => m.speak("Hola señor.", () => {}))`); } catch { /* aún sin sesión: la web saluda al primer toque */ }
}
// Enrolamiento: cuando el señor ya inició sesión en la ventana, se pide un token de dispositivo "pc"
// (se muestra una sola vez) y se guarda cifrado. La contraseña nunca pasa por la app.
async function tryEnroll() {
  try {
    const web = await win.webContents.executeJavaScript(`localStorage.getItem("jarvis_token")`);
    if (!web) return;
    const res = await fetch(`${cfg.hubUrl}/api/devices`, { method: "POST", headers: { authorization: `Bearer ${web}`, "content-type": "application/json" }, body: JSON.stringify({ name: `PC ${hostname()}`.slice(0, 60), kind: "pc" }) });
    if (!res.ok) return;
    storeToken((await res.json()).token);
    clearInterval(enrolling); enrolling = null;
    startWorker();
  } catch { /* hub apagado: se reintenta */ }
}

function startWorker() {
  const token = readToken();
  if (!token || worker) return;
  const hub = createHubClient({ baseUrl: cfg.hubUrl, token });
  // Modo Pro: carpetas permitidas = las de config.json carpetas_permitidas.
  let caps = null;
  const folders = () => (cfg.carpetas_permitidas || []).filter(Boolean);
  const refreshCaps = () => runDoctor({ folders: folders(), claudePath: cfg.claudePath, agyPath: cfg.geminiPath }).then((c) => { caps = c; }).catch(() => {});
  refreshCaps(); setInterval(refreshCaps, 5 * 60_000).unref();
  const pro = createProWorker({
    hub, outbox: createOutbox(join(dataDir, "pro-outbox"), { log: (m) => console.log("[jarvis]", m) }),
    allowedFolders: folders, log: (m) => console.log("[jarvis]", m),
    claude: cfg.claudePath ? { command: cfg.claudePath, prefix: [] } : null,
    agy: () => resolveAgy({ configured: cfg.geminiPath }),
    onStatus: (s) => { lastStatus = { ...lastStatus, ...s }; updateTray(); },
  });
  worker = createWorker({
    pro, getCapabilities: () => caps,
    hub, host: hostname(), version: app.getVersion(),
    claude: cfg.claudePath ? { command: cfg.claudePath, prefix: [] } : null,
    folders: null, fallbackCwd: cfg.workFolder || join(app.getPath("documents"), "Jarvis"),
    agy: () => resolveAgy({ configured: cfg.geminiPath }), geminiFolders: (cfg.carpetas_gemini || []).filter(Boolean).length ? cfg.carpetas_gemini.filter(Boolean) : null,
    geminiDefaultDir: join(app.getPath("documents"), "Jarvis", "gemini"),
    log: (m) => console.log("[jarvis]", m),
    onStatus: (s) => { lastStatus = { ...lastStatus, ...s }; updateTray(); },
  });
  worker.start(); // al encender Windows la cola empieza de inmediato y el hub recibe pc_online
}

function show(withMic) {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
  // La web escucha este evento; activa el micrófono como si se tocara el orbe.
  if (withMic) win.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent("jarvis:mic"))`).catch(() => {});
}

function updateTray() {
  if (!tray) return;
  const estado = !lastStatus.online && lastStatus.online !== undefined ? "desconectado" : worker?.isPaused() ? "cola en pausa" : lastStatus.current ? `tarea #${lastStatus.current.seq}` : "en línea";
  tray.setToolTip(`Jarvis · ${estado}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Abrir Jarvis", click: () => show(false) },
    { label: worker?.isPaused() ? "Reanudar cola" : "Pausar cola", enabled: !!worker, click: () => { worker.pause(!worker.isPaused()); updateTray(); } },
    { label: "Siempre visible", type: "checkbox", checked: !!cfg.alwaysOnTop, click: (i) => { cfg.alwaysOnTop = i.checked; win?.setAlwaysOnTop(i.checked); saveConfig(dataDir, cfg); } },
    { label: "Abrir archivo de configuración", click: () => shell.openPath(configPath(dataDir)) },
    { type: "separator" },
    { label: `Estado: ${estado}`, enabled: false },
    { label: "Salir", click: () => { quitting = true; app.quit(); } },
  ]));
}

function iconImage() {
  // Orbe azul 16x16 dibujado en código (sin archivos binarios en el repo).
  const s = 32, buf = Buffer.alloc(s * s * 4);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const d = Math.hypot(x - 15.5, y - 15.5), i = (y * s + x) * 4;
    if (d <= 14) { buf[i] = 0xff; buf[i + 1] = Math.round(0x90 + (14 - d) * 6) % 256; buf[i + 2] = Math.round(0x20 + d * 2); buf[i + 3] = 255; } // BGRA
  }
  return nativeImage.createFromBitmap(buf, { width: s, height: s });
}

app.on("second-instance", () => show(false));
app.on("window-all-closed", () => { /* sigue en la bandeja */ });
app.on("before-quit", () => { quitting = true; });
app.on("will-quit", () => { globalShortcut.unregisterAll(); });

app.whenReady().then(async () => {
  if (!gotLock) return;
  cfg = loadConfig(dataDir);
  createWindow();
  tray = new Tray(iconImage());
  tray.on("click", () => show(false));
  updateTray();

  const ok = globalShortcut.register(cfg.hotkey, () => show(true));
  if (!ok) console.warn(`[jarvis] No pude registrar el atajo ${cfg.hotkey} (otro programa lo usa).`);
  if (!smoke && cfg.autoStart && app.isPackaged) app.setLoginItemSettings({ openAtLogin: true, args: ["--hidden"] });
  if (process.argv.includes("--hidden")) win.hide(); else win.show();

  if (readToken()) startWorker();

  if (smoke) {
    // Comprueba que la ventana cargó, que el atajo se registró y que la bandeja existe; luego cierra.
    const finish = (code, msg) => { console.log(msg); quitting = true; (worker ? worker.stop() : Promise.resolve()).finally(() => app.exit(code)); };
    win.webContents.once("did-finish-load", () => setTimeout(() => finish(0, `SMOKE_OK url=${win.webContents.getURL().slice(0, 40)} atajo=${globalShortcut.isRegistered(cfg.hotkey)} bandeja=${!tray.isDestroyed()}`), 1500));
    setTimeout(() => finish(1, "SMOKE_TIMEOUT"), 9000);
  }
});
