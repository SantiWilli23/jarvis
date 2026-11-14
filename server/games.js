// Atajos a los juegos: "abre Futotal" abre la URL sin gastar IA. Funciones puras, sin red.
export const JUEGOS = [
  { id: "futotal", nombre: "Futotal", alias: ["futotal", "football quiz", "quiz de futbol", "futbol quiz"], url: "https://football-quiz-nod2.onrender.com" },
  { id: "ski", nombre: "Ski Beta", alias: ["ski", "ski beta", "esqui"], url: "https://santiwilli23.github.io/ski-beta/" },
];

const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[¿?¡!.,;:"'“”]/g, " ").replace(/\s+/g, " ").trim();
const VERBO = "(?:abre|abrir|abreme|lanza|lanzar|inicia|iniciar|juega|jugar|jugamos|vamos a jugar|quiero jugar|pon|ponme)";
const RE_LISTA = new RegExp(`^${VERBO}(?: a| al| el| la| los| las| mis| un)* ?juegos?$`);
const ALIAS = JUEGOS.flatMap((j) => j.alias.map((a) => [norm(a), j])).sort((a, b) => b[0].length - a[0].length);

// -> null | { lista:true } | { juego }
export function parseJuegoIntent(text) {
  const raw = String(text ?? "");
  if (!raw.trim() || raw.length > 80) return null;
  const t = norm(raw).replace(/^jarvis\s+/, "").replace(/^(?:por favor|porfa)\s+/, "").replace(/\s+(?:por favor|porfa)$/, "").replace(/^(?:puedes|podrias)\s+/, "");
  if (RE_LISTA.test(t) || /^(?:mis |los )?juegos$/.test(t)) return { lista: true };
  const m = new RegExp(`^${VERBO}(?: a| al| el| la| un| mi)*(?: juego)?(?: de| del)? (.+)$`).exec(t);
  if (!m) return null;
  const x = m[1].trim();
  const hit = ALIAS.find(([a]) => a === x);
  return hit ? { juego: hit[1] } : null;
}

// Cuerpo común de respuesta: frase corta + acciones para que el cliente abra la(s) URL.
export function respuestaJuego(i) {
  if (i.lista) {
    return { reply: "Estos son sus juegos, señor. Toque el que quiera abrir.", juegos: JUEGOS.map(({ id, nombre, url }) => ({ id, nombre, url })), acciones: [] };
  }
  const { id, nombre, url } = i.juego;
  return { reply: `Abriendo ${nombre}, señor.`, juegos: [{ id, nombre, url }], acciones: [{ tipo: "abrir_url", url, nuevaPestana: true }] };
}
