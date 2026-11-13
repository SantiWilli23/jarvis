// Conector Google (Gmail, Calendar, Drive) con OAuth 2.0 propio. Los tokens se guardan cifrados.
// Apagado si faltan GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET o CONNECTIONS_KEY.
// Alcances mínimos: leer correo, ENVIAR correo, eventos de calendario, metadatos de Drive (solo lectura).
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
];
const NAME = "google";
const clean = (s) => String(s ?? "").replace(/[\r\n]+/g, " ").trim(); // evita inyectar cabeceras

export function createGoogle({ env = process.env, fetch: f = globalThis.fetch, connections, crypto, now = () => Date.now() }) {
  const id = env.GOOGLE_CLIENT_ID || "", secret = env.GOOGLE_CLIENT_SECRET || "";
  const enabled = !!(id && secret && crypto?.enabled);

  async function token(body) {
    const res = await f("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: id, client_secret: secret, ...body }) });
    if (!res.ok) throw new Error(`Google token HTTP ${res.status}`);
    return res.json();
  }
  async function accessToken(userId) {
    const c = await connections.load(userId, NAME);
    if (!c) throw new Error("Google no está conectado");
    if (c.expires_at > now() + 30_000) return c.access_token;
    const t = await token({ grant_type: "refresh_token", refresh_token: c.refresh_token });
    await connections.save(userId, NAME, { ...c, access_token: t.access_token, expires_at: now() + (t.expires_in || 3600) * 1000 });
    return t.access_token;
  }
  async function api(userId, url, opts = {}) {
    const res = await f(url, { ...opts, headers: { ...(opts.body ? { "content-type": "application/json" } : {}), authorization: `Bearer ${await accessToken(userId)}` } });
    if (!res.ok) throw new Error(`Google HTTP ${res.status}`);
    return res.json();
  }
  const hdr = (m, n) => m.payload?.headers?.find((h) => h.name.toLowerCase() === n)?.value || "";

  return {
    enabled, name: NAME,
    connected: (userId) => (enabled ? connections.connected(userId, NAME) : false),
    authUrl({ state, redirectUri }) {
      const p = new URLSearchParams({ client_id: id, redirect_uri: redirectUri, response_type: "code", scope: GOOGLE_SCOPES.join(" "), access_type: "offline", prompt: "consent", state });
      return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
    },
    async completeAuth(userId, code, redirectUri) {
      const t = await token({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
      if (!t.refresh_token) throw new Error("Google no devolvió refresh_token");
      await connections.save(userId, NAME, { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: now() + (t.expires_in || 3600) * 1000, scope: t.scope });
    },
    disconnect: (userId) => connections.remove(userId, NAME),
    // --- lectura (automática) ---
    async listEmails(userId, { q = "", max = 5 } = {}) {
      const n = Math.min(Math.max(Number(max) || 5, 1), 15);
      const l = await api(userId, `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${n}${q ? `&q=${encodeURIComponent(q)}` : ""}`);
      const out = [];
      for (const m of l.messages || []) {
        const d = await api(userId, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
        out.push({ id: m.id, from: hdr(d, "from"), subject: hdr(d, "subject"), date: hdr(d, "date"), snippet: d.snippet || "" });
      }
      return out;
    },
    async listEvents(userId, { days = 7, max = 10 } = {}) {
      const t0 = new Date(now()), t1 = new Date(now() + Number(days) * 86_400_000);
      const p = new URLSearchParams({ timeMin: t0.toISOString(), timeMax: t1.toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: String(Math.min(Number(max) || 10, 25)) });
      const j = await api(userId, `https://www.googleapis.com/calendar/v3/calendars/primary/events?${p}`);
      return (j.items || []).map((e) => ({ id: e.id, summary: e.summary || "(sin título)", start: e.start?.dateTime || e.start?.date, end: e.end?.dateTime || e.end?.date, location: e.location || "" }));
    },
    async listFiles(userId, { q = "", max = 10 } = {}) {
      const p = new URLSearchParams({ pageSize: String(Math.min(Number(max) || 10, 25)), orderBy: "modifiedTime desc", fields: "files(id,name,mimeType,modifiedTime,webViewLink)" });
      if (q) p.set("q", `name contains '${String(q).replace(/['\\]/g, " ")}'`);
      return (await api(userId, `https://www.googleapis.com/drive/v3/files?${p}`)).files || [];
    },
    // --- escritura: el hub SOLO las llama tras la aprobación en el teléfono ---
    async sendEmail(userId, { to, subject, body }) {
      const raw = [`To: ${clean(to)}`, `Subject: =?UTF-8?B?${Buffer.from(clean(subject)).toString("base64")}?=`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "", String(body ?? "")].join("\r\n");
      return api(userId, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", body: JSON.stringify({ raw: Buffer.from(raw).toString("base64url") }) });
    },
    async createEvent(userId, { summary, start, end, description = "" }) {
      return api(userId, "https://www.googleapis.com/calendar/v3/calendars/primary/events", { method: "POST", body: JSON.stringify({ summary: clean(summary), description, start: { dateTime: start }, end: { dateTime: end } }) });
    },
  };
}
