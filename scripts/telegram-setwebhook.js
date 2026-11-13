// Registra el webhook de Telegram. Uso:  npm run telegram:setwebhook -- https://su-app.onrender.com
// Lee TELEGRAM_BOT_TOKEN y TELEGRAM_WEBHOOK_SECRET de .env (nunca los imprime).
import "dotenv/config";

const base = (process.argv[2] || process.env.PUBLIC_URL || "").replace(/\/+$/, "");
const token = process.env.TELEGRAM_BOT_TOKEN, secret = process.env.TELEGRAM_WEBHOOK_SECRET;
if (!/^https:\/\//.test(base)) { console.error("Falta la URL pública https (argumento o PUBLIC_URL). Telegram solo acepta https."); process.exit(1); }
if (!token || !secret) { console.error("Faltan TELEGRAM_BOT_TOKEN y/o TELEGRAM_WEBHOOK_SECRET en .env."); process.exit(1); }
if (!/^[A-Za-z0-9_-]{1,256}$/.test(secret)) { console.error("TELEGRAM_WEBHOOK_SECRET solo admite letras, números, _ y - (1 a 256)."); process.exit(1); }

const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ url: `${base}/api/telegram/webhook`, secret_token: secret, allowed_updates: ["message", "callback_query"], drop_pending_updates: true }),
});
const j = await res.json().catch(() => ({}));
console.log(j.ok ? `Webhook registrado en ${base}/api/telegram/webhook` : `Telegram respondió error: ${j.description || res.status}`);
process.exit(j.ok ? 0 : 1);
