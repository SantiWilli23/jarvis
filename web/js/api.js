// Cliente REST. El token vive en localStorage y viaja solo en la cabecera Authorization.
const KEY = "jarvis_token";
let onUnauthorized = () => {};

export const getToken = () => { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } };
export const setToken = (t) => { try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch { /* modo privado */ } };
export const onAuthLost = (fn) => { onUnauthorized = fn; };

export async function api(path, { method = "GET", body, raw, headers = {}, auth = true } = {}) {
  const h = { ...headers };
  if (auth && getToken()) h.authorization = `Bearer ${getToken()}`;
  let payload = raw;
  if (body !== undefined) { h["content-type"] = "application/json"; payload = JSON.stringify(body); }
  const res = await fetch(`/api${path}`, { method, headers: h, body: payload });
  let data = null;
  try { data = await res.json(); } catch { /* sin cuerpo */ }
  if (res.status === 401 && auth && path !== "/auth/login") { setToken(""); onUnauthorized(); }
  if (!res.ok) throw Object.assign(new Error(data?.error || `HTTP ${res.status}`), { status: res.status, data });
  return data;
}

export const login = (password) => api("/auth/login", { method: "POST", body: { password, deviceName: navigator.userAgent.includes("iPhone") ? "iPhone" : "Navegador" }, auth: false });
export const getStatus = () => api("/status");
export const sendChat = (text, priv, conversationId, engine = "auto") => api("/chat", { method: "POST", body: { text, private: !!priv, conversationId, source: "voz", engine } });
export const getSettings = () => api("/settings");
export const putSettings = (modo) => api("/settings", { method: "PUT", body: { modo } });
export const transcribe = (blob) => api("/stt", { method: "POST", raw: blob, headers: { "content-type": blob.type || "audio/mp4" } });
export const decideApproval = (id, approve) => api(`/approvals/${id}`, { method: "POST", body: { approve } });
export const pendingApprovals = () => api("/approvals");
export const deleteTask = (id) => api(`/tasks/${id}`, { method: "DELETE" });
export const approveReview = (id) => api(`/tasks/${id}/approve-review`, { method: "POST", body: {} });
export const logout = () => api("/auth/logout", { method: "POST", body: {} });

// Aviso "despertando…": Render (plan gratis) duerme el servidor. Reintenta /health hasta que responda.
export async function waitForServer(onWaiting, onReady) {
  let waiting = false;
  for (;;) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 5000);
      const r = await fetch("/health", { signal: ctl.signal, cache: "no-store" });
      clearTimeout(timer);
      if (r.ok) { if (waiting) onReady(); return; }
    } catch { /* sigue dormido */ }
    if (!waiting) { waiting = true; onWaiting(); }
    await new Promise((r) => setTimeout(r, 3000));
  }
}
