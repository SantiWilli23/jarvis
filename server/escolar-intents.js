// Frases escolares (docs/NAV.md), sin modelo. "IRMI" es como el dictado escribe Lirmi.
const INICIO = "^(?:(?:oye )?jarvis )?(?:(?:por favor|porfa) )?(?:(?:puedes|podrias) )?";
const FUENTE = "(classroom|class room|clasroom|lirmi|irmi)";
const ACTUALIZAR = new RegExp(`${INICIO}(?:revisa|revisar|revisame|actualiza|actualizar|actualizame|mira|mirar|lee|leer)(?: (?:mi|el|la|en|de))*(?: google)? ${FUENTE}(?: por favor| porfa)?$`);
const LISTAR = new RegExp(`${INICIO}(?:que|cuales) (?:tareas (?:pendientes )?(?:tengo|hay)|son mis tareas)(?: pendientes)?(?: (?:en|de) (?:google )?${FUENTE})?(?: (?:hoy|manana|esta semana|para (?:hoy|manana|esta semana)|del colegio))?(?: por favor| porfa)?$`);
// Seguimiento: solo se mira si en la conversación se acaba de hablar de lo escolar.
const SEGUIMIENTO = /\b(tareas?|pruebas?|entregas?|entregar|vencen?|plazos?|materias?|ramos?|asignaturas?|cursos?|profe|profesora?|anuncios?|material(?:es)?|evaluacion(?:es)?|guias?|colegio|classroom|lirmi|irmi|de que (?:trata|se trata)|la (?:primera|segunda|tercera|ultima))\b/;

export const plano = (s) => String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[¿?¡!.,;:"'“”()]/g, " ").replace(/\s+/g, " ").trim();
const fuente = (f) => (!f ? null : f.endsWith("irmi") ? "lirmi" : "classroom");

// { accion: "actualizar"|"listar", fuente: "classroom"|"lirmi"|null } o null.
export function parseEscolarIntent(text) {
  const p = plano(text);
  let m = ACTUALIZAR.exec(p);
  if (m) return { accion: "actualizar", fuente: fuente(m[1]) };
  m = LISTAR.exec(p);
  return m ? { accion: "listar", fuente: fuente(m[1]) } : null;
}

export const esSeguimiento = (text) => SEGUIMIENTO.test(plano(text));
