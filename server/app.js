import express from "express";
import { fileURLToPath } from "node:url";
import { requireAuth } from "./auth/middleware.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { deviceRoutes } from "./routes/devices.js";
import { chatRoutes } from "./routes/chat.js";
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
import { phoneRoutes } from "./routes/phone.js";
import { pushRoutes } from "./routes/push.js";

const WEB = fileURLToPath(new URL("../web", import.meta.url));

export function createApp(ctx) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1); // detrás de Render: la IP real viene en X-Forwarded-For
  app.use((_req, res, next) => {
    res.set({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY" });
    next();
  });
  app.use(express.json({ limit: "1mb", verify: (req, _res, buf) => { req.rawBody = buf; } })); // rawBody: firma de WhatsApp

  app.use(healthRoutes());                    // GET /health
  const api = express.Router();
  api.use(healthRoutes());                    // GET /api/health
  api.use("/auth", authRoutes(ctx));
  api.use("/agent", requireAuth(ctx.sessions, { kinds: ["pc"] }), agentRoutes(ctx));
  api.use(stubRoutes());
  const auth = requireAuth(ctx.sessions);
  api.use(extensionRoutes(ctx, auth));        // telegram, cron, whatsapp, connect, tools, search (fases 4-6)
  api.use("/shortcut", requireAuth(ctx.sessions, { kinds: ["shortcut"] }), shortcutRoutes(ctx));
  api.use("/phone", phoneRoutes(ctx));         // cola del iPhone: token "phone" en next/done, sesión web en actions
  api.use("/push", auth, pushRoutes(ctx));
  api.use("/devices", auth, deviceRoutes(ctx));
  api.use("/chat", auth, chatRoutes(ctx));
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
