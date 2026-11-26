// Micrófono a 16 kHz en bloques de 1280 muestras.
(async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
    const ctx = new AudioContext({ sampleRate: 16000 });
    await ctx.audioWorklet.addModule("bloques.js");
    const nodo = new AudioWorkletNode(ctx, "bloques", { numberOfOutputs: 0 });
    nodo.port.onmessage = (e) => window.despertar.audio(e.data);
    ctx.createMediaStreamSource(stream).connect(nodo);
    await ctx.resume();
    stream.getAudioTracks()[0].onended = () => window.despertar.error("se perdió el micrófono");
  } catch (e) {
    window.despertar.error(`no pude usar el micrófono: ${e.name}`);
  }
})();
