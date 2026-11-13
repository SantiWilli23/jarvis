// Cliente HTTP del agente hacia /api/agent/* del hub. El token de agente va solo en la cabecera Authorization.
export function createHubClient({ baseUrl, token, fetchFn = fetch }) {
  const url = String(baseUrl).replace(/\/+$/, "");
  async function call(path, { method = "POST", body } = {}) {
    const res = await fetchFn(`${url}/api/agent${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data = null; try { data = await res.json(); } catch { /* sin cuerpo */ }
    if (!res.ok) throw Object.assign(new Error(data?.error || `HTTP ${res.status}`), { status: res.status, data });
    return data;
  }
  return {
    hello: (info) => call("/hello", { body: info }),
    heartbeat: (s) => call("/heartbeat", { body: s }),
    bye: () => call("/bye", { body: {} }),
    claim: () => call("/claim", { body: {} }),
    events: (id, events) => call(`/tasks/${id}/events`, { body: { events } }),
    requestApproval: (id, a) => call(`/tasks/${id}/approval`, { body: a }),
    approvalStatus: (id) => call(`/approvals/${id}`, { method: "GET" }),
    finish: (id, out) => call(`/tasks/${id}/finish`, { body: out }),
  };
}
