// Estados y tiempos de la escucha permanente de /m. Puro: sin DOM ni audio, con reloj inyectable.
// Bloques de entrada: 16 kHz mono en escala int16 (1280 muestras = 80 ms).
export const TIEMPOS = { sinVoz: 6000, silencio: 1500, seguimiento: 8000, maximo: 30000, gracia: 400, eco: 300, previo: 4800 };
const COLA = 6; // bloques (~480 ms) que se conservan tras la última voz al recortar el silencio final

const rms = (b) => { let s = 0; for (const x of b) s += x * x; return Math.sqrt(s / (b.length || 1)); };
const unir = (partes) => {
  const out = new Float32Array(partes.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of partes) { out.set(p, i); i += p.length; }
  return out;
};

// estados: apagada | esperando | orden | procesando | seguimiento | ocupada | pausada
export function createMaquina({ now = Date.now, alOrden, alCambiar = () => {}, tiempos = TIEMPOS }) {
  let estado = "apagada", piso = 100, previo = [], orden = [], inicio = 0, ultimaVoz = 0, hablo = false, seguidos = 0, fin = null, hastaVoz = 0;
  const umbral = () => Math.max(250, piso * 3);

  function pasar(e) {
    estado = e; inicio = now(); seguidos = 0; fin = null;
    if (e !== "orden") orden = [];
    if (e !== "orden" && e !== "seguimiento") previo = [];
    alCambiar(e);
  }
  function guardarPrevio(b) {
    previo.push(b);
    let n = previo.reduce((s, p) => s + p.length, 0);
    while (previo.length && n - previo[0].length >= tiempos.previo) n -= previo.shift().length;
  }
  function empezarOrden(yaHablo) {
    orden = [...previo];
    hastaVoz = orden.length;
    previo = [];
    hablo = yaHablo;
    pasar("orden");
    ultimaVoz = inicio;
  }
  function cerrar(porSilencio = false) {
    if (!hablo) return pasar("esperando");
    const audio = unir(porSilencio ? orden.slice(0, hastaVoz + COLA) : orden); // menos silencio que subir
    pasar("procesando");
    alOrden(audio);
  }

  function audio(bloque) {
    if (!["esperando", "orden", "seguimiento"].includes(estado)) return;
    const b = Float32Array.from(bloque), nivel = rms(b), voz = nivel > umbral(), t = now();
    // piso de ruido: baja rápido; sube despacio y nunca mientras se graba una orden
    if (nivel < piso) piso = piso * 0.7 + nivel * 0.3;
    else if (estado !== "orden") piso = Math.min(2000, nivel, Math.max(piso, 20) * 1.01);

    if (estado === "esperando") return guardarPrevio(b);
    if (estado === "seguimiento") {
      guardarPrevio(b);
      seguidos = voz && t - inicio >= tiempos.eco ? seguidos + 1 : 0;
      if (seguidos >= 2) empezarOrden(true);
      else if (t - inicio >= tiempos.seguimiento) pasar("esperando");
      return;
    }
    orden.push(b);
    if (voz && t - inicio >= tiempos.gracia) { hablo = true; ultimaVoz = t; hastaVoz = orden.length; } // la cola de "Hey Jarvis" no cuenta
    if (t - inicio >= tiempos.maximo) cerrar();
    else if (!hablo && t - inicio >= tiempos.sinVoz) pasar("esperando");
    else if (hablo && t - ultimaVoz >= tiempos.silencio) cerrar(true);
  }

  return {
    audio,
    estado: () => estado,
    nivel: () => ({ piso, umbral: umbral() }),
    encender() { if (estado === "apagada") pasar("esperando"); },
    apagar() { if (estado !== "apagada") pasar("apagada"); },
    pausar() { if (estado !== "apagada" && estado !== "pausada") pasar("pausada"); },
    reanudar() { if (estado === "pausada") pasar("esperando"); },
    activada() { if (estado === "esperando") empezarOrden(false); },
    // la orden ya se contestó (seguir=true: 8 s para continuar); se aplica cuando la app quede libre
    terminada(seguir) { if (estado === "procesando") fin = !!seguir; },
    ocupado(si) {
      if (estado === "procesando") { if (!si && fin !== null) pasar(fin ? "seguimiento" : "esperando"); return; }
      if (si && ["esperando", "orden", "seguimiento"].includes(estado)) pasar("ocupada");
      else if (!si && estado === "ocupada") pasar("esperando");
    },
  };
}

// WAV PCM 16 bits mono.
export function wav16(muestras, hz = 16000) {
  const v = new DataView(new ArrayBuffer(44 + muestras.length * 2));
  const txt = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  txt(0, "RIFF"); v.setUint32(4, 36 + muestras.length * 2, true); txt(8, "WAVE"); txt(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, hz, true); v.setUint32(28, hz * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  txt(36, "data"); v.setUint32(40, muestras.length * 2, true);
  for (let i = 0; i < muestras.length; i++) v.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(muestras[i]))), true);
  return v.buffer;
}

// Quita la frase de activación (o su cola) del principio de lo transcrito.
export const quitarFrase = (texto) => String(texto ?? "")
  .replace(/^[\s¡¿"'.,-]*(?:(?:hey|hei|ey|oye|ei|he|jey|hay)[\s,.!-]*)?(?:jarvis|yarvis|yarbis|jarbis|harvis|charvis)(?![\p{L}\p{N}])[\s,.;:!-]*/iu, "")
  .trim();
