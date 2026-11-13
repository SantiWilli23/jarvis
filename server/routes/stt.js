import express, { Router } from "express";

export function sttRoutes(ctx) {
  const r = Router();
  // El cuerpo es el audio crudo (MediaRecorder) con su Content-Type.
  r.post("/", express.raw({ type: () => true, limit: "10mb" }), async (req, res) => {
    try {
      if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: "audio_vacio" });
      const out = await ctx.stt.transcribe(req.body, req.headers["content-type"] || "audio/mp4");
      res.json(out);
    } catch (e) {
      res.status(502).json({ error: "stt_fallo", detalle: e.message });
    }
  });
  return r;
}
