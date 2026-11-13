import { Router } from "express";

// Widget / Atajo de iPhone: solo acepta tokens de dispositivo tipo "shortcut" (se crea uno en
// POST /api/devices con kind "shortcut"; el token se ve una sola vez).
// Entrada: JSON con `text` (o `dictado`, `input`, `q`) o texto plano. Salida corta para que el Atajo la lea en voz alta:
//   JSON { status, reply, speak }   o   texto plano si se pide ?format=text (o Accept: text/plain).
const MAX_IN = 2000, MAX_REPLY = 400;

// Recorta en un fin de oración para que suene natural al leerlo en voz alta.
export function shortReply(s, max = MAX_REPLY) {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return end > max * 0.4 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "") + "…";
}

export function shortcutRoutes(ctx) {
  const r = Router();
  r.post("/", async (req, res, next) => {
    try {
      const b = req.body && typeof req.body === "object" ? req.body : {};
      const text = [b.text, b.dictado, b.input, b.q].find((v) => typeof v === "string" && v.trim()) || (typeof req.body === "string" ? req.body : "");
      if (!text.trim()) return res.status(400).json({ error: "falta_texto", reply: "No oí nada, señor." });
      if (text.length > MAX_IN) return res.status(413).json({ error: "texto_largo" });
      const out = await ctx.chat.handle({ userId: req.user.id, text, flagPrivate: !!b.private, source: "atajo" });
      const reply = shortReply(out.reply);
      if (req.query.format === "text" || /text\/plain/.test(req.get("accept") || "")) return res.type("text/plain; charset=utf-8").send(reply);
      res.json({ status: out.status, reply, speak: reply });
    } catch (e) { next(e); }
  });
  return r;
}
