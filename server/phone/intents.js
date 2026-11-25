// Reglas fijas en español (sin modelo) que convierten una orden corta en una acción del teléfono.
// Solo reconoce órdenes en imperativo al principio de la frase y de pocas palabras, para no secuestrar la charla normal.
const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[¿?¡!.,;-]/g, " ").replace(/\s+/g, " ").trim();
const ON = "(?:enciende|enciendeme|prende|activa|pon|poner|abre)";
const OFF = "(?:apaga|apagame|desactiva|quita|cierra|corta)";
const ART = "(?:(?:el|la|los|las|mi|un|una)\\s+)?";

function minutos(t) {
  if (/\bmedia hora\b/.test(t)) return 30;
  const h = /\b(\d+|una|dos|tres|cuatro|seis|ocho|doce)\s+horas?\b/.exec(t) || /\b(una) hora\b/.exec(t);
  const NUM = { una: 1, dos: 2, tres: 3, cuatro: 4, seis: 6, ocho: 8, doce: 12 };
  if (h) return (Number.isNaN(Number(h[1])) ? NUM[h[1]] : Number(h[1])) * 60;
  if (/\bun[ao]? hora\b/.test(t)) return 60;
  const m = /\b(\d+)\s+min(?:utos?)?\b/.exec(t);
  return m ? Number(m[1]) : null;
}

// Texto libre (notificación, etiqueta) tomado del original para no perder mayúsculas ni acentos.
const limpio = (s) => String(s).replace(/\s+(?:por favor|porfa)[.!]*$/i, "").replace(/[.\s]+$/, "").trim();
const NOTIF = /^(?:jarvis[,.]?\s+)?(?:por favor,?\s+)?(?:(?:manda|mandame|mándame|pon|ponme|muestra|muestrame|muéstrame|crea|lanza|enviame|envíame|envia|envía)\s+)?(?:una\s+)?notificaci[oó]n(?:\s+(?:en|al|a)\s+(?:el\s+|mi\s+)?(?:iphone|tel[eé]fono|m[oó]vil|celular))?\s*(?::|que diga|diciendo|con el texto)\s*:?\s*(.+)$/i;
const APARATO = "(?:iphone|telefono|movil|celular)";

// Devuelve { action, args } o null. destino="telefono" si la frase ya nombraba el teléfono (y se le quitó);
// original es la frase sin recortar, de donde se toma el texto libre.
export function parsePhoneIntent(text, config = {}, { destino = null, original = text } = {}) {
  let t = norm(text);
  if (!t || t.length > 90) return null;
  t = t.replace(/^jarvis\s+/, "").replace(/^(por favor|porfa)\s+/, "").replace(/\s+(por favor|porfa)$/, "").replace(/^(puedes|podrias)\s+/, "");
  const r = (action, args = {}) => ({ action, args });
  let m;

  const orig = String(original).trim();
  const enTel = destino === "telefono";

  if ((m = NOTIF.exec(orig))) {
    const x = limpio(m[1]);
    return x ? r("notificacion", { valor: x }) : null;
  }

  // Temporizador: "pon un temporizador de 10 minutos para la pasta"
  if ((m = /^(?:(?:pon|ponme|crea|inicia|programa|activa)\s+)?(?:un\s+)?temporizador\s+(?:de\s+|por\s+|a\s+)?(\d+\s+min(?:utos?)?|un minuto|\d+\s+horas?|una hora|media hora)(\s+(?:para|llamado)\s+.+)?$/.exec(t))) {
    const min = m[1] === "un minuto" ? 1 : minutos(m[1]);
    const e = m[2] && /\s(?:para|llamado)\s+(.+)$/i.exec(orig);
    return min >= 1 && min <= 1439 ? r("temporizador", e ? { valor: min, etiqueta: limpio(e[1]).slice(0, 60) } : { valor: min }) : null;
  }

  // Modos de concentración de la lista ("activa el modo trabajo"). "No molestar" va aparte.
  for (const nombre of config.enfoques_permitidos || []) {
    const pat = "(?:el\\s+)?(?:modo(?: de)?(?: concentracion| enfoque)?|enfoque|concentracion)\\s+(?:de\\s+)?" + norm(nombre);
    if (new RegExp("^" + OFF + "\\s+" + pat + "$").test(t)) return r("enfoque", { valor: nombre, activar: "off" });
    if (new RegExp("^" + ON + "\\s+" + pat + "$").test(t)) return r("enfoque", { valor: nombre, activar: "on" });
  }

  // Estado del iPhone y hacer que suene
  if (new RegExp("^(?:(?:dime|dame|muestrame|revisa)\\s+)?(?:el )?estado (?:del|de mi) " + APARATO + "$|^como esta mi " + APARATO + "$").test(t)
    || (enTel && /^(?:(?:dime|dame|muestrame|revisa)\s+)?(?:el )?estado$|^como esta$/.test(t))) return r("estado");
  if (new RegExp("^(?:busca|encuentra|haz sonar|donde esta) (?:mi |el )" + APARATO + "$").test(t)
    || (enTel && /^(?:busca|buscame|encuentra|haz sonar|donde esta)$/.test(t))) return r("buscar_iphone");

  // Atajo propio: solo los de la lista (y siempre con aprobación)
  if ((m = /^(?:ejecuta|lanza|corre|inicia)\s+(?:el\s+|mi\s+)?atajo\s+(?:de\s+|llamado\s+)?(.+)$/.exec(t))) {
    const a = (config.atajos_permitidos || []).find((x) => norm(x) === m[1]);
    return a ? r("atajo", { valor: a }) : null;
  }

  // Interruptores simples: encender / apagar
  const toggles = [
    ["linterna", "linterna"], ["bluetooth", "bluetooth"], ["wifi", "wifi|wi fi"], ["bajo_consumo", "(?:modo )?(?:bajo consumo|ahorro de bateria|ahorro de energia)"],
    ["modo_oscuro", "modo oscuro"], ["modo_avion", "modo avion"], ["ubicacion", "(?:la )?ubicacion|gps"], ["datos_moviles", "datos moviles|datos"],
  ];
  for (const [action, pat] of toggles) {
    if (new RegExp(`^${OFF}\\s+${ART}(?:${pat})$`).test(t)) return r(action, { valor: "off" });
    if (new RegExp(`^${ON}\\s+${ART}(?:${pat})$`).test(t)) return r(action, { valor: "on" });
  }

  // No molestar / enfoque
  // Un enfoque con nombre desconocido no debe acabar activando "No molestar".
  if (/\b(no molestar|enfoque|concentracion)\b/.test(t) && !/\b(?:enfoque|concentracion) (?!\d|por\b|durante\b|una?\b|media\b)\S/.test(t)) {
    if (new RegExp(`^${OFF}\\b`).test(t)) return r("no_molestar", { valor: "off" });
    if (new RegExp(`^(?:${ON}|activa|pon)\\b`).test(t) || /^no molestar\b/.test(t) || /^(?:modo )?(?:no molestar|enfoque)/.test(t)) {
      const min = minutos(t);
      return r("no_molestar", min ? { valor: "on", minutos: min } : { valor: "on" });
    }
  }

  // Brillo y volumen con número
  if ((m = /^(?:pon|sube|baja|ajusta|deja|cambia)?\s*(?:el |al )?(brillo|volumen)\s+(?:de la pantalla\s+)?(?:al|a|en|a un)?\s*(\d{1,3})\s*(?:%|por ciento)?$/.exec(t))) {
    const n = Number(m[2]);
    if (n >= 0 && n <= 100) return r(m[1] === "brillo" ? "brillo" : "volumen", { valor: n });
  }
  if ((m = /^(?:pon|sube|baja|ajusta)\s+(?:el\s+)?(brillo|volumen)\s+(?:al\s+)?(maximo|minimo)$/.exec(t))) return r(m[1], { valor: m[2] === "maximo" ? 100 : 0 });

  if (/^(?:cuanta bateria|que bateria|nivel de bateria|bateria)\b/.test(t) && t.split(" ").length <= 6) return r("bateria");
  if (/^(?:haz )?vibrar\b|^haz vibrar\b/.test(t)) return r("vibrar");

  // Multimedia
  if (/^(?:pausa|pausar|pon pausa|para|deten)\b.*\b(musica|cancion|reproduccion|spotify)?$/.test(t) && /\b(musica|cancion|reproduccion|spotify)\b|^pausa$/.test(t)) return r("multimedia", { valor: "pausa" });
  if (/^(?:siguiente|pasa a la siguiente|salta)\b.*\b(cancion|tema)\b|^siguiente cancion$/.test(t)) return r("multimedia", { valor: "siguiente" });
  if (/^(?:cancion anterior|vuelve a la anterior|anterior cancion)$/.test(t)) return r("multimedia", { valor: "anterior" });
  if (/^(?:reproduce|continua|reanuda|dale play a)\s+(?:la\s+)?(?:musica|cancion|reproduccion)$/.test(t)) return r("multimedia", { valor: "play" });

  // Alarma: "pon una alarma a las 7:30" / "alarma a las 7 y media"
  if ((m = /^(?:pon(?:me)?|crea|programa)?\s*(?:una )?alarma\s+(?:para |a )?las?\s+(\d{1,2})(?:[: ](\d{2})|\s+y\s+(media|cuarto))?\s*(?:de la (manana|tarde|noche))?$/.exec(t))) {
    let h = Number(m[1]); const min = m[2] ? Number(m[2]) : m[3] === "media" ? 30 : m[3] === "cuarto" ? 15 : 0;
    if (m[4] && m[4] !== "manana" && h < 12) h += 12;
    if (h <= 23 && min <= 59) return r("alarma", { valor: `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}` });
  }

  // Abrir una app de la lista
  if ((m = /^(?:abre|abreme|abrir|lanza|inicia)\s+(?:la |el )?(?:app |aplicacion )?(?:de )?(.+)$/.exec(t))) {
    const app = (config.apps_permitidas || []).find((a) => norm(a) === m[1]);
    if (app) return r("abrir_app", { valor: app });
  }
  return null;
}

// Texto de respuesta corto para el usuario.
export function phoneReply(item) {
  if (item.status === "aprobacion") return `Necesito su aprobación para eso, señor: ${item.nombre}. Le dejé la tarjeta en el teléfono.`;
  return `Listo, señor. Dejé «${item.nombre}» en la cola del teléfono; se hace cuando abra el Atajo Jarvis Puente.`;
}
