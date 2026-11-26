import { Router } from "express";

// /api/agent/memoria/*: solo el PC (token "pc"). Contrato: docs/MEMORIA.md. Lo propuesto va a la zona de revisión.
export function agentMemoriaRoutes(ctx) {
  const r = Router();
  r.post("/proponer", async (req, res, next) => {
    try {
      const { title, body, level, origen } = req.body || {};
      if (typeof body !== "string" || (title != null && typeof title !== "string")) return res.status(400).json({ saved: false, reason: "vacia" });
      const out = await ctx.inbox.propose({ userId: req.user.id, title: title || "", body, level: level || "normal", origen });
      const code = out.saved ? 201 : out.reason === "secreta" ? 200 : out.reason === "bandeja_llena" ? 429 : 400;
      res.status(code).json(out);
    } catch (e) { next(e); }
  });
  return r;
}
