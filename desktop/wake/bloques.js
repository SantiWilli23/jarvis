// AudioWorklet: agrupa el audio en bloques de 1280 muestras, en escala int16.
registerProcessor("bloques", class extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(1280); this.n = 0; }
  process(entradas) {
    const canal = entradas[0]?.[0];
    if (canal) for (const x of canal) {
      this.buf[this.n++] = x * 32767;
      if (this.n === 1280) { this.port.postMessage(this.buf.slice()); this.n = 0; }
    }
    return true;
  }
});
