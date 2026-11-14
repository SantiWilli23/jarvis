// Rutas de las fases 4 a 6: Telegram, cron, WhatsApp, conexiones OAuth, herramientas y búsqueda.
import { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import { pkce } from "../connectors/spotify.js";

const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
const page = (res, status, msg) => res.status(status).type("html").send(`<!doctype html><meta charset="utf-8"><title>Jarvis</title><body style="font-family:sans-serif;background:#222;color:#eee;padding:2rem"><p>${msg}</p>`);

export function extensionRoutes(ctx, auth) {
  const r = Router();

  // ---- Telegram ----
  r.post("/telegram/webhook", async (req, res) => {
    const tg = ctx.telegram;
    if (!tg.enabled) return res.status(503).json({ error: "telegram_apagado" });
    if (!tg.checkSecret(req.get("x-telegram-bot-api-secret-token"))) return res.status(401).json({ error: "secreto_invalido" });
    await tg.handleUpdate(req.body); // nunca lanza; siempre 200 para que Telegram no reintente en bucle
    res.json({ ok: true });
  });

  // ---- Cron externo (cron-job.org, GitHub Actions, etc.). Secreto en cabecera, nunca en la URL ----
  r.all("/cron/tick", async (req, res, next) => {
    try {
      const secret = ctx.env.CRON_SECRET || "";
      if (!secret) return res.status(503).json({ error: "cron_apagado" });
      const given = /^Bearer\s+(.+)$/i.exec(req.get("authorization") || "")?.[1] || req.get("x-cron-secret") || "";
      if (!given || !same(given, secret)) return res.status(401).json({ error: "no_autorizado" });
      res.json({ ok: true, ...(await ctx.cron.tick()) });
    } catch (e) { next(e); }
  });

  // ---- WhatsApp Cloud API ----
  r.get("/whatsapp/webhook", (req, res) => {
    const c = ctx.whatsapp.verifyChallenge(req.query);
    return c == null ? res.status(403).end() : res.type("text/plain").send(c);
  });
  r.post("/whatsapp/webhook", async (req, res) => {
    if (!ctx.whatsapp.enabled) return res.status(503).json({ error: "whatsapp_apagado" });
    if (!ctx.whatsapp.validSignature(req.rawBody, req.get("x-hub-signature-256"))) return res.status(401).json({ error: "firma_invalida" });
    try { await ctx.whatsapp.receive(req.body); } catch (e) { console.error("[whatsapp]", e.message); }
    res.json({ ok: true });
  });

  // ---- Conectar cuentas (OAuth). /start pide sesión; /callback es la vuelta del navegador ----
  const redirect = (req, p) => `${(ctx.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "")}/api/connect/${p}/callback`;
  const conn = { google: ctx.google, spotify: ctx.spotify };
  r.get("/connect", auth, async (req, res, next) => {
    try {
      const yt = await ctx.youtube.ready(req.user.id), u = await ctx.youtube.usage(req.user.id);
      res.json({ google: { disponible: ctx.google.enabled, conectado: await ctx.google.connected(req.user.id) }, youtube: { disponible: ctx.youtube.enabled, permiso: yt.permiso, unidades_hoy: u.unidades, tope: u.tope }, spotify: { disponible: ctx.spotify.enabled, conectado: await ctx.spotify.connected(req.user.id) } });
    } catch (e) { next(e); }
  });
  r.all("/connect/:p/start", auth, async (req, res, next) => {
    try {
      const c = conn[req.params.p];
      if (!c) return res.status(404).json({ error: "conector_desconocido" });
      if (!c.enabled) return res.status(503).json({ error: "conector_apagado" });
      const redirectUri = redirect(req, req.params.p);
      const p = req.params.p === "spotify" ? pkce() : null;
      const state = await ctx.oauthStates.create(req.user.id, { provider: req.params.p, redirectUri, verifier: p?.verifier });
      res.json({ url: c.authUrl({ state, redirectUri, challenge: p?.challenge }) }); // se abre en el navegador
    } catch (e) { next(e); }
  });
  r.get("/connect/:p/callback", async (req, res) => {
    const c = conn[req.params.p];
    if (!c || !c.enabled) return page(res, 503, "Conector apagado.");
    const st = await ctx.oauthStates.take(String(req.query.state || ""));
    if (!st || st.provider !== req.params.p) return page(res, 400, "Enlace caducado o inválido. Empiece de nuevo desde Jarvis.");
    if (req.query.error || !req.query.code) return page(res, 400, "No se autorizó la conexión.");
    try {
      const out = await c.completeAuth(st.userId, String(req.query.code), st.redirectUri, st.verifier);
      await ctx.audit.log({ userId: st.userId, action: "conector.conectado", detail: req.params.p });
      const volver = ' <a style="color:#7cf" href="/m">Volver a Jarvis</a>';
      if (req.params.p === "google" && out?.faltan?.some((x) => x.includes("youtube"))) page(res, 200, "Conectado, pero falta el permiso de YouTube: sin él no puedo poner su música. Vuelva a conectar Google y marque la casilla de YouTube." + volver);
      else page(res, 200, "Conectado. Ya puede cerrar esta pestaña y volver a Jarvis." + volver);
    } catch (e) { console.error("[oauth]", req.params.p, e.message); page(res, 502, "No se pudo completar la conexión."); }
  });
  r.delete("/connect/:p", auth, async (req, res, next) => {
    try {
      const c = conn[req.params.p];
      if (!c) return res.status(404).json({ error: "conector_desconocido" });
      const ok = await c.disconnect(req.user.id);
      if (req.params.p === "google") await ctx.youtube.purge(req.user.id); // la caché de música no sobrevive a la desconexión
      res.json({ ok });
    } catch (e) { next(e); }
  });

  // ---- Herramientas y búsqueda web (con sesión) ----
  r.get("/tools", auth, (_req, res) => res.json({ tools: ctx.tools.describe() }));
  r.post("/tools/:name", auth, async (req, res, next) => {
    try {
      const out = await ctx.tools.run({ userId: req.user.id, name: req.params.name, args: req.body || {} });
      res.status(out.status === "error" ? (out.error === "herramienta_desconocida" ? 404 : 400) : out.status === "pendiente_aprobacion" ? 202 : 200).json(out);
    } catch (e) { next(e); }
  });
  r.post("/search", auth, async (req, res, next) => {
    try {
      const out = await ctx.websearch.search({ userId: req.user.id, query: req.body?.query, isPrivate: !!req.body?.private });
      res.status(out.ok ? 200 : out.reason === "privado" ? 403 : 404).json(out);
    } catch (e) { next(e); }
  });

  return r;
}
