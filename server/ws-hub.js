// WebSocket /ws. Se autentica con el PRIMER mensaje {type:"auth", token} (nunca en la URL).
// Eventos hacia el cliente: state, chat.delta, chat.done, task.update, approval.request,
// approval.resolved, providers.update, pc.status, phone.update. Solo dispositivos "web" (lista blanca).
import { WebSocketServer } from "ws";

const EVENTOS = ["state", "chat.delta", "chat.done", "task.update", "approval.request", "approval.resolved", "providers.update", "pc.status", "task.progress", "phone.update"];
const AUTH_TIMEOUT_MS = 5000;

export function createHub({ server, sessions, bus, initial = async () => [] }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const clients = new Set(); // { ws, userId, deviceId }

  server.on("upgrade", (req, socket, head) => {
    if ((req.url || "").split("?")[0] !== "/ws") return; // otros upgrades: no tocar
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (ws) => {
    const c = { ws, userId: null, deviceId: null };
    const timer = setTimeout(() => { if (!c.userId) ws.close(4401, "auth_timeout"); }, AUTH_TIMEOUT_MS);
    ws.on("message", async (raw) => {
      if (c.userId) return; // el cliente no manda nada más en Fase 1
      try {
        const m = JSON.parse(String(raw));
        const s = m?.type === "auth" ? await sessions.verify(m.token) : null;
        if (!s || s.device.kind !== "web") return ws.close(4401, "no_autorizado");
        c.userId = Number(s.user.id); c.deviceId = s.device.id;
        clients.add(c); clearTimeout(timer);
        ws.send(JSON.stringify({ type: "auth.ok" }));
        for (const msg of await initial(c.userId)) ws.send(JSON.stringify(msg));
      } catch { ws.close(4400, "mensaje_invalido"); }
    });
    ws.on("close", () => { clearTimeout(timer); clients.delete(c); });
    ws.on("error", () => {});
  });

  function send(userId, msg) {
    const data = JSON.stringify(msg);
    for (const c of clients) if (c.userId === userId && c.ws.readyState === 1) c.ws.send(data);
  }
  for (const ev of EVENTOS) {
    bus.on(ev, ({ userId, ...rest }) => send(Number(userId), { type: ev, ...rest }));
  }

  return {
    send,
    count: () => clients.size,
    // Cierra los sockets de un dispositivo revocado.
    dropDevice(deviceId) { for (const c of clients) if (c.deviceId === deviceId) c.ws.close(4401, "revocado"); },
    close() { for (const c of clients) c.ws.close(); wss.close(); },
  };
}
