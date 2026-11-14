// Órdenes de música en español, sin modelo. Devuelve null si no es música (o es del PC / del teléfono).
//   { op:'playlist', nombre } | { op:'buscar', q, ambiguo } | { op:'listas' } | { op:'musica' }
//   { op:'pause'|'resume'|'next'|'prev'|'stop'|'shuffle'|'info' }
import { classify } from "../router/classify.js";

const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[¿?¡!.,;:"'“”]/g, " ").replace(/\s+/g, " ").trim();
export const CONTROLES = ["pause", "resume", "next", "prev", "stop", "shuffle", "info"];

// Cosas del teléfono o del PC que NO son música aunque empiecen por "pon"
const RE_TELEFONO = /\b(wifi|wi fi|bluetooth|linterna|brillo|volumen|alarma|temporizador|cronometro|no molestar|enfoque|modo (oscuro|avion|ahorro)|bateria|ubicacion|gps|datos moviles|bajo consumo|vibrar|despertador|recordatorio|aviso|pantalla|ajustes|configuracion)\b/;
const RE_ABRIR = /^(abre|abrir|lanza|inicia|ejecuta|cierra|instala|descarga)\b/;
const VERBO = "(?:pon|ponme|poner|pone|reproduce|reproducir|quiero escuchar|quiero oir|quiero poner|escucha|escuchar|ponga)";

const CONTROL = [
  ["stop", /^(?:para|parar|deten|detener|apaga|quita|corta|cierra) (?:la |el |toda la )?(?:musica|cancion|reproduccion|reproductor|tema|video)$|^stop$/],
  ["pause", /^(?:pausa|pausar|pon pausa|haz pausa|pausa (?:la |el )?(?:musica|cancion|reproduccion|tema|video))$/],
  ["resume", /^(?:sigue|seguir|continua|continuar|reanuda|reanudar|dale play|play|dale|sigue (?:con )?(?:la )?(?:musica|cancion)|(?:continua|reanuda|reanudar) (?:la )?(?:musica|cancion|reproduccion)|quita la pausa)$/],
  ["next", /^(?:siguiente|proxima|next|salta|saltar|pasa|(?:la )?siguiente (?:cancion|tema)|(?:pasa|salta|cambia) (?:a )?(?:la )?(?:siguiente|proxima)(?: cancion| tema)?|salta (?:la )?cancion|otra cancion|cambia (?:de )?cancion)$/],
  ["prev", /^(?:anterior|(?:la )?cancion anterior|vuelve a la anterior|(?:la )?anterior|anterior cancion|atras|(?:pasa|vuelve|ve) a la anterior|cancion de antes)$/],
  ["shuffle", /^(?:aleatorio|modo aleatorio|mezcla|mezclalo|mezclala|shuffle|ponlo aleatorio|ponla aleatoria|(?:activa|pon) (?:el )?(?:modo )?aleatorio|mezcla (?:la )?(?:lista|playlist|musica))$/],
  ["info", /^(?:que suena|que esta sonando|que (?:cancion|tema) es(?: esta| ese)?|como se llama (?:esta|esa) (?:cancion|tema)|que estoy escuchando|que (?:cancion|tema) suena|quien canta)$/],
];

export function parseMusicIntent(text) {
  const raw = String(text ?? "");
  if (!raw.trim() || raw.length > 90) return null;
  let t = norm(raw).replace(/^jarvis\s+/, "").replace(/^(?:por favor|porfa)\s+/, "").replace(/\s+(?:por favor|porfa)$/, "").replace(/^(?:puedes|podrias)\s+/, "");
  if (!t) return null;
  if (RE_ABRIR.test(t) || RE_TELEFONO.test(t)) return null;
  if (classify(raw).kind === "accion_pc") return null; // "en mi pc", "abre el...", "ejecuta"...

  for (const [op, re] of CONTROL) if (re.test(t)) return { op };
  if (/^(?:que|cuales|dime|muestrame|lista|listame|enumera|mis) (?:mis |tus )?(?:playlists?|listas)(?: de reproduccion)?(?: tengo)?$|^(?:que |cuales )?(?:playlists?|listas)(?: de reproduccion)? tengo$|^mis (?:playlists?|listas)$/.test(t)) return { op: "listas" };

  let m;
  if (new RegExp(`^${VERBO} (?:algo de )?(?:la |mi )?musica$`).test(t) || /^quiero (?:escuchar )?musica$/.test(t)) return { op: "musica" };
  // pon (mi) (playlist|lista) X
  if ((m = new RegExp(`^${VERBO} (?:mi |la |el |una )?(?:playlist|lista)(?: de reproduccion)? (?:de |del )?(.+)$`).exec(t))) return { op: "playlist", nombre: m[1].trim() };
  // pon la canción / el tema / el video X (de Y)
  if ((m = new RegExp(`^${VERBO} (?:la |el |una |un )?(?:cancion|tema|video|musica de|algo de) (?:de )?(.+)$`).exec(t))) return { op: "buscar", q: m[1].trim(), ambiguo: false };
  // reproduce X / quiero escuchar X
  if ((m = /^(?:reproduce|reproducir|quiero escuchar|quiero oir|escucha|escuchar) (.+)$/.exec(t))) return { op: "buscar", q: m[1].replace(/^(?:la|el|las|los) (?=\S)/, "").trim(), ambiguo: false };
  // ponme X / pon X a secas: ambiguo
  if ((m = /^(?:pon|ponme|poner|pone|ponga) (.+)$/.exec(t))) {
    const x = m[1].replace(/^(?:la|el|las|los|una|un) (?=\S)/, "").trim();
    if (x && x.split(" ").length <= 8) return { op: "buscar", q: x, ambiguo: true };
  }
  return null;
}
