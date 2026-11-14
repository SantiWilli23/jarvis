// Controlador del modo ASISTIDO (sin Electron: se prueba con una página falsa).
//   page  = { exec(codigoJs) -> Promise<valor> }   (en Electron: executeJavaScriptInIsolatedWorld)
//   hub   = { step(id, { estado, texto? }) }       (POST /api/agent/browser/tasks/:id/step)
// Flujo: detectar -> preparar (NO envía) -> esperar a que el señor pulse Enviar -> leer la respuesta.
// Al servidor solo viajan estados de la lista cerrada; el texto leído viaja como dato en `texto`.
import { scriptDetectar, scriptPreparar, scriptLeer } from "./dom-scripts.js";

const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runAssist({ task, selectors, page, hub, limites = {}, log = () => {}, degrade = async () => {}, shouldStop = () => false, readNow = () => false, onPromptReady = () => {}, sleep = sleepReal, now = () => Date.now(), pollMs = 3000 }) {
  const t0 = now(), limiteMs = (limites.max_segundos ?? 180) * 1000;
  let pasos = 0;
  const maxPasos = limites.max_pasos ?? 12;
  // Cada informe al servidor es un paso; si el servidor lo rechaza (cerrada, vencida, tope) se detiene todo.
  const informar = async (estado, texto, aviso) => {
    if (++pasos > maxPasos) { log(`tope de pasos (${maxPasos})`); return false; }
    try { await hub.step(task.id, { estado, ...(texto === undefined ? {} : { texto }), ...(aviso ? { aviso } : {}) }); log(`paso: ${estado}`); return true; }
    catch (e) { log(`el servidor rechazó ${estado}: ${e?.data?.error || e?.message}`); return false; }
  };
  const exec = async (codigo) => { try { return await page.exec(codigo); } catch (e) { log(`fallo al leer la página: ${e?.message}`); return undefined; } };
  const parar = async () => { log("detenido por el señor"); await informar("bloqueado"); return { fin: "detenido" }; };

  // Contrato solo_preparar (Pro web): deja el prompt en la caja y termina en prompt_listo; no espera ni lee respuesta.
  // Si no se puede escribir en la caja, copia el prompt al portapapeles y avisa con aviso:"copiado" (degradación suave).
  const soloPreparar = task.solo_preparar === true;
  const copiado = async () => {
    try { await degrade(task); } catch (e) { log(`degradar falló: ${e?.message}`); }
    await informar("prompt_listo", undefined, "copiado");
    return { fin: "prompt_listo", aviso: "copiado" };
  };

  const d = await exec(scriptDetectar(selectors));
  if (shouldStop()) return parar();
  if (d === "bloqueado") { await informar("bloqueado"); return { fin: "bloqueado" }; }          // captcha / Cloudflare / 2FA / aviso: se para y se avisa
  if (d === "necesita_login") { await informar("necesita_login"); return { fin: "necesita_login" }; } // el señor inicia sesión él mismo
  if (d !== "sesion_ok" && soloPreparar) return copiado();
  if (d !== "sesion_ok") { await degrade(task); await informar("degradado"); return { fin: "degradado" }; }
  if (!(await informar("sesion_ok"))) return { fin: "rechazado" };

  const p = await exec(scriptPreparar(selectors, task.prompt));
  if ((!p || !p.ok) && soloPreparar) { log(`no pude preparar: ${p?.motivo || "sin respuesta"}; copio al portapapeles`); return copiado(); }
  if (!p || !p.ok) { log(`no pude preparar: ${p?.motivo || "sin respuesta"}`); await degrade(task); await informar("degradado"); return { fin: "degradado" }; }
  if (!(await informar("prompt_listo"))) return { fin: "rechazado" };
  onPromptReady(task); // la ventana se trae al frente: el señor revisa y pulsa Enviar
  if (soloPreparar) return { fin: "prompt_listo" }; // sin espera ni lectura: el señor envía por su cuenta

  let vistoOcupado = false;
  while (now() - t0 < limiteMs) {
    await sleep(pollMs);
    if (shouldStop()) return parar();
    const b = await exec(scriptDetectar(selectors));
    if (b === "bloqueado") { await informar("bloqueado"); return { fin: "bloqueado" }; }
    if (b === "necesita_login") { await informar("necesita_login"); return { fin: "necesita_login" }; }
    const r = await exec(scriptLeer(selectors));
    if (!r) continue;
    if (r.ocupado) { vistoOcupado = true; continue; }
    // Respuesta terminada: el sitio estuvo generando y ya no, o el señor pidió leerla ahora.
    if (r.texto && (vistoOcupado || readNow())) {
      await informar("respuesta_lista", r.texto);
      return { fin: "respuesta_lista", texto: r.texto };
    }
  }
  log("tiempo máximo: el servidor vence la tarea");
  return { fin: "vencida" };
}
