// Servidor simulado del API Pro para ver web/ sin el servidor real: node test/pro-mock.js [puerto] (por defecto 3061).
// Sirve web/ y responde /api/status, /api/auth/me, /api/approvals y /api/pro/* con datos de ejemplo. Token cualquiera.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = fileURLToPath(new URL("../web/", import.meta.url));
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/json" };
const estado = { habilitado: true, motivos: [] };
const hilos = [{ id: 1, title: "Arreglar login", repo: "C:\\proyectos\\jarvis", status: "abierto" }];
const msgs = [
  { id: 1, round_id: 1, author: "usuario", kind: "texto", text: "Añade validación de email al registro", meta: {} },
  { id: 2, round_id: 1, author: "claude", kind: "plan", text: "1. Validar email en server/routes/auth.js\n2. Test en test/auth.test.js", meta: {} },
  { id: 3, round_id: 1, author: "claude", kind: "informe", text: "", meta: { job_id: 7, body: { dijo_hizo: ["Añadí la validación", "Añadí un test"], archivos_tocados: ["server/routes/auth.js", "server/x.js"], comandos: ["npm test"], resultado: "ok" } } },
  { id: 4, round_id: 1, author: "gemini", kind: "verificacion", text: "", meta: { job_id: 8, body: { dijo_no_hizo: ["Dijo añadir test; no está en el diff"], hizo_no_dijo: ["server/x.js modificado sin mencionarlo"], cambios_ajenos: ["config/x.json"], veredicto: "corregir" } } },
];
const rondas = [{ id: 1, status: "necesita_usuario", corrections: 2, programmer: "claude", verifier: "gemini", summary: "La verificación pide corregir" }];
const diff = "M\tserver/routes/auth.js\nA\ttest/nuevo.test.js\nD\tviejo.js\n\n server/routes/auth.js | 12 ++++++++++--\n 3 files changed, 20 insertions(+), 4 deletions(-)";

const json = (res, code, o) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
export function crear() {
  return createServer(async (req, res) => {
    const p = new URL(req.url, "http://x").pathname;
    if (p === "/health" || p === "/api/auth/me") return json(res, 200, { ok: true });
    if (p === "/api/status") return json(res, 200, { pro: estado, pc: { online: estado.habilitado, capabilities: { repos: ["C:\\proyectos\\jarvis", "C:\\proyectos\\web"] } }, connections: [], queue: { items: [] }, memory: {}, providers: [] });
    if (p === "/api/approvals") return json(res, 200, { approvals: [{ id: 5, pro_job_id: 7, kind: "comando", summary: "Claude quiere ejecutar un comando", detail: "npm test" }] });
    if (p === "/api/__estado" && req.method === "POST") { let b = ""; for await (const c of req) b += c; Object.assign(estado, JSON.parse(b)); return json(res, 200, estado); }
    if (p === "/api/pro/threads") return json(res, 200, req.method === "POST" ? { thread: hilos[0] } : { threads: hilos });
    if (/^\/api\/pro\/threads\/\d+$/.test(p)) return json(res, 200, { thread: hilos[0], messages: msgs, rounds: rondas });
    if (/^\/api\/pro\/jobs\/\d+$/.test(p)) return json(res, 200, { job: { id: 7 }, diff });
    if (p.startsWith("/api/pro/")) return json(res, 200, { ok: true });
    if (p.startsWith("/api/")) return json(res, 404, { error: "no" });
    const f = normalize(join(WEB, p === "/" ? "index.html" : p));
    if (!f.startsWith(WEB)) return json(res, 403, {});
    try { const b = await readFile(f); res.writeHead(200, { "content-type": TIPOS[extname(f)] || "application/octet-stream" }); res.end(b); } catch { json(res, 404, { error: "no" }); }
  });
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) crear().listen(Number(process.argv[2]) || 3061, () => console.log("mock Pro en :" + (process.argv[2] || 3061)));
