// Motivos por los que Pro no está habilitado, a partir de las capacidades que reporta el PC.
// Pro funciona con SOLO Claude.

// Ids de Claude que la configuración usa de verdad (una sola fuente: config/pro.json modelos.claude).
export function claudeIds(cfg) {
  const m = cfg?.modelos?.claude || {};
  const ids = ["planear", "programar", "verificar", "consultar"].map((k) => m[k]).filter((x) => typeof x === "string" && x);
  if (m.fallback_planear_verificar) ids.push(m.fallback_planear_verificar);
  const need = ids.length ? ids : cfg?.requisitos?.claude_modelos || [];
  return [...new Set(need)];
}
// Ids que Pro NO puede funcionar sin: los de planear/programar/verificar/consultar (el fallback es opcional).
export function claudeRequired(cfg) {
  const m = cfg?.modelos?.claude || {};
  const ids = ["planear", "programar", "verificar", "consultar"].map((k) => m[k]).filter((x) => typeof x === "string" && x);
  const need = [...new Set(ids.length ? ids : cfg?.requisitos?.claude_modelos || [])];
  return cfg?.local_visible === false ? need.filter((id) => !/opus/i.test(id)) : need; // Pro local escondido: Opus ni se sondea ni se exige
}

export function proReasons({ pcOnline, caps, cfg }) {
  const m = [];
  const req = cfg?.requisitos || {};
  if (!pcOnline) m.push("pc_apagado");
  const c = caps || {};
  const cl = c.claude || {};
  const faltan = claudeRequired(cfg).filter((x) => !(cl.modelos || []).includes(x));
  if (cl.error === "sin_login") m.push("claude_sin_login");
  else if (cl.error === "modelo_no_disponible" || (cl.ok && faltan.length)) m.push("claude_modelo_no_disponible");
  else if (!cl.ok || faltan.length) m.push("claude_no_listo");
  if (req.repos_git && !(c.repos || []).length) m.push("sin_repos_git");
  return m;
}
