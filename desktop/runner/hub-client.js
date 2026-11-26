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
    // Navegador de Jarvis (modo asistido): el servidor decide; aquí solo se reclama y se informa el estado.
    browserClaim: () => call("/browser/claim", { body: {} }),
    browserStep: (id, body) => call(`/browser/tasks/${id}/step`, { body }),
    // Cola de acciones del PC (Ola 0): reclamar la siguiente y devolver el resultado
    pcNext: () => call("/pc/next", { body: {} }),
    pcResult: (id, out) => call(`/pc/${id}/result`, { body: out }),
    // Claude sin herramientas, memoria y registro de acciones (docs/CONTROL.md, docs/MEMORIA.md)
    textosClaim: () => call("/textos/claim", { body: {} }),
    textosResult: (id, out) => call(`/textos/${id}/result`, { body: out }),
    memoriaProponer: (nota) => call("/memoria/proponer", { body: nota }),
    controlLog: (entrada) => call("/control/log", { body: entrada }),
    controlFreno: () => call("/control/freno", { body: {} }),   // freno puesto desde el PC
    controlApagar: () => call("/control/apagar", { body: {} }), // apagar control amplio y de ratón
    // Navegador de Claude (docs/NAV.md)
    navClaim: () => call("/nav/claim", { body: {} }),
    navResult: (id, out) => call(`/nav/${id}/result`, { body: out }),
    navEvents: (id, body) => call(`/nav/${id}/events`, { body }), // pasos, captura y latido -> {cancelado}
    // Modo Pro (docs/PRO.md §5 y "Ampliaciones P3")
    proClaim: () => call("/pro/claim", { body: {} }),
    proEvents: (id, events) => call(`/pro/jobs/${id}/events`, { body: { events } }),
    proReport: (id, body) => call(`/pro/jobs/${id}/report`, { body }),
    proFail: (id, error) => call(`/pro/jobs/${id}/fail`, { body: { error } }),
    proApproval: (id, a) => call(`/pro/jobs/${id}/approval`, { body: a }),
  };
}
