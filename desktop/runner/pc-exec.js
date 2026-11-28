// Ejecutor de las acciones del PC (Ola 1). Todo lo que hace el sistema operativo sale de aquí y solo con:
//  - execFile / spawn con comando y argumentos FIJOS (jamás un shell ni texto del usuario como comando),
//  - PowerShell con scripts FIJOS (-EncodedCommand) en los que solo entran enteros ya validados,
//  - las APIs de Electron/Node para portapapeles, avisos y estado.
// Valida OTRA VEZ los parámetros (pc-spec.js) y exige la aprobación de las acciones de nivel "aprobacion".
import { validateParams, DEFAULT_APPS, PC_ACTIONS, norm } from "./pc-spec.js";
import { controlState } from "./control-state.js";
import { bloqueado, elementoProhibido, entradaValida, objetivoPermitido, NAVEGADORES, NEGADO_PARTE, NEGADO_PALABRA, ELEMENTO_PROHIBIDO } from "./pc-reglas.js";
import { SOLTAR, UI_SCRIPTS, MOTIVOS } from "./pc-ui.js";

const VK = { play_pausa: 0xb3, siguiente: 0xb0, anterior: 0xb1, silencio: 0xad, bajar: 0xae, subir: 0xaf };
const PS_HEAD = "Add-Type -Namespace J -Name K -MemberDefinition '[DllImport(\"user32.dll\")] public static extern void keybd_event(byte b, byte s, uint f, UIntPtr e);'; ";
const PS_BATERIA = "$b = Get-CimInstance Win32_Battery | Select-Object -First 1 EstimatedChargeRemaining, BatteryStatus; if ($b) { $b | ConvertTo-Json -Compress } else { '{}' }";
// Suspender DE VERDAD (no hibernar): SetSuspendState(Suspend, force=false, disableWakeEvent=false).
export const PS_SUSPENDER = "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend',$false,$false)";
const PS_ARGS = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand"];
// Programas instalados (menú Inicio). Lo pedido no entra en el script; el que se abre viaja por J_APPID.
export const PS_PROGRAMAS = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; ConvertTo-Json -Compress -InputObject @(Get-StartApps | Select-Object Name, AppID)";
export const PS_ABRIR = "$ErrorActionPreference='Stop'; Start-Process ('shell:AppsFolder\\' + $env:J_APPID)";
// Siempre a la papelera, y solo en discos fijos (en red o USB Windows borraría para siempre). La ruta solo por J_RUTA.
export const PS_PAPELERA = "$ErrorActionPreference='Stop'; Add-Type -AssemblyName Microsoft.VisualBasic; $p=$env:J_RUTA; " +
  "if(([IO.DriveInfo]::new([IO.Path]::GetPathRoot($p))).DriveType -ne 'Fixed'){throw 'sin papelera'}; " +
  "if(Test-Path -LiteralPath $p -PathType Container){[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p,'OnlyErrorDialogs','SendToRecycleBin')}else{[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p,'OnlyErrorDialogs','SendToRecycleBin')}";

// Coincidencia normalizada y única en el menú Inicio: exacta o, si no, la única que la contiene como palabras.
export function elegirPrograma(lista, nombre) {
  const llano = (s) => norm(s).replace(/\s+/g, " ");
  const q = llano(nombre);
  const todos = (Array.isArray(lista) ? lista : [lista]).filter((p) => p?.Name && p?.AppID);
  let hits = todos.filter((p) => llano(p.Name) === q);
  if (!hits.length && q.length >= 4) hits = todos.filter((p) => ` ${llano(p.Name)} `.includes(` ${q} `));
  return hits.length === 1 ? { programa: hits[0] } : { error: hits.length ? "Hay varios programas con ese nombre." : "No encontré ese programa." };
}
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
export function createPcExecutor({ control = controlState, negados = [], registrar = null, files = null, capture = null, execFile, spawn, clipboard, notify = () => {}, os, statfs = null, platform = process.platform, apps = null, now = () => new Date(), setTimer = setTimeout, clearTimer = clearTimeout, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const appMap = sanitizeApps(apps);
  const timers = new Set();
  const win = () => { if (platform !== "win32") throw new Error("Esta acción solo existe en Windows."); };
  const enCurso = new Set(); // un AbortController por ejecución: stop() mata lo que haya en marcha
  const lanzarPs = (script, opts) => execFile("powershell.exe", [...PS_ARGS, enc(script)], opts);
  const apagado = (def) => (control.frenado() ? "el freno está puesto" : def.requiere && !control[def.requiere]() ? "ese control está apagado" : null);
  // Contexto de una ejecución: cada paso vuelve a mirar el freno y el permiso.
  function contexto(def, signal) {
    const revisar = () => { const m = signal.aborted ? "se detuvo" : apagado(def); if (m) throw new Error(`Detenido: ${m}.`); };
    return {
      revisar,
      ps: async (script, env) => { win(); revisar(); return lanzarPs(script, env ? { signal, env } : { signal }); },
      exec: async (cmd, args) => { win(); revisar(); return execFile(cmd, args, { signal }); },
    };
  }
  const archivos = () => { if (!files) throw new Error("Archivos no configurados en este PC (pc_carpetas)."); return files; };

  async function ui(accion, params, { ps, revisar }) {
    const no = (m) => ({ ok: false, texto: `No lo hice: ${m}.` });
    const entrada = control.lista().find((e) => e?.valor === params.objetivo);
    const e = entrada && entradaValida(entrada, { negados });
    if (!e) return no("ese objetivo no está en la lista autorizada");
    if (accion === "ui_pulsar" && elementoProhibido(params.elemento)) return no(MOTIVOS.elemento_prohibido);
    registrar?.({ accion, detalle: e.valor }); // solo acción y objetivo
    const datos = { tipo: e.tipo, valor: e.valor, navegadores: NAVEGADORES, parte: NEGADO_PARTE, palabra: NEGADO_PALABRA, prohibidos: ELEMENTO_PROHIBIDO, negados,
      elemento: params.elemento, texto: params.texto, tecla: params.tecla };
    let r;
    try { r = JSON.parse((await ps(UI_SCRIPTS[accion], { J_DATOS: JSON.stringify(datos) })).stdout); }
    catch { revisar(); return no("falló el paso en Windows"); } // sin el mensaje: podría repetir lo tecleado
    if (!r?.ok) return no(MOTIVOS[r?.motivo] || "falló el paso en Windows");
    if (!objetivoPermitido(r, e, { negados })) return no(MOTIVOS.fuera_de_objetivo);
    if (accion === "ui_leer") {
      const items = (Array.isArray(r.items) ? r.items : r.items ? [r.items] : []).slice(0, 60);
      return { texto: items.map((i) => `${i.tipo}: ${i.nombre}`).join("\n").slice(0, 2000) || "(no veo controles con nombre)", privado: true };
    }
    return { texto: { ui_pulsar: "Pulsado.", ui_escribir: `Escritos ${params.texto?.length} caracteres.`, ui_tecla: "Tecla enviada." }[accion] };
  }

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
    async multimedia({ valor }, { ps }) {
      await ps(keysScript([[VK[valor], 1]]));
      return { texto: { play_pausa: "Reproducción alternada.", siguiente: "Siguiente.", anterior: "Anterior." }[valor] };
    },
    async volumen({ accion, nivel, pasos }, { ps }) {
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
    async bloquear(_p, { exec }) { await exec("rundll32.exe", ["user32.dll,LockWorkStation"]); return { texto: "Pantalla bloqueada." }; },
    async suspender(_p, { ps }) { await ps(PS_SUSPENDER); return { texto: "Suspendiendo el PC." }; },
    async cancelar_apagado(_p, { exec }) { await exec("shutdown.exe", ["/a"]); return { texto: "Apagado cancelado." }; },
    async archivos_listar({ raiz, ruta }) { if (!files) throw new Error("Archivos no configurados en este PC (pc_carpetas)."); return files.listar(raiz, ruta); },
    async archivos_leer({ raiz, ruta }) { if (!files) throw new Error("Archivos no configurados en este PC (pc_carpetas)."); return { ...(await files.leer(raiz, ruta)), privado: true }; },
    async captura() { if (!capture) throw new Error("La captura no está disponible en este PC."); return { ...(await capture.capturar()), privado: true }; },
    async apagar(_p, { exec }) { await exec("shutdown.exe", ["/s", "/t", "30", "/c", "Jarvis: apagado pedido por el señor"]); return { texto: "Apagando en 30 segundos." }; },
    async reiniciar(_p, { exec }) { await exec("shutdown.exe", ["/r", "/t", "30", "/c", "Jarvis: reinicio pedido por el señor"]); return { texto: "Reiniciando en 30 segundos." }; },
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
    async estado_sistema(_p, { ps }) {
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
    async abrir_programa({ nombre }, { ps }) {
      const prohibido = { ok: false, texto: "Ese programa no se abre desde Jarvis." };
      if (bloqueado(nombre)) return prohibido;
      const lista = JSON.parse((await ps(PS_PROGRAMAS)).stdout || "[]");
      const { programa, error } = elegirPrograma(lista, nombre);
      if (!programa) return { ok: false, texto: error };
      if (bloqueado(programa.Name) || bloqueado(programa.AppID) || /^[a-z]{3,}:/i.test(programa.AppID)) return prohibido;
      await ps(PS_ABRIR, { J_APPID: String(programa.AppID) });
      return { texto: `Abrí ${programa.Name}.` };
    },
    async archivos_mover({ raiz, de, a }, { revisar }) { return archivos().mover(raiz, de, a, revisar); },
    async archivos_crear_carpeta({ raiz, ruta }, { revisar }) { return archivos().crearCarpeta(raiz, ruta, revisar); },
    async archivos_papelera({ raiz, ruta }, { ps }) {
      win();
      const real = await archivos().paraPapelera(raiz, ruta);
      await ps(PS_PAPELERA, { J_RUTA: real });
      return { texto: `${ruta} está en la papelera de reciclaje.` };
    },
    ui_leer: (p, ctx) => ui("ui_leer", p, ctx),
    ui_pulsar: (p, ctx) => ui("ui_pulsar", p, ctx),
    ui_escribir: (p, ctx) => ui("ui_escribir", p, ctx),
    ui_tecla: (p, ctx) => ui("ui_tecla", p, ctx),
    async portapapeles_leer() { const t = String(clipboard.readText() ?? "").slice(0, 2000); return { texto: t || "(el portapapeles está vacío)" }; },
  };

  return {
    appNames: () => Object.keys(appMap),
    stop() {
      for (const t of timers) clearTimer(t); timers.clear();
      for (const ac of enCurso) ac.abort(); enCurso.clear();
      if (platform === "win32") Promise.resolve().then(() => lanzarPs(SOLTAR)).catch(() => {});
    },
    // accion = { id, accion, params, aprobada } tal como la manda el servidor. Devuelve { ok, texto, datos? }.
    async execute({ accion, params, aprobada }) {
      const v = validateParams(accion, params, { defs: PC_ACTIONS, apps: Object.keys(appMap) });
      if (!v.ok) return { ok: false, texto: `Rechazada en el PC: ${v.error}.` };
      if (v.def.nivel === "aprobacion" && aprobada !== true) return { ok: false, texto: "Rechazada en el PC: falta la aprobación." };
      const ac = new AbortController();
      enCurso.add(ac);
      try {
        const m = apagado(v.def);
        if (m) return { ok: false, texto: `Rechazada en el PC: ${m}.` };
        const out = await handlers[accion](v.params, contexto(v.def, ac.signal));
        return { ok: true, ...out };
      } catch (e) {
        return { ok: false, texto: ac.signal.aborted ? "Detenido a mitad." : `Falló: ${String(e.message || e).slice(0, 200)}` };
      } finally { enCurso.delete(ac); }
    },
  };
}
