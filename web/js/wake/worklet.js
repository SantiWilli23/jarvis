// AudioWorklet: baja el audio del micrófono a 16 kHz mono y lo entrega en bloques de 1280 muestras (escala int16).
registerProcessor("escucha-16k", class extends AudioWorkletProcessor {
  constructor() { super(); this.paso = sampleRate / 16000; this.pos = 0; this.suma = 0; this.cuenta = 0; this.buf = new Float32Array(1280); this.n = 0; }
  process(entradas) {
    const canal = entradas[0]?.[0];
    if (canal) for (const x of canal) {
      this.suma += x; this.cuenta++; this.pos++;
      if (this.pos < this.paso) continue; // promedio por tramo: filtro suficiente para voz
      this.pos -= this.paso;
      this.buf[this.n++] = (this.suma / this.cuenta) * 32767;
      this.suma = 0; this.cuenta = 0;
      if (this.n === 1280) { this.port.postMessage(this.buf.slice()); this.n = 0; }
    }
    return true;
  }
});
