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
import { escenaRoutes } from "./routes/escenas.js";
import { pcRoutes, agentPcRoutes } from "./routes/pc.js";
import { pushRoutes } from "./routes/push.js";
import { studioRoutes } from "./routes/studio.js";
import { githubRoutes } from "./routes/github.js";
import { browserRoutes, agentBrowserRoutes } from "./routes/browser.js";
import { agentNavRoutes, navRoutes } from "./routes/nav.js";
import { escolarRoutes } from "./routes/escolar.js";
import { agentMemoriaRoutes } from "./routes/agent-memoria.js";
import { createWake, DETECTOR } from "./routes/wake.js";

const WEB = fileURLToPath(new URL("../web", import.meta.url));

// CSP: solo scripts propios (sin inline; wasm para "Hey Jarvis" en /m), fuentes de Google, WebSocket al mismo servidor, audio/blob del TTS.
export const csp = (host = "") => [
  "default-src 'self'", "script-src 'self' 'wasm-unsafe-eval' https://www.youtube.com https://s.ytimg.com", "frame-src https://www.youtube-nocookie.com https://www.youtube.com", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://i.ytimg.com", "media-src 'self' blob: data:", `connect-src 'self'${host ? ` wss://${host} ws://${host}` : ""} wss://generativelanguage.googleapis.com`,
  "worker-src 'self'", "manifest-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
].join("; ");

// Router de un módulo; si el contexto no lo trae (pruebas con contexto parcial), deja pasar.
const de = (mod, metodo = "routes") => mod?.[metodo]() ?? ((_req, _res, next) => next());

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

  const wake = ctx.wake ?? createWake();
  app.use(healthRoutes());                    // GET /health
  const api = express.Router();
  api.use(healthRoutes());                    // GET /api/health
  api.use("/auth", authRoutes(ctx));
  api.use("/agent/pc", requireAuth(ctx.sessions, { kinds: ["pc"] }), agentPcRoutes(ctx)); // cola de acciones del PC (antes de /agent)
  api.use("/agent/browser", requireAuth(ctx.sessions, { kinds: ["pc"] }), agentBrowserRoutes(ctx)); // antes de /agent
  api.use("/agent/nav", requireAuth(ctx.sessions, { kinds: ["pc"] }), agentNavRoutes(ctx)); // antes de /agent
  api.use("/agent/pro", requireAuth(ctx.sessions, { kinds: ["pc"] }), agentProRoutes(ctx)); // antes de /agent
  api.use("/agent/memoria", requireAuth(ctx.sessions, { kinds: ["pc"] }), agentMemoriaRoutes(ctx)); // antes de /agent
  api.use("/agent/control", requireAuth(ctx.sessions, { kinds: ["pc"] }), de(ctx.control, "agentRoutes")); // antes de /agent
  api.use("/agent/textos", requireAuth(ctx.sessions, { kinds: ["pc"] }), de(ctx.claudeTextos, "agentRoutes")); // antes de /agent
  api.use("/agent", requireAuth(ctx.sessions, { kinds: ["pc"] }), agentRoutes(ctx));
  api.use(stubRoutes());
  const auth = requireAuth(ctx.sessions);
  api.use(extensionRoutes(ctx, auth));        // telegram, cron, whatsapp, connect, tools, search (fases 4-6)
  api.use("/shortcut", requireAuth(ctx.sessions, { kinds: ["shortcut"] }), shortcutRoutes(ctx));
  api.use("/phone", phoneRoutes(ctx));         // cola del iPhone: token "phone" en next/done/disparador, sesión web en actions
  api.use("/pc", auth, pcRoutes(ctx));         // cola del PC desde la web: encolar, ver, aprobar
  api.use("/escenas", auth, escenaRoutes(ctx));
  api.use("/push", auth, pushRoutes(ctx));
  api.use("/devices", auth, deviceRoutes(ctx));
  api.use("/studio", auth, studioRoutes(ctx));
  api.use("/browser", auth, browserRoutes(ctx));
  api.use("/escolar/calendario", auth, de(ctx.escolarCalendario, "routes")); // antes de /escolar
  api.use("/escolar", auth, escolarRoutes(ctx));
  api.use("/control", auth, de(ctx.control, "routes"));
  api.use("/conversa", auth, de(ctx.conversa, "routes")); // charla en vivo (docs/CONVERSA.md)
  api.use("/rutinas", auth, de(ctx.rutinas, "routes"));
  api.use("/repaso", auth, de(ctx.repaso, "routes"));
  api.use("/textos", auth, de(ctx.claudeTextos, "routes"));
  api.use("/memoria-reparto", auth, de(ctx.memoriaReparto, "routes"));
  api.use("/nav", auth, navRoutes(ctx));        // historial y cancelar del navegador de Claude
  api.use("/github", auth, githubRoutes(ctx));
  api.use("/pro", auth, proRoutes(ctx));
  api.use("/chat", auth, chatRoutes(ctx));
  api.use("/settings", auth, settingsRoutes(ctx));
  api.use("/stt", auth, sttRoutes(ctx));
  api.use("/wake", auth, wake.routes());       // modelos de "Hey Jarvis": solo con sesión
  api.use("/tts", auth, ttsRoutes(ctx));
  api.use("/tasks", auth, taskRoutes(ctx));
  api.use("/memory", auth, memoryRoutes(ctx));
  api.use("/approvals", auth, approvalRoutes(ctx));
  api.use(auth, statusRoutes(ctx));           // /status y /audit
  api.use((_req, res) => res.status(404).json({ error: "no_encontrado" }));
  app.use("/api", api);

  app.use(de(ctx.mcp, "routes"));                  // /mcp, /.well-known/*, /oauth/* (antes del estático)
  app.get("/js/wake/detector.js", (_req, res, next) => res.sendFile(DETECTOR, { dotfiles: "allow" }, (e) => { if (e && !res.headersSent) next(e); })); // el mismo del escritorio
  app.get("/vendor/ort/:archivo", wake.vendor);
  app.use(express.static(WEB, { index: "index.html", extensions: ["html"] }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error("[error]", err?.message);
    res.status(500).json({ error: "error_interno" });
  });
  return app;
}
