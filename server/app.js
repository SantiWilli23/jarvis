import express from "express";
import { fileURLToPath } from "node:url";
import { requireAuth } from "./auth/middleware.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { deviceRoutes } from "./routes/devices.js";
import { chatRoutes } from "./routes/chat.js";
import { settingsRoutes } from "./routes/settings.js";
import { sttRoutes } from "./routes/stt.js";
import { ttsRoutes } from "./routes/tts.js";
import { taskRoutes } from "./routes/tasks.js";
import { memoryRoutes } from "./routes/memory.js";
import { approvalRoutes } from "./routes/approvals.js";
import { statusRoutes } from "./routes/status.js";
import { shortcutRoutes } from "./routes/shortcut.js";
import { stubRoutes } from "./routes/stubs.js";
import { agentRoutes } from "./routes/agent.js";
import { extensionRoutes } from "./routes/extensions.js";
import { proRoutes } from "./routes/pro.js";
import { agentProRoutes } from "./routes/agent-pro.js";
import { phoneRoutes } from "./routes/phone.js";
import { pcRoutes, agentPcRoutes } from "./routes/pc.js";
import { pushRoutes } from "./routes/push.js";
import { studioRoutes } from "./routes/studio.js";
import { githubRoutes } from "./routes/github.js";
import { browserRoutes, agentBrowserRoutes } from "./routes/browser.js";

const WEB = fileURLToPath(new URL("../web", import.meta.url));

// CSP: solo scripts propios (sin inline), fuentes de Google, WebSocket al mismo servidor, audio/blob del TTS.
export const csp = (host = "") => [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:", "media-src 'self' blob: data:", `connect-src 'self'${host ? ` wss://${host} ws://${host}` : ""}`,
  "worker-src 'self'", "manifest-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
].join("; ");

export function createApp(ctx) {
  const app = express();
  app.disable("x-powered-by");
  // Solo se confía en X-Forwarded-For detrás de un proxy conocido (Render pone RENDER=true; o TRUST_PROXY=1). Si no, req.ip es la conexión real.
  const tp = process.env.TRUST_PROXY ?? (process.env.RENDER ? "1" : "0");
  app.set("trust proxy", /^\d+$/.test(tp) ? Number(tp) : tp === "true" ? 1 : false);
  app.use((req, res, next) => {
    const host = String(req.headers.host || "").replace(/[^\w.:\[\]-]/g, "");
    res.set({
      "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY",
      "Content-Security-Policy": csp(host),
    });
    next();
  });
  app.use(express.json({ limit: "1mb", verify: (req, _res, buf) => { req.rawBody = buf; } })); // rawBody: firma de WhatsApp

  app.use(healthRoutes());                    // GET /health
  const api = express.Router();
  api.use(healthRoutes());                    // GET /api/health
  api.use("/auth", authRoutes(ctx));
  api.use("/agent/pc", requireAuth(ctx.sessions, { kinds: ["pc"] }), agentPcRoutes(ctx)); // cola de acciones del PC (antes de /agent)
  api.use("/agent/browser", requireAuth(ctx.sessions, { kinds: ["pc"] }), agentBrowserRoutes(ctx)); // antes de /agent
  api.use("/agent/pro", requireAuth(ctx.sessions, { kinds: ["pc"] }), agentProRoutes(ctx)); // antes de /agent
  api.use("/agent", requireAuth(ctx.sessions, { kinds: ["pc"] }), agentRoutes(ctx));
  api.use(stubRoutes());
  const auth = requireAuth(ctx.sessions);
  api.use(extensionRoutes(ctx, auth));        // telegram, cron, whatsapp, connect, tools, search (fases 4-6)
  api.use("/shortcut", requireAuth(ctx.sessions, { kinds: ["shortcut"] }), shortcutRoutes(ctx));
  api.use("/phone", phoneRoutes(ctx));         // cola del iPhone: token "phone" en next/done, sesión web en actions
  api.use("/pc", auth, pcRoutes(ctx));         // cola del PC desde la web: encolar, ver, aprobar
  api.use("/push", auth, pushRoutes(ctx));
  api.use("/devices", auth, deviceRoutes(ctx));
  api.use("/studio", auth, studioRoutes(ctx));
  api.use("/browser", auth, browserRoutes(ctx));
  api.use("/github", auth, githubRoutes(ctx));
  api.use("/pro", auth, proRoutes(ctx));
  api.use("/chat", auth, chatRoutes(ctx));
  api.use("/settings", auth, settingsRoutes(ctx));
  api.use("/stt", auth, sttRoutes(ctx));
  api.use("/tts", auth, ttsRoutes(ctx));
  api.use("/tasks", auth, taskRoutes(ctx));
  api.use("/memory", auth, memoryRoutes(ctx));
  api.use("/approvals", auth, approvalRoutes(ctx));
  api.use(auth, statusRoutes(ctx));           // /status y /audit
  api.use((_req, res) => res.status(404).json({ error: "no_encontrado" }));
  app.use("/api", api);

  app.use(express.static(WEB, { index: "index.html", extensions: ["html"] }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error("[error]", err?.message);
    res.status(500).json({ error: "error_interno" });
  });
  return app;
}
