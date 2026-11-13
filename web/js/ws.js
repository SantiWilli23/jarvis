// WebSocket /ws: se autentica con el primer mensaje, con reconexión automática.
import { getToken } from "./api.js";

let sock = null, retry = 0, closedByUs = false, handler = () => {};

export function connectWs(onMessage) {
  handler = onMessage;
  closedByUs = false;
  open();
}
export function closeWs() { closedByUs = true; try { sock?.close(); } catch { /* ya cerrado */ } }

function open() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  sock = new WebSocket(`${proto}://${location.host}/ws`);
  sock.onopen = () => { retry = 0; sock.send(JSON.stringify({ type: "auth", token: getToken() })); };
  sock.onmessage = (e) => { try { handler(JSON.parse(e.data)); } catch { /* mensaje inválido */ } };
  sock.onclose = (e) => {
    if (closedByUs || e.code === 4401) return handler({ type: "ws.closed", code: e.code });
    setTimeout(open, Math.min(15000, 1000 * 2 ** retry++));
  };
  sock.onerror = () => {};
}
