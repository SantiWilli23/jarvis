// Escucha permanente de /m: tocar el orbe la prende o apaga. Se espera "Hey Jarvis" en el propio teléfono;
// solo el audio de la orden va a /api/stt. No se reactiva sola al abrir la app.
import { api, getToken } from "../api.js";
import { createMaquina, wav16, quitarFrase } from "./maquina.js";

// Va en #slabel: en la vista móvil #smodel está oculto.
const TEXTO = {
  cargando: "Preparando la escucha…",
  esperando: "Atento: di «Hey Jarvis»",
  orden: "Escuchando",
  seguimiento: "Siga hablando",
  ocupada: "En espera",
  procesando: "En espera",
  pausada: "Pausado: toca para reanudar",
  apagada: "En espera",
};

export function iniciarEscucha({ say, transcribe, converse, ocupada, setState, store, subscribe, desbloquearVoz }) {
  const $ = (id) => document.getElementById(id);
  const depurar = new URLSearchParams(location.search).get("debug") === "1";
  let ac = null, stream = null, nodo = null, worker = null, listo = null, candado = null, timer = null;
  let turno = 0, gen = 0, cargando = false, reanudando = false, ultimoBloque = 0, puntaje = 0, maximo = 0, error = "";

  const maquina = createMaquina({ alCambiar, alOrden });

  /* ---------- pantalla ---------- */
  const panel = depurar ? document.body.appendChild(document.createElement("pre")) : null;
  if (panel) panel.style.cssText = "position:fixed;left:6px;top:64px;z-index:20;margin:0;padding:6px;font:11px monospace;background:#000c;color:#9fe;pointer-events:none;white-space:pre-wrap;max-width:90vw";
  function depuracion() {
    if (!panel) return;
    const n = maquina.nivel();
    panel.textContent = `estado: ${cargando ? "cargando" : maquina.estado()}\npuntaje: ${puntaje.toFixed(2)} (máx ${maximo.toFixed(2)})\nruido: ${Math.round(n.piso)} umbral: ${Math.round(n.umbral)}\naudio: ${ac?.state ?? "-"}\nerror: ${error || "-"}`;
  }
  function pintar() {
    const e = cargando ? "cargando" : maquina.estado();
    if (store.state === "idle" || (store.state === "listening" && e === "orden")) {
      $("slabel").textContent = TEXTO[e];
    }
    $("orb").setAttribute("aria-label", e === "apagada" ? "Orbe de Jarvis, toque para prender la escucha" : e === "pausada" ? "Orbe de Jarvis, toque para reanudar" : "Orbe de Jarvis, toque para apagar la escucha");
    depuracion();
  }
  const aviso = (msg) => { error = msg; say("Jarvis", msg); depuracion(); };

  function alCambiar(e) {
    if (e === "esperando") { gen++; worker?.postMessage({ tipo: "reiniciar" }); }
    if (e === "esperando" || e === "seguimiento") ultimoBloque = Date.now();
    if (e === "orden") { setState("listening"); say("Usted", "…le escucho."); }
    else if (store.state === "listening" && !ocupada()) setState("idle");
    pintar();
  }

  /* ---------- micrófono ---------- */
  function soltarMic() {
    nodo?.disconnect(); nodo = null;
    stream?.getTracks().forEach((t) => t.stop()); stream = null;
  }
  async function abrirMic() {
    const mio = turno;
    soltarMic();
    const s = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    if (mio !== turno) return void s.getTracks().forEach((t) => t.stop());
    stream = s;
    await Promise.race([ac.resume(), new Promise((r) => setTimeout(r, 1500))]); // iOS puede dejarlo colgado sin un toque
    if (mio !== turno) return;
    if (ac.state !== "running") throw new Error("audio_suspendido");
    nodo = new AudioWorkletNode(ac, "escucha-16k", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    nodo.port.onmessage = ({ data }) => {
      ultimoBloque = Date.now();
      if (maquina.estado() === "esperando") worker?.postMessage({ tipo: "audio", bloque: data, gen });
      maquina.audio(data);
      depuracion();
    };
    ac.createMediaStreamSource(stream).connect(nodo);
    nodo.connect(ac.destination); // salida muda: mantiene vivo el worklet en Safari
    ultimoBloque = Date.now();
  }

  /* ---------- detector ---------- */
  function cargarDetector() {
    if (listo) return listo;
    listo = (async () => {
      const info = await api("/wake/estado");
      if (!info.ort) throw new Error("Al servidor le falta onnxruntime-web, señor.");
      if (info.faltan.length) throw new Error("Faltan los modelos de «Hey Jarvis» en el servidor, señor: " + info.faltan.join(", "));
      worker = new Worker("/js/wake/worker.js", { type: "module" });
      await new Promise((bien, mal) => {
        worker.onerror = () => mal(new Error("No pude arrancar el detector en este teléfono, señor."));
        worker.onmessage = ({ data }) => {
          if (data.tipo === "listo") bien();
          else if (data.tipo === "error") {
            const msg = "Falló el detector, señor: " + data.msg;
            mal(new Error(msg));
            if (maquina.estado() !== "apagada") { apagar(); worker?.terminate(); worker = null; listo = null; aviso(msg); }
          }
          else if (data.tipo === "puntaje") { puntaje = data.puntaje; maximo = Math.max(maximo, puntaje); depuracion(); }
          else if (data.tipo === "oido" && data.gen === gen && !ocupada()) maquina.activada();
        };
        worker.postMessage({ tipo: "cargar", info, token: getToken(), depurar });
      });
    })().catch((e) => { worker?.terminate(); worker = null; listo = null; throw e; });
    return listo;
  }

  /* ---------- orden ---------- */
  async function alOrden(muestras) {
    const mio = turno;
    let seguir = false;
    setState("thinking");
    try {
      const { text } = await transcribe(new Blob([wav16(muestras)], { type: "audio/wav" }));
      if (mio !== turno) { if (store.state === "thinking") setState("idle"); return; } // apagada: la orden se descarta
      const orden = quitarFrase(text);
      setState("idle");
      if (orden) { await converse(orden, false); seguir = true; }
    } catch {
      setState("idle");
      if (mio === turno) say("Jarvis", "Falló la transcripción, señor.");
    }
    if (mio === turno) maquina.terminada(seguir);
  }

  /* ---------- prender, pausar, apagar ---------- */
  async function pantalla() {
    try {
      if (candado && !candado.released) return;
      const c = await navigator.wakeLock?.request("screen");
      if (maquina.estado() === "apagada") c?.release(); else candado = c;
    } catch { error = "no pude mantener la pantalla encendida"; }
  }
  function vigilar() {
    maquina.ocupado(ocupada());
    // el micrófono puede morir (otra grabación, llamada): se reabre
    if (["esperando", "orden", "seguimiento"].includes(maquina.estado()) && Date.now() - ultimoBloque > 3000) { maquina.pausar(); reanudar(); }
    pintar();
  }
  async function reanudar() {
    if (reanudando || document.hidden) return;
    reanudando = true;
    const mio = turno;
    try {
      await abrirMic();
      if (mio === turno && !document.hidden) { maquina.reanudar(); pantalla(); }
    } catch { soltarMic(); error = "toca el orbe para reanudar"; }
    finally { reanudando = false; pintar(); }
  }
  async function encender() {
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode || !window.Worker) return aviso("Este navegador no permite la escucha permanente, señor.");
    const mio = ++turno;
    cargando = true; error = ""; maximo = 0;
    pintar();
    try {
      ac = new AudioContext(); // dentro del toque (iOS)
      ac.resume().catch(() => {});
      await ac.audioWorklet.addModule("/js/wake/worklet.js");
      if (mio !== turno) return;
      await abrirMic();
      if (mio !== turno) return;
      await cargarDetector();
      if (mio !== turno) return;
      cargando = false;
      maquina.encender();
      timer = setInterval(vigilar, 250);
      pantalla();
      if (document.hidden) { maquina.pausar(); soltarMic(); }
    } catch (e) {
      if (mio !== turno) return;
      apagar();
      aviso(e?.name === "NotAllowedError" ? "No tengo permiso para el micrófono, señor. Revise los ajustes de Safari."
        : e?.message === "audio_suspendido" ? "El audio no arrancó, señor. Toque el orbe otra vez." : e?.message || "No pude prender la escucha, señor.");
    }
  }
  function apagar() {
    turno++; cargando = false;
    clearInterval(timer);
    maquina.apagar();
    soltarMic();
    ac?.close().catch(() => {}); ac = null;
    candado?.release().catch(() => {}); candado = null;
    pintar();
  }

  $("orb").addEventListener("click", () => {
    desbloquearVoz();
    store.greeted = true;
    const e = maquina.estado();
    if (cargando) apagar();
    else if (e === "apagada") encender();
    else if (e === "pausada") { ac?.resume().catch(() => {}); reanudar(); }
    else apagar();
  });
  document.addEventListener("visibilitychange", () => {
    if (maquina.estado() === "apagada") return;
    if (document.hidden) { maquina.pausar(); soltarMic(); }
    else reanudar();
  });
  window.addEventListener("pagehide", apagar);
  subscribe((what) => { if (what === "state") pintar(); });
  $("hint").textContent = "Toque el orbe para escuchar «Hey Jarvis»; el micrófono graba una sola orden.";
  pintar();
  return { apagar };
}
