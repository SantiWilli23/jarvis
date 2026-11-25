// Guardia del Navegador de Claude (docs/NAV.md v2): hook PreToolUse que decide ANTES de ejecutar cada herramienta.
// Falla cerrado por partida doble: (1) las herramientas de Chrome NO van en --allowedTools, solo las aprueba este
// guardia, así que si no corre quedan denegadas; (2) cualquier error aquí sale con código 2 (bloquea).
// El worker copia este archivo fuera del paquete de la app: solo puede importar módulos de Node.
// Uso: node nav-guard.js --nav-guard <politica.json>   (entrada del hook por stdin)
import { readFileSync, appendFileSync } from "node:fs";

const CHROME = "mcp__claude-in-chrome__";
export const PERFILES = ["ia", "lectura", "escolar"];
const PESTANAS = ["tabs_context_mcp", "tabs_create_mcp", "tabs_close_mcp"];
const LEER = ["navigate", "get_page_text", "read_page", "find"];
const POR_PERFIL = {
  ia: ["tabs_context_mcp", "tabs_create_mcp", ...LEER, "computer", "form_input"],
  lectura: [...PESTANAS, ...LEER],
  escolar: [...PESTANAS, ...LEER],
};

// --- URLs ---
// URLs que una llamada quiere abrir (navigate, tabs_create_mcp y lo mismo dentro de browser_batch).
export function urlsDeHerramienta(name, input) {
  const corto = String(name || "").replace(/^mcp__claude-in-chrome__/, "");
  if (corto === "browser_batch") return (Array.isArray(input?.actions) ? input.actions : []).flatMap((a) => urlsDeHerramienta(a?.name, a?.input));
  if (corto !== "navigate" && corto !== "tabs_create_mcp") return [];
  return typeof input?.url === "string" && input.url.trim() ? [input.url.trim()] : [];
}

const limpio = (h) => String(h).toLowerCase().replace(/\.+$/, "").replace(/^www\./, "");

// localhost, nombres internos e IP que no son de Internet. URL() ya normaliza 127.1, 0x7f000001, etc.
export function hostPrivado(hostname) {
  const h = String(hostname).toLowerCase().replace(/\.+$/, "");
  if (h.startsWith("[")) return true; // IPv6 literal: nunca
  const ip = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ip) {
    const a = +ip[1], b = +ip[2];
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) || (a === 198 && (b === 18 || b === 19));
  }
  return !h.includes(".") || /\.(localhost|local|internal|lan|home\.arpa)$/.test(h);
}

// Una entrada negada cubre el dominio y sus subdominios; admite "*" como comodín.
function negado(host, negados) {
  return negados.some((n) => {
    const p = limpio(String(n).replace(/^\*\./, ""));
    if (!p) return false;
    if (p.includes("*")) return new RegExp(`^${p.split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`).test(host);
    return host === p || host.endsWith(`.${p}`);
  });
}

// Host exacto (con o sin "www."); subdominios solo con "*.dominio"; "*" = cualquier host https público.
export function urlPermitida(url, hosts = [], negados = []) {
  const t = String(url || "").trim();
  if (t === "back" || t === "forward" || t === "about:blank") return true;
  let u;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(t) ? t : `https://${t}`); } catch { return false; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (hostPrivado(u.hostname)) return false;
  const host = limpio(u.hostname);
  if (negado(host, negados)) return false;
  return hosts.some((h) => {
    if (h === "*") return u.protocol === "https:";
    if (!String(h).startsWith("*.")) return host === limpio(h);
    const base = limpio(String(h).slice(2));
    return host === base || host.endsWith(`.${base}`);
  });
}

// --- Decisión ---
// politica = {perfil, hosts, negados, capturas, max_paginas}; usadas = páginas ya abiertas.
// Devuelve {ok, motivo, paginas} (paginas = las que abre esta llamada).
export function decidir(politica, name, input, usadas = 0) {
  const no = (motivo) => ({ ok: false, motivo, paginas: 0 });
  if (!PERFILES.includes(politica?.perfil)) return no("perfil desconocido");
  if (name === "ToolSearch") return { ok: true, motivo: "", paginas: 0 };
  if (typeof name !== "string" || !name.startsWith(CHROME)) return no(`herramienta no permitida: ${name}`);
  let paginas = 0;

  const una = (n, i) => {
    if (n === "computer" && politica.perfil !== "ia") {
      if (!politica.capturas || i?.action !== "screenshot") return "en este perfil computer solo sirve para capturas de pantalla";
    } else if (!POR_PERFIL[politica.perfil].includes(n)) return `herramienta no permitida en el perfil ${politica.perfil}: ${n}`;
    if (n === "navigate" || n === "tabs_create_mcp") {
      const url = i?.url;
      if (url !== undefined && url !== null && url !== "") {
        if (typeof url !== "string" || !urlPermitida(url, politica.hosts || [], politica.negados || [])) return "dirección no permitida";
        if (url.trim() !== "about:blank") paginas++;
      } else if (n === "navigate") return "navigate sin dirección";
    }
    return null;
  };

  const corto = name.slice(CHROME.length);
  if (corto === "browser_batch") {
    const acciones = input?.actions;
    if (!Array.isArray(acciones) || !acciones.length) return no("lote vacío o mal formado");
    for (const a of acciones) {
      const motivo = una(String(a?.name || "").replace(CHROME, ""), a?.input);
      if (motivo) return no(motivo);
    }
  } else {
    const motivo = una(corto, input);
    if (motivo) return no(motivo);
  }

  const max = Number(politica.max_paginas) || 0;
  if (max && paginas && usadas + paginas > max) return no(`tope de ${max} páginas alcanzado: responde con lo que ya tienes`);
  return { ok: true, motivo: "", paginas };
}

// --- Proceso del hook ---
async function main(rutaPolitica) {
  const trozos = [];
  for await (const c of process.stdin) trozos.push(c);
  const entrada = JSON.parse(Buffer.concat(trozos).toString("utf8"));
  const politica = JSON.parse(readFileSync(rutaPolitica, "utf8"));
  const contador = `${rutaPolitica}.paginas`;
  let usadas = 0;
  try { usadas = readFileSync(contador, "utf8").length; } catch (e) { if (e.code !== "ENOENT") throw e; }
  const d = decidir(politica, entrada.tool_name, entrada.tool_input, usadas);
  if (!d.ok) { process.stderr.write(`Guardia de Jarvis: ${d.motivo}`); process.exitCode = 2; return; }
  if (d.paginas) appendFileSync(contador, ".".repeat(d.paginas)); // un carácter por página
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" } }));
}

if (process.argv[2] === "--nav-guard") {
  const cerrar = (e) => { process.stderr.write(`Guardia de Jarvis: error (${e?.message || e})`); process.exit(2); };
  process.on("uncaughtException", cerrar);
  main(process.argv[3]).catch(cerrar);
}
