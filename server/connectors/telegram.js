// Telegram (API oficial de bots). Solo responde a los chat_id de TELEGRAM_ALLOWED_CHAT_IDS.
// El webhook exige la cabecera X-Telegram-Bot-Api-Secret-Token igual a TELEGRAM_WEBHOOK_SECRET.
// Apagado si falta cualquiera de las tres variables.
import { timingSafeEqual } from "node:crypto";

const MAX = 4000; // Telegram admite 4096 por mensaje
const eq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };

export function createTelegram({ env = process.env, fetch: f = globalThis.fetch, chat, stt, approvals, bus, tools, ownerId, audit }) {
  const token = env.TELEGRAM_BOT_TOKEN || "";
  const secret = env.TELEGRAM_WEBHOOK_SECRET || "";
  const allowed = String(env.TELEGRAM_ALLOWED_CHAT_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const enabled = !!(token && secret && allowed.length);
  let lastUpdate = 0;

  async function api(method, body) {
    const res = await f(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`Telegram ${method} HTTP ${res.status}`);
    return res.json();
  }
  async function send(chatId, text, extra = {}) {
    const parts = String(text || "…").match(new RegExp(`[\\s\\S]{1,${MAX}}`, "g")) || ["…"];
    for (let i = 0; i < parts.length; i++) await api("sendMessage", { chat_id: chatId, text: parts[i], ...(i === parts.length - 1 ? extra : {}) });
  }
  const card = (a) => ({
    text: `Aprobación #${a.id}\n${a.summary}${a.detail ? "\n" + String(a.detail).slice(0, 400) : ""}`,
    reply_markup: { inline_keyboard: [[{ text: "Aprobar", callback_data: `ap:${a.id}:1` }, { text: "Rechazar", callback_data: `ap:${a.id}:0` }]] },
  });

  // Aviso al dueño (primer chat permitido). No hace nada si Telegram está apagado.
  async function notify(text, extra) {
    if (!enabled) return false;
    try { await send(allowed[0], text, extra); return true; } catch { return false; }
  }
  if (enabled && bus) {
    bus.on("approval.request", ({ approval }) => { if (approval) { const c = card(approval); notify(c.text, { reply_markup: c.reply_markup }); } });
  }

  const AYUDA = "Comandos: /estado, /aprobaciones, /buscar <consulta>, /recordar <minutos> <texto>, /correos, /agenda, /archivos, /suena, /pausa, /siguiente, /telefono <orden>. O escriba o mande una nota de voz.";

  async function command(chatId, text) {
    const [cmd, ...rest] = text.slice(1).split(/\s+/);
    const arg = rest.join(" ").trim();
    const c = cmd.split("@")[0].toLowerCase();
    const callTool = async (name, args) => {
      const out = await tools.run({ userId: ownerId, name, args });
      return out.status === "pendiente_aprobacion" ? `Esperando su aprobación (#${out.approval_id}). Le llegó la tarjeta.` : out.error ? `No pude: ${out.error}` : out.text ?? JSON.stringify(out.data).slice(0, 3000);
    };
    switch (c) {
      case "start": case "ayuda": case "help": return send(chatId, `A sus órdenes, señor. ${AYUDA}`);
      case "estado": return send(chatId, await callTool("jarvis.estado", {}));
      case "aprobaciones": {
        const p = await approvals.pending(ownerId);
        if (!p.length) return send(chatId, "No hay aprobaciones pendientes.");
        for (const a of p) { const k = card(a); await send(chatId, k.text, { reply_markup: k.reply_markup }); }
        return;
      }
      case "buscar": return send(chatId, arg ? await callTool("web.buscar", { query: arg }) : "Uso: /buscar <consulta>");
      case "recordar": {
        const m = /^(\d+)\s+([\s\S]+)$/.exec(arg);
        return send(chatId, m ? await callTool("recordatorio.crear", { en_minutos: Number(m[1]), text: m[2] }) : "Uso: /recordar <minutos> <texto>");
      }
      case "correos": return send(chatId, await callTool("google.correos", { q: arg }));
      case "agenda": return send(chatId, await callTool("google.eventos", {}));
      case "archivos": return send(chatId, await callTool("google.archivos", { q: arg }));
      case "suena": return send(chatId, await callTool("spotify.escuchando", {}));
      case "pausa": return send(chatId, await callTool("spotify.control", { accion: "pausa" }));
      case "telefono": case "teléfono": return send(chatId, arg ? await callTool("telefono.accion", { frase: arg }) : "Uso: /telefono <orden>, por ejemplo: /telefono enciende la linterna · /telefono brillo al 30 · /telefono apaga el bluetooth");
      case "siguiente": return send(chatId, await callTool("spotify.control", { accion: "siguiente" }));
      default: return send(chatId, `No conozco ese comando. ${AYUDA}`);
    }
  }

  async function voiceToText(fileId) {
    const info = await api("getFile", { file_id: fileId });
    const path = info?.result?.file_path;
    if (!path) throw new Error("sin file_path");
    const res = await f(`https://api.telegram.org/file/bot${token}/${path}`);
    if (!res.ok) throw new Error(`descarga HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return (await stt.transcribe(buf, "audio/ogg")).text;
  }

  return {
    enabled, notify, send, api, card, allowedChatIds: allowed,
    checkSecret: (h) => enabled && !!h && eq(h, secret),
    // Procesa una actualización ya autenticada por cabecera. Nunca lanza.
    async handleUpdate(u) {
      try {
        if (typeof u?.update_id === "number") { if (u.update_id <= lastUpdate) return { ignored: "repetido" }; lastUpdate = u.update_id; }
        const cb = u?.callback_query;
        if (cb) {
          const chatId = String(cb.message?.chat?.id ?? cb.from?.id ?? "");
          if (!allowed.includes(chatId)) return { ignored: "chat_no_permitido" };
          const m = /^ap:(\d+):([01])$/.exec(cb.data || "");
          if (!m) return { ignored: "callback_invalido" };
          const a = await approvals.decide(ownerId, Number(m[1]), m[2] === "1");
          await api("answerCallbackQuery", { callback_query_id: cb.id, text: a ? (m[2] === "1" ? "Aprobado" : "Rechazado") : "Ya estaba resuelta" });
          if (cb.message) await api("editMessageReplyMarkup", { chat_id: cb.message.chat.id, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } });
          return { callback: a?.status || "no_pendiente" };
        }
        const msg = u?.message;
        if (!msg) return { ignored: "sin_mensaje" };
        const chatId = String(msg.chat?.id ?? "");
        if (!allowed.includes(chatId)) { await audit?.log({ userId: ownerId, action: "telegram.chat_rechazado", detail: chatId }); return { ignored: "chat_no_permitido" }; }
        let text = msg.text;
        let prefix = "";
        if (!text && (msg.voice || msg.audio)) {
          text = await voiceToText((msg.voice || msg.audio).file_id);
          prefix = text ? `Le oí: "${text}"\n\n` : "";
          if (!text) return send(chatId, "No le entendí nada, señor.");
        }
        if (!text) return { ignored: "tipo_no_soportado" };
        if (text.startsWith("/") && !/^\/claude\b/i.test(text)) { await command(chatId, text); return { command: true }; }
        const out = await chat.handle({ userId: ownerId, text, source: "telegram" });
        await send(chatId, prefix + out.reply);
        return { reply: true, status: out.status };
      } catch (e) {
        console.error("[telegram]", e.message);
        return { error: true };
      }
    },
  };
}
