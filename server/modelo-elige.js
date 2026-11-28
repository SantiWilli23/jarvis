// Selector de modelo (docs/NAV.md "Modelo"): reglas fijas, sin IA ni red. Nunca devuelve Opus.
import { sinOpus } from "../desktop/runner/claude-args.js";

export const MODELOS_DEF = { barato: "claude-haiku-5-5", fuerte: "sonnet", umbral: 3, escalar: true, capturas: "fuerte" };
export const modelosDe = (cfg) => {
  const m = { ...MODELOS_DEF, ...(cfg?.modelos || {}) };
  return { ...m, barato: sinOpus(m.barato), fuerte: sinOpus(m.fuerte) };
};

const plano = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
// Tareas del colegio: siempre el fuerte.
const COLEGIO = /\b(classroom|lirmi)\b|\b(tareas?|deberes|pruebas?|trabajos?|guias?)\b[^.?!\n]{0,40}\b(colegio|liceo|escuela)\b/;
export const esColegio = (consulta) => COLEGIO.test(plano(consulta));

const VARIOS_PASOS = [/\bprimero\b[\s\S]{1,300}?\b(luego|despues|y entonces)\b/, /(\by|,)\s*(luego|despues)\s+\w+(a|e|lo|la)\b/, /\bpaso 1\b[\s\S]*\bpaso 2\b/, /(^|\n)\s*1[.)]\s[\s\S]*\n\s*2[.)]\s/];
// Pedidos de actuar (no "la entrega", "universidad pública" ni "por qué sube la marea"). Con tildes: "pública" no es "publica".
const FIN = "(?![a-záéíóúñ])";
const INI = "(?<![a-záéíóúñ])";
const ACTUAR = [
  new RegExp(`${INI}(?:entr[eé]ga|s[uú]be|rell[eé]na|publ[ií]ca)(?:me)?(?:lo|la|los|las)${FIN}`),
  new RegExp(`(?:^|[.;:,]\\s*|${INI}(?:y|luego|después|despues|por favor)\\s+)(?:entrega|sube|rellena|publica)\\s+(?:el|la|los|las|un|una|mi|mis|este|esta|esto)${FIN}`),
  new RegExp(`${INI}(?:quiero|necesito|debes|tienes que|puedes|para)\\s+(?:entregar|subir|rellenar|publicar)${FIN}`),
  new RegExp(`^\\s*(?:entregar|subir|rellenar|publicar)${FIN}`),
];
const PESADOS = new Set(["investigar", "estudio", "memoria_recoger", "memoria_repartir"]);

// historial: { casos, fallos } de Haiku en ese tipo y sitio.
export function elegirModelo({ tipo, sitio, perfil, consulta = "", continuacion = false, capturas = false, historial = null, cfg = null } = {}) {
  const m = modelosDe(cfg);
  if (perfil === "escolar" || esColegio(consulta)) return { modelo: m.fuerte, puntos: m.umbral, motivos: ["tarea del colegio"] };
  let puntos = 0;
  const motivos = [];
  const suma = (n, motivo) => { puntos += n; motivos.push(motivo); };
  const texto = String(consulta).toLowerCase();
  if (PESADOS.has(tipo)) suma(3, "tarea larga");
  if (tipo === "preguntar_ia" && sitio === "claude") suma(1, "sitio claude.ai");
  if (continuacion) suma(-1, "sigue un chat");
  if (capturas) suma(2, "con capturas");
  if (texto.length > 1500) suma(1, "consulta larga");
  if (VARIOS_PASOS.some((re) => re.test(plano(texto)))) suma(2, "varios pasos");
  if (ACTUAR.some((re) => re.test(texto))) suma(3, "hay que entregar o publicar");
  if (historial && historial.casos >= 4 && historial.fallos / historial.casos >= 0.25) suma(3, "Haiku ha fallado aquí");
  return { modelo: puntos >= m.umbral ? m.fuerte : m.barato, puntos, motivos };
}

const FORMAL = /\b(formal|carta|informe|ensayo|solicitud|correo|oficio|curriculum)\b/;
const CODIGO = /```|\b(codigo|javascript|python|sql|html|css|function|script)\b|=>|\bconst \w+ =/;
const TIPOS_COLEGIO = new Set(["plan", "repaso"]); // los de server/repaso.js salen de lo escolar

// Pedidos de texto sin herramientas: Haiku solo si es corto, informal, sin código y no es del colegio.
export function elegirModeloTextos({ tipo = "", texto = "", cfg = null } = {}) {
  const m = modelosDe(cfg), p = plano(texto);
  const simple = !TIPOS_COLEGIO.has(tipo) && !esColegio(texto) && String(texto).length < 2000 && !FORMAL.test(p) && !CODIGO.test(p);
  return simple ? m.barato : m.fuerte;
}
