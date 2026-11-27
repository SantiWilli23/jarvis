// Cadena de openWakeWord, sin Electron ni onnxruntime: audio -> melspectrograma -> embeddings -> clasificador.
// Audio de entrada: 16 kHz mono en escala int16 (-32768..32767), aunque llegue como Float32.
export const BLOQUE = 1280;      // 80 ms
const CONTEXTO = 480;            // 3 saltos de 10 ms que el melspectrograma necesita de lo anterior
const BANDAS = 32, VENTANA_MEL = 76, VENTANA_EMB = 16, EMB = 96;
const MAX_ATRASO = 25 * BLOQUE;  // 2 s: si la CPU no da abasto, se descarta y se empieza de cero

// Sesiones onnxruntime (inyectado) de [melspectrograma, embeddings, clasificador]: Electron y el worker de /m.
export async function modelosDe(ort, [bMel, bEmb, bJarvis]) {
  const crear = (b) => ort.InferenceSession.create(b);
  const mel = await crear(bMel), emb = await crear(bEmb), jarvis = await crear(bJarvis);
  const correr = async (s, datos, forma) => (await s.run({ [s.inputNames[0]]: new ort.Tensor("float32", datos, forma) }))[s.outputNames[0]].data;
  return {
    mel: (audio) => correr(mel, audio, [1, audio.length]),
    embed: (m) => correr(emb, m, [1, 76, 32, 1]),
    clasificar: async (e) => (await correr(jarvis, e, [1, 16, 96]))[0],
  };
}

// mel(Float32Array) -> n x 32; embed(Float32Array 76x32) -> 96; clasificar(Float32Array 16x96) -> puntaje 0..1
export function createDetector({ mel, embed, clasificar, umbral = 0.5, refractarioMs = 2500 }) {
  const refractario = refractarioMs * 16; // en muestras
  let pendiente, previo, mels, embs, generacion = 0, enCola = 0, cola = Promise.resolve();
  let reloj = 0, ultimo = -Infinity; // el antirrebote sobrevive a reiniciar()

  function reiniciar() {
    generacion++;
    pendiente = [];
    previo = new Float32Array(CONTEXTO);
    mels = Array.from({ length: VENTANA_MEL }, () => new Float32Array(BANDAS).fill(1));
    embs = [];
  }
  reiniciar();

  const unir = (filas, ancho) => { const out = new Float32Array(filas.length * ancho); filas.forEach((f, i) => out.set(f, i * ancho)); return out; };

  async function paso(bloque, gen) {
    const audio = new Float32Array(CONTEXTO + BLOQUE);
    audio.set(previo);
    audio.set(bloque, CONTEXTO);
    previo = audio.slice(-CONTEXTO);
    const m = await mel(audio);
    if (gen !== generacion) return false;
    for (let i = 0; i + BANDAS <= m.length; i += BANDAS) mels.push(Float32Array.from(m.subarray(i, i + BANDAS), (x) => x / 10 + 2));
    mels = mels.slice(-VENTANA_MEL);
    const e = await embed(unir(mels, BANDAS));
    if (gen !== generacion) return false;
    embs.push(Float32Array.from(e));
    embs = embs.slice(-VENTANA_EMB);
    if (embs.length < VENTANA_EMB) return false; // calentamiento (~1,3 s)
    const puntaje = await clasificar(unir(embs, EMB));
    if (gen !== generacion || !(puntaje >= umbral) || reloj - ultimo < refractario) return false;
    ultimo = reloj;
    return true;
  }

  // true si en este audio se oyó la frase. Las llamadas se encadenan en orden.
  function procesar(muestras) {
    if (enCola > MAX_ATRASO) reiniciar();
    const gen = generacion, copia = Float32Array.from(muestras);
    enCola += copia.length;
    const turno = cola.then(async () => {
      enCola -= copia.length;
      if (gen !== generacion) return false;
      reloj += copia.length;
      for (const x of copia) pendiente.push(x);
      let oido = false;
      while (gen === generacion && pendiente.length >= BLOQUE) {
        if (await paso(pendiente.splice(0, BLOQUE), gen)) oido = true;
      }
      return oido;
    });
    cola = turno.catch(() => {});
    return turno;
  }

  return { procesar, reiniciar };
}
