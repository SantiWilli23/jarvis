// WhatsApp Cloud API oficial de Meta. Apagado sin WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_VERIFY_TOKEN y WHATSAPP_APP_SECRET.
// Recibir: webhook (verificación GET + mensajes POST, firma X-Hub-Signature-256 OBLIGATORIA: exige WHATSAPP_APP_SECRET).
// Enviar: SIEMPRE tras aprobación en el teléfono (lo garantiza el registro de herramientas).
// Lo recibido se guarda como PRIVADO: nunca sale a modelos que no sean Groq o Claude.
import { createHmac, timingSafeEqual } from "node:crypto";
import { run } from "../db/client.js";

const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };

export function createWhatsApp({ env = process.env, fetch: f = globalThis.fetch, db, notify, ownerId, now = () => Date.now() }) {
  const token = env.WHATSAPP_TOKEN || "", phoneId = env.WHATSAPP_PHONE_ID || "", verify = env.WHATSAPP_VERIFY_TOKEN || "";
  const appSecret = env.WHATSAPP_APP_SECRET || "";
  const version = env.WHATSAPP_API_VERSION || "v21.0";
  const enabled = !!(token && phoneId && verify && appSecret); // sin WHATSAPP_APP_SECRET no se puede comprobar la firma: queda apagado

  return {
    enabled,
    // GET de verificación de Meta: devuelve el challenge o null.
    verifyChallenge(q) {
      return enabled && q["hub.mode"] === "subscribe" && q["hub.verify_token"] && same(q["hub.verify_token"], verify) ? String(q["hub.challenge"] ?? "") : null;
    },
    validSignature(rawBody, header) {
      if (!appSecret) return false; // sin app secret nunca se acepta (el conector tampoco se enciende)
      if (!header || !rawBody) return false;
      return same(header, "sha256=" + createHmac("sha256", appSecret).update(rawBody).digest("hex"));
    },
    // Guarda los mensajes entrantes (como privados) y avisa por Telegram.
    async receive(body) {
      let n = 0;
      for (const e of body?.entry || []) for (const ch of e.changes || []) for (const m of ch.value?.messages || []) {
        if (m.type !== "text") continue;
        const conv = await run(db, "INSERT INTO conversations (user_id, title, created_at) VALUES (?,?,?)", [ownerId, `WhatsApp ${m.from}`, now()]);
        await run(db, "INSERT INTO messages (user_id, conversation_id, role, content, provider, private, created_at) VALUES (?,?,?,?,?,1,?)", [ownerId, conv.id, "user", m.text?.body || "", "whatsapp", now()]);
        await notify?.(`WhatsApp de ${m.from}: ${String(m.text?.body || "").slice(0, 500)}`);
        n++;
      }
      return n;
    },
    // Solo la llama la ejecución de una aprobación.
    async send({ to, text }) {
      const dest = String(to).replace(/[^\d]/g, "");
      if (!dest) throw new Error("número inválido");
      const res = await f(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ messaging_product: "whatsapp", to: dest, type: "text", text: { body: String(text).slice(0, 4000) } }),
      });
      if (!res.ok) throw new Error(`WhatsApp HTTP ${res.status}`);
      return res.json();
    },
  };
}
