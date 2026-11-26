// OAuth 2.1 para el conector MCP: PKCE S256 obligatorio, registro dinámico con lista blanca y consentimiento con sesión web.
import express, { Router } from "express";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { get, run } from "../db/client.js";
import { hashToken } from "../auth/sessions.js";
import { requireAuth } from "../auth/middleware.js";

export const MAX_CLIENTES = 20;
export const CODIGO_TTL_MS = 10 * 60 * 1000;
const DIA_MS = 24 * 60 * 60 * 1000;
const FIJAS = new Set(["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"]);
const RE_LOCAL = /^http:\/\/(localhost|127\.0\.0\.1):([1-9]\d{0,4})\/callback$/;
const RE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const RE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const PAGINA = fileURLToPath(new URL("../../web/oauth.html", import.meta.url));

export const redirectPermitida = (u) => typeof u === "string" && (FIJAS.has(u) || Number(RE_LOCAL.exec(u)?.[2]) <= 65535);
const s256 = (v) => createHash("sha256").update(v).digest("base64url");
const limpio = (s) => String(s ?? "").replace(/[^\p{L}\p{N} ._()-]/gu, "").trim().slice(0, 30);
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const baseUrl = (env, req) => String(env?.PUBLIC_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");

export function oauthRoutes({ db, sessions, limiter, audit, env, now = () => Date.now() }) {
  const r = Router();
  const llave = randomBytes(32); // CSRF: se renueva al reiniciar
  const firma = (req, p) => createHmac("sha256", llave).update(JSON.stringify([req.sessionToken, p.client_id, p.redirect_uri, p.code_challenge, p.state])).digest("base64url");
  const sinCache = (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); };
  const web = requireAuth(sessions); // solo sesión web; con cookie y POST exige x-requested-with

  r.get(["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"], (req, res) => {
    const b = baseUrl(env, req);
    res.json({ resource: `${b}/mcp`, authorization_servers: [b], scopes_supported: ["memoria"], bearer_methods_supported: ["header"] });
  });
  r.get("/.well-known/oauth-authorization-server", (req, res) => {
    const b = baseUrl(env, req);
    res.json({
      issuer: b, authorization_endpoint: `${b}/oauth/authorize`, token_endpoint: `${b}/oauth/token`, registration_endpoint: `${b}/oauth/register`,
      response_types_supported: ["code"], grant_types_supported: ["authorization_code"], code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"], scopes_supported: ["memoria"],
    });
  });

  r.post("/oauth/register", sinCache, wrap(async (req, res) => {
    const uris = req.body?.redirect_uris;
    if (!Array.isArray(uris) || !uris.length || uris.length > 5 || !uris.every(redirectPermitida)) return res.status(400).json({ error: "invalid_redirect_uri" });
    const clave = [`mcp-reg:${req.ip}`];
    if ((await limiter.check(clave)).locked) return res.status(429).json({ error: "temporarily_unavailable" });
    await limiter.record(clave, false);
    const activos = async () => Number((await get(db, "SELECT COUNT(*) AS n FROM oauth_clients WHERE revoked_at IS NULL")).n);
    if (await activos() >= MAX_CLIENTES) {
      // Se liberan los que en un día nunca llegaron a autorizarse (si no, cualquiera llenaría el cupo para siempre).
      await run(db, "DELETE FROM oauth_clients WHERE created_at < ? AND id NOT IN (SELECT client_id FROM oauth_codes)", [now() - DIA_MS]);
      if (await activos() >= MAX_CLIENTES) return res.status(429).json({ error: "temporarily_unavailable", error_description: "cupo de clientes lleno" });
    }
    const id = `mcp_${randomBytes(16).toString("hex")}`;
    const name = limpio(req.body?.client_name) || "cliente";
    await run(db, "INSERT INTO oauth_clients (id, name, redirect_uris, created_at) VALUES (?,?,?,?)", [id, name, JSON.stringify(uris), now()]);
    await audit.log({ action: "mcp.cliente_registrado", detail: name });
    res.status(201).json({ client_id: id, client_name: name, redirect_uris: uris, grant_types: ["authorization_code"], response_types: ["code"], token_endpoint_auth_method: "none" });
  }));

  const cliente = (id) => get(db, "SELECT * FROM oauth_clients WHERE id=? AND revoked_at IS NULL", [String(id || "")]);

  // Valida la petición de autorización. Si algo falla NO se redirige a ninguna parte.
  async function pedido(q) {
    const p = {};
    for (const k of ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state"]) p[k] = typeof q?.[k] === "string" ? q[k] : "";
    const c = await cliente(p.client_id);
    if (!c) return { error: "invalid_client" };
    if (!redirectPermitida(p.redirect_uri) || !JSON.parse(c.redirect_uris).includes(p.redirect_uri)) return { error: "invalid_redirect_uri" };
    if (p.response_type !== "code") return { error: "unsupported_response_type" };
    if (p.code_challenge_method !== "S256" || !RE_CHALLENGE.test(p.code_challenge)) return { error: "invalid_request", error_description: "se exige PKCE S256" };
    if (p.state.length > 1000) return { error: "invalid_request" };
    return { p, c };
  }

  r.get("/oauth/authorize", sinCache, wrap(async (req, res) => {
    const v = await pedido(req.query);
    if (v.error) return res.status(400).json(v);
    res.sendFile(PAGINA, { cacheControl: false });
  }));

  // Datos para la pantalla de consentimiento (fetch del mismo origen: así viaja la cookie SameSite=Strict).
  r.get("/oauth/info", sinCache, web, wrap(async (req, res) => {
    const v = await pedido(req.query);
    if (v.error) return res.status(400).json(v);
    res.json({ cliente: v.c.name, client_id: v.c.id, redirect_uri: v.p.redirect_uri, csrf: firma(req, v.p) });
  }));

  r.post("/oauth/approve", sinCache, web, wrap(async (req, res) => {
    const origen = req.get("origin");
    if (origen && origen !== new URL(baseUrl(env, req)).origin) return res.status(403).json({ error: "origen_no_permitido" });
    const v = await pedido(req.body);
    if (v.error) return res.status(400).json(v);
    const a = Buffer.from(String(req.body?.csrf || "")), b = Buffer.from(firma(req, v.p));
    if (a.length !== b.length || !timingSafeEqual(a, b)) return res.status(403).json({ error: "csrf" });
    const url = new URL(v.p.redirect_uri);
    if (req.body?.aprobar === true) {
      const code = randomBytes(32).toString("base64url");
      await run(db, "INSERT INTO oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, scope, expires_at, created_at) VALUES (?,?,?,?,?,?,?,?)",
        [hashToken(code), v.c.id, req.user.id, v.p.redirect_uri, v.p.code_challenge, "memoria", now() + CODIGO_TTL_MS, now()]);
      url.searchParams.set("code", code);
      await audit.log({ userId: req.user.id, action: "mcp.autorizado", detail: v.c.name });
    } else url.searchParams.set("error", "access_denied");
    if (v.p.state) url.searchParams.set("state", v.p.state);
    res.json({ redirect: url.href });
  }));

  r.post("/oauth/token", sinCache, express.urlencoded({ extended: false, limit: "10kb" }), wrap(async (req, res) => {
    const mal = (error) => res.status(400).json({ error });
    if (!req.is("application/x-www-form-urlencoded")) return mal("invalid_request");
    const { grant_type, code, redirect_uri, client_id, code_verifier } = req.body || {};
    if (grant_type !== "authorization_code") return mal("unsupported_grant_type");
    if (![code, redirect_uri, client_id, code_verifier].every((x) => typeof x === "string" && x)) return mal("invalid_request");
    const c = await cliente(client_id);
    if (!c) return mal("invalid_client");
    const h = hashToken(code);
    // Un solo uso: se marca de forma atómica antes de comprobar nada más.
    const usado = await run(db, "UPDATE oauth_codes SET used_at=? WHERE code_hash=? AND used_at IS NULL AND expires_at > ?", [now(), h, now()]);
    if (!usado.changes) return mal("invalid_grant");
    const row = await get(db, "SELECT * FROM oauth_codes WHERE code_hash=?", [h]);
    if (row.client_id !== client_id || row.redirect_uri !== redirect_uri || !RE_VERIFIER.test(code_verifier) || s256(code_verifier) !== row.code_challenge) return mal("invalid_grant");
    const { token, deviceId } = await sessions.create(Number(row.user_id), { name: `MCP: ${c.name}`, kind: "mcp" });
    await audit.log({ userId: Number(row.user_id), action: "dispositivo.creado", detail: `mcp ${deviceId}` });
    res.json({ access_token: token, token_type: "Bearer", scope: "memoria" });
  }));

  return r;
}
