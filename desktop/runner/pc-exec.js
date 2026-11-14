// Ejecutor de las acciones del PC (Ola 1). Todo lo que hace el sistema operativo sale de aquí y solo con:
//  - execFile / spawn con comando y argumentos FIJOS (jamás un shell ni texto del usuario como comando),
//  - PowerShell con scripts FIJOS (-EncodedCommand) en los que solo entran enteros ya validados,
//  - las APIs de Electron/Node para portapapeles, avisos y estado.
// Valida OTRA VEZ los parámetros (pc-spec.js) y exige la aprobación de las acciones de nivel "aprobacion".
import { validateParams, DEFAULT_APPS, PC_ACTIONS } from "./pc-spec.js";

const VK = { play_pausa: 0xb3, siguiente: 0xb0, anterior: 0xb1, silencio: 0xad, bajar: 0xae, subir: 0xaf };
const PS_HEAD = "Add-Type -Namespace J -Name K -MemberDefinition '[DllImport(\"user32.dll\")] public static extern void keybd_event(byte b, byte s, uint f, UIntPtr e);'; ";
const PS_BATERIA = "$b = Get-CimInstance Win32_Battery | Select-Object -First 1 EstimatedChargeRemaining, BatteryStatus; if ($b) { $b | ConvertTo-Json -Compress } else { '{}' }";
const PS_ARGS = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand"];
const enc = (s) => Buffer.from(s, "utf16le").toString("base64");
const int = (n, min, max) => { if (!Number.isInteger(n) || n < min || n > max) throw new Error("entero_fuera_de_rango"); return n; };

// Script fijo: pulsa teclas virtuales. steps = [[vk, veces], ...]; solo enteros.
export function keysScript(steps) {
  return PS_HEAD + steps.map(([vk, n]) => `foreach($i in 1..${int(n, 1, 60)}){[J.K]::keybd_event(${int(vk, 1, 255)},0,0,[UIntPtr]::Zero);[J.K]::keybd_event(${int(vk, 1, 255)},0,2,[UIntPtr]::Zero)}`).join("; ");
}

const pad = (n) => String(n).padStart(2, "0");
const gb = (b) => (b / 1024 ** 3).toFixed(1);

export function sanitizeApps(extra) {
  const out = { ...DEFAULT_APPS };
  if (extra && typeof extra === "object") {
    for (const [name, v] of Object.entries(extra)) {
      if (v && typeof v.cmd === "string" && v.cmd && Array.isArray(v.args || []) && (v.args || []).every((a) => typeof a === "string")) out[String(name).toLowerCase()] = { cmd: v.cmd, args: v.args || [] };
    }
  }
  return out;
}

// deps (todo inyectable para probar sin ejecutar nada real):
//  execFile(cmd, args) -> Promise<{stdout}>, spawn(cmd, args, opts) -> proceso con eventos, clipboard {readText, writeText},
//  notify(titulo, texto), os, statfs(ruta), platform, now, setTimer/clearTimer.
export function createPcExecutor({ execFile, spawn, clipboard, notify = () => {}, os, statfs = null, platform = process.platform, apps = null, now = () => new Date(), setTimer = setTimeout, clearTimer = clearTimeout, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const appMap = sanitizeApps(apps);
  const timers = new Set();
  const win = () => { if (platform !== "win32") throw new Error("Esta acción solo existe en Windows."); };
  const ps = (script) => { win(); return execFile("powershell.exe", [...PS_ARGS, enc(script)]); };

  async function cpuPercent() {
    const a = os.cpus();
    await sleep(400);
    const b = os.cpus();
    let idle = 0, total = 0;
    for (let i = 0; i < b.length; i++) {
      const x = a[i]?.times, y = b[i].times;
      if (!x) continue;
      const di = y.idle - x.idle, dt = Object.keys(y).reduce((s, k) => s + (y[k] - x[k]), 0);
      idle += di; total += dt;
    }
    return total > 0 ? Math.round((1 - idle / total) * 100) : 0;
  }

  const handlers = {
    async multimedia({ valor }) {
      await ps(keysScript([[VK[valor], 1]]));
      return { texto: { play_pausa: "Reproducción alternada.", siguiente: "Siguiente.", anterior: "Anterior." }[valor] };
    },
    async volumen({ accion, nivel, pasos }) {
      if (accion === "silencio") { await ps(keysScript([[VK.silencio, 1]])); return { texto: "Silencio alternado." }; }
      if (accion === "fijar") {
        // Cada pulsación mueve 2 puntos: se baja a 0 y se sube la mitad del nivel.
        const steps = [[VK.bajar, 50]]; if (nivel > 0) steps.push([VK.subir, Math.round(nivel / 2)]);
        await ps(keysScript(steps));
        return { texto: `Volumen fijado cerca del ${nivel}%.` };
      }
      const n = pasos ?? 5;
      await ps(keysScript([[VK[accion], n]]));
      return { texto: `Volumen ${accion === "subir" ? "subido" : "bajado"} ${n * 2}%.` };
    },
    async bloquear() { win(); await execFile("rundll32.exe", ["user32.dll,LockWorkStation"]); return { texto: "Pantalla bloqueada." }; },
    async suspender() { win(); await execFile("rundll32.exe", ["powrprof.dll,SetSuspendState", "0,1,0"]); return { texto: "Suspendiendo el PC." }; },
    async apagar() { win(); await execFile("shutdown.exe", ["/s", "/t", "30", "/c", "Jarvis: apagado pedido por el señor"]); return { texto: "Apagando en 30 segundos." }; },
    async reiniciar() { win(); await execFile("shutdown.exe", ["/r", "/t", "30", "/c", "Jarvis: reinicio pedido por el señor"]); return { texto: "Reiniciando en 30 segundos." }; },
    async temporizador({ minutos, texto }) {
      const ms = int(minutos, 1, 720) * 60_000;
      const t = setTimer(() => { timers.delete(t); notify("Jarvis", texto ? `Aviso: ${texto}` : `Han pasado ${minutos} min.`); }, ms);
      timers.add(t);
      const at = new Date(now().getTime() + ms);
      return { texto: `Aviso programado para las ${pad(at.getHours())}:${pad(at.getMinutes())}.` };
    },
    async abrir_app({ app }) {
      const def = appMap[String(app).toLowerCase()];
      if (!def) throw new Error("Aplicación no permitida en este PC.");
      await new Promise((ok, fail) => {
        const c = spawn(def.cmd, def.args, { detached: true, stdio: "ignore", windowsHide: false, shell: false });
        c.once("error", fail); c.once("spawn", () => { c.unref?.(); ok(); });
      });
      return { texto: `Abrí ${app}.` };
    },
    async estado_sistema() {
      const cpu = await cpuPercent();
      const total = os.totalmem(), libre = os.freemem();
      const datos = { cpu_pct: cpu, ram_usada_gb: Number(gb(total - libre)), ram_total_gb: Number(gb(total)) };
      try { const s = statfs?.(platform === "win32" ? `${process.env.SystemDrive || "C:"}\\` : "/"); if (s) { datos.disco_libre_gb = Number(gb(s.bavail * s.bsize)); datos.disco_total_gb = Number(gb(s.blocks * s.bsize)); } } catch { /* sin disco */ }
      if (platform === "win32") {
        try { const b = JSON.parse((await ps(PS_BATERIA)).stdout || "{}"); if (b.EstimatedChargeRemaining != null) { datos.bateria_pct = Number(b.EstimatedChargeRemaining); datos.cargando = [2, 6, 7, 8, 9].includes(Number(b.BatteryStatus)); } } catch { /* sin batería */ }
      }
      const partes = [`CPU ${datos.cpu_pct}%`, `RAM ${datos.ram_usada_gb}/${datos.ram_total_gb} GB`];
      if (datos.disco_libre_gb != null) partes.push(`disco libre ${datos.disco_libre_gb}/${datos.disco_total_gb} GB`);
      partes.push(datos.bateria_pct != null ? `batería ${datos.bateria_pct}%${datos.cargando ? " (cargando)" : ""}` : "sin batería");
      return { texto: partes.join(", ") + ".", datos };
    },
    async portapapeles_escribir({ texto }) { clipboard.writeText(texto); return { texto: `Copiado al portapapeles (${texto.length} caracteres).` }; },
    async portapapeles_leer() { const t = String(clipboard.readText() ?? "").slice(0, 2000); return { texto: t || "(el portapapeles está vacío)" }; },
  };

  return {
    appNames: () => Object.keys(appMap),
    stop() { for (const t of timers) clearTimer(t); timers.clear(); },
    // accion = { id, accion, params, aprobada } tal como la manda el servidor. Devuelve { ok, texto, datos? }.
    async execute({ accion, params, aprobada }) {
      const v = validateParams(accion, params, { defs: PC_ACTIONS, apps: Object.keys(appMap) });
      if (!v.ok) return { ok: false, texto: `Rechazada en el PC: ${v.error}.` };
      if (v.def.nivel === "aprobacion" && aprobada !== true) return { ok: false, texto: "Rechazada en el PC: falta la aprobación." };
      try {
        const out = await handlers[accion](v.params);
        return { ok: true, ...out };
      } catch (e) {
        return { ok: false, texto: `Falló: ${String(e.message || e).slice(0, 200)}` };
      }
    },
  };
}
