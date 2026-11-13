// Clasificador por reglas (sin modelo). Devuelve { kind, private }.
// kind: charla | razonamiento | foto_video | investigacion | accion_pc | privado
const RE_PRIVADO = /\b(privad[oa]|confidencial|secret[oa]|contrase[ñn]a|clave\s+de|mi\s+banco|tarjeta|salud|m[eé]dic[oa])\b/i;
const RE_ACCION_PC = /\b(en\s+(mi\s+)?(pc|ordenador|computadora)|abre\s+(el|la|mi)|ejecuta|compila|despliega|haz\s+(un\s+)?commit|git\s+\w+|arregla\s+(el|la)\s+(bug|c[oó]digo)|programa|refactoriza|crea\s+(un\s+)?(archivo|carpeta)|borra\s+(el|la|los)\s+archivo)/i;
const RE_INVESTIGACION = /\b(investiga|busca\s+en\s+(internet|la\s+web)|[uú]ltimas\s+noticias|noticias\s+de|qui[eé]n\s+gan[oó]|precio\s+actual|qu[eé]\s+pas[oó])\b/i;
const RE_RAZONAMIENTO = /\b(por\s*qu[eé]|explica|compara|analiza|calcula|demuestra|resuelve|paso\s+a\s+paso|ventajas|desventajas|planifica|estrategia)\b/i;

export function classify(text, { attachments = [], flagPrivate = false } = {}) {
  const t = String(text || "");
  const priv = !!flagPrivate || RE_PRIVADO.test(t);
  let kind = "charla";
  if (attachments.some((a) => /^(image|video)\//.test(a.mime || a))) kind = "foto_video";
  else if (RE_ACCION_PC.test(t)) kind = "accion_pc";
  else if (RE_INVESTIGACION.test(t)) kind = "investigacion";
  else if (RE_RAZONAMIENTO.test(t) || t.length > 280) kind = "razonamiento";
  if (priv) kind = kind === "accion_pc" ? "accion_pc" : "privado";
  return { kind, private: priv };
}
