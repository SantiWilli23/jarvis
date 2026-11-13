// Web Push (PWA instalada, iOS 16.4+). Claves VAPID: del entorno, o generadas una vez y guardadas en la base.
// Los avisos no llevan contenido privado: solo "Aprobación pendiente".
import { all, get, run } from "./db/client.js";

export async function loadWebPush() {
  try { const m = await import("web-push"); return m.default?.generateVAPIDKeys ? m.default : m; } catch { return null; }
}

export function createPush({ db, env = process.env, bus, audit, ownerId, webpush, now = () => Date.now() }) {
  let keys = null;
  const subject = env.VAPID_SUBJECT || "mailto:jarvis@localhost";

  async function vapid() {
    if (keys) return keys;
    if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) return (keys = { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY });
    const pub = await get(db, "SELECT value FROM settings WHERE user_id=? AND key='vapid_public'", [ownerId]);
    const pri = await get(db, "SELECT value FROM settings WHERE user_id=? AND key='vapid_private'", [ownerId]);
    if (pub?.value && pri?.value) return (keys = { publicKey: pub.value, privateKey: pri.value });
    if (!webpush) return null;
    const k = webpush.generateVAPIDKeys();
    for (const [key, value] of [["vapid_public", k.publicKey], ["vapid_private", k.privateKey]]) {
      await run(db, "INSERT OR REPLACE INTO settings (user_id, key, value, created_at) VALUES (?,?,?,?)", [ownerId, key, value, now()]);
    }
    return (keys = k);
  }

  const api = {
    async publicKey() { return (await vapid())?.publicKey || null; },
    async subscribe(userId, deviceId, sub) {
      const e = sub?.endpoint, p = sub?.keys?.p256dh, a = sub?.keys?.auth;
      if (typeof e !== "string" || !/^https:\/\//.test(e) || e.length > 1000 || !p || !a) return { ok: false, error: "suscripcion_invalida" };
      await run(db, "DELETE FROM push_subscriptions WHERE endpoint=?", [e]);
      await run(db, "INSERT INTO push_subscriptions (user_id, device_id, endpoint, p256dh, auth, created_at) VALUES (?,?,?,?,?,?)", [userId, deviceId ?? null, e, String(p), String(a), now()]);
      await audit?.log({ userId, action: "push.suscrito", detail: `dispositivo ${deviceId ?? "?"}` });
      return { ok: true };
    },
    async unsubscribe(userId, endpoint) {
      const r = endpoint
        ? await run(db, "DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?", [userId, String(endpoint)])
        : await run(db, "DELETE FROM push_subscriptions WHERE user_id=?", [userId]);
      return { ok: true, borradas: r.changes };
    },
    async count(userId) { return Number((await get(db, "SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id=?", [userId])).n); },
    async notify(userId, payload) {
      if (!webpush) return { sent: 0, removed: 0 };
      const k = await vapid();
      if (!k) return { sent: 0, removed: 0 };
      const subs = await all(db, "SELECT * FROM push_subscriptions WHERE user_id=?", [userId]);
      let sent = 0, removed = 0;
      for (const s of subs) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload),
            { vapidDetails: { subject, publicKey: k.publicKey, privateKey: k.privateKey }, TTL: 3600 });
          sent++;
        } catch (e) {
          if (e?.statusCode === 404 || e?.statusCode === 410) { await run(db, "DELETE FROM push_subscriptions WHERE id=?", [s.id]); removed++; }
          else console.error("[push]", e?.statusCode || e?.message);
        }
      }
      if (sent) await audit?.log({ userId, action: "push.enviado", detail: `${sent}` });
      return { sent, removed };
    },
  };

  // Nueva aprobación pendiente (incluye las de acciones del teléfono, que pasan por approvals.request).
  bus?.on("approval.request", ({ userId, approval }) => {
    api.notify(userId, { title: "Jarvis", body: "Aprobación pendiente", approvalId: approval?.id ?? null }).catch((e) => console.error("[push]", e.message));
  });
  return api;
}
