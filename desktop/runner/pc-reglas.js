// Reglas puras del control amplio y de ratón (docs/CONTROL.md): qué se puede autorizar y qué nunca.
// Las usan el servidor (lista autorizada) y el PC (antes y después de cada paso).
import { hostPrivado } from "./nav-guard.js";

export const MAX_LISTA = 20;
export const NAVEGADORES = ["chrome.exe", "msedge.exe", "firefox.exe", "brave.exe", "opera.exe", "vivaldi.exe", "chromium.exe", "iexplore.exe", "arc.exe"];
// Nunca, en cualquier parte del nombre (sin acentos, en minúsculas).
export const NEGADO_PARTE = ["jarvis", "claude", "anthropic", "consent", "credentialuibroker", "logonui", "taskmgr", "regedit", "powershell", "terminal",
  "keepass", "bitwarden", "1password", "lastpass", "dashlane", "nordpass", "enpass", "protonpass", "proton pass", "keeper", "roboform", "password", "contrasena", "credencial",
  "bank", "banco", "banca", "pay", "mercadopago", "mercado pago", "wallet", "billetera", "santander", "binance", "coinbase",
  "simbolo del sistema", "command prompt", "editor del registro", "administrador de tareas"];
// Nunca, como palabra suelta.
export const NEGADO_PALABRA = ["cmd", "pwsh", "mmc", "wt", "wsl", "bash", "conhost", "openconsole", "mintty", "electron", "bci", "itau"];
// Botones que no se pulsan: pagos, compras, transferencias y conceder permisos.
export const ELEMENTO_PROHIBIDO = ["pagar", "pago", "comprar", "compra", "transferir", "transferencia", "enviar dinero", "donar", "suscrib", "realizar pedido", "confirmar pedido",
  "pay", "buy", "purchase", "checkout", "transfer", "donate", "subscribe", "place order",
  "permitir", "allow", "aprobar", "approve", "autorizar", "authorize", "conceder", "grant"];

const llano = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const sinWww = (h) => llano(h).replace(/\.+$/, "").replace(/^www\./, "");

export function bloqueado(nombre) {
  const t = llano(nombre);
  return !t || NEGADO_PARTE.some((p) => t.includes(p)) || t.split(/[^a-z0-9]+/).some((w) => NEGADO_PALABRA.includes(w));
}
export const elementoProhibido = (nombre) => ELEMENTO_PROHIBIDO.some((p) => llano(nombre).includes(p));
const hostNegado = (host, negados) => negados.map(sinWww).filter(Boolean).some((n) => host === n || host.endsWith(`.${n}`));

const RE_APP = /^[a-z0-9._ -]{1,40}\.exe$/;
const RE_HOST = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/;

// Entrada de la lista autorizada ya limpia, o null si no se puede autorizar. negados = hosts propios (PUBLIC_URL, hub).
export function entradaValida(e, { negados = [] } = {}) {
  const tipo = e?.tipo, crudo = typeof e?.valor === "string" ? e.valor.trim().toLowerCase() : "";
  if (tipo === "app") return RE_APP.test(crudo) && !bloqueado(crudo) && !NAVEGADORES.includes(crudo) ? { tipo, valor: crudo } : null;
  if (tipo !== "host") return null;
  const valor = sinWww(crudo);
  return RE_HOST.test(valor) && !hostPrivado(valor) && !bloqueado(valor) && !hostNegado(valor, negados) ? { tipo, valor } : null;
}

// ¿La ventana que hay delante ({proceso, host}) es el objetivo autorizado? En un navegador solo valen objetivos "host".
export function objetivoPermitido(ventana, entrada, { negados = [] } = {}) {
  const e = entradaValida(entrada, { negados });
  const proceso = String(ventana?.proceso || "").toLowerCase();
  if (!e || !proceso || bloqueado(proceso)) return false;
  const navegador = NAVEGADORES.includes(proceso);
  if (e.tipo === "app") return !navegador && proceso === e.valor;
  const host = sinWww(ventana?.host || "");
  return navegador && !!host && !bloqueado(host) && !hostNegado(host, negados) && host === e.valor;
}
