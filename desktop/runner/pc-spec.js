// Verdad del PC sobre las acciones permitidas (Ola 0/1 del control del PC). Módulo puro, sin dependencias:
// lo usa el PC para validar OTRA VEZ lo que manda el servidor y el servidor para validar lo que encola
// (config/pc-actions.json debe coincidir con esto; hay una prueba que lo comprueba).
// Nunca se ejecuta texto libre: los parámetros son enteros, valores de una lista o texto que solo se COPIA al portapapeles/aviso.

export const PC_ACTIONS = {
  multimedia: { nivel: "automatico", params: { valor: { tipo: "enum", valores: ["play_pausa", "siguiente", "anterior"] } } },
  volumen: { nivel: "automatico", params: {
    accion: { tipo: "enum", valores: ["subir", "bajar", "silencio", "fijar"] },
    nivel: { tipo: "rango", min: 0, max: 100, opcional: true },
    pasos: { tipo: "rango", min: 1, max: 10, opcional: true },
  } },
  bloquear: { nivel: "automatico", params: {} },
  temporizador: { nivel: "automatico", params: { minutos: { tipo: "rango", min: 1, max: 720 }, texto: { tipo: "texto", max: 80, opcional: true } } },
  abrir_app: { nivel: "automatico", params: { app: { tipo: "app" } } },
  estado_sistema: { nivel: "automatico", params: {} },
  portapapeles_escribir: { nivel: "automatico", params: { texto: { tipo: "texto", max: 2000 } } },
  portapapeles_leer: { nivel: "aprobacion", privado: true, params: {} },
  suspender: { nivel: "automatico", params: {} },
  apagar: { nivel: "aprobacion", params: {} },
  reiniciar: { nivel: "aprobacion", params: {} },
};

// Aplicaciones que el PC sabe abrir: nombre -> comando FIJO y argumentos FIJOS (sin shell). Editable en config.json del
// escritorio (`pc_apps`), nunca desde el servidor. El servidor solo manda el nombre.
export const DEFAULT_APPS = {
  calculadora: { cmd: "calc.exe", args: [] },
  "bloc de notas": { cmd: "notepad.exe", args: [] },
  explorador: { cmd: "explorer.exe", args: [] },
  paint: { cmd: "mspaint.exe", args: [] },
  "administrador de tareas": { cmd: "taskmgr.exe", args: [] },
  configuracion: { cmd: "explorer.exe", args: ["ms-settings:"] },
  spotify: { cmd: "explorer.exe", args: ["spotify:"] },
};

export const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
// Caracteres de control (salvo tabulación y saltos de línea) fuera.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function checkSpec(spec, v, nombre, apps) {
  const vacio = v === undefined || v === null || v === "";
  if (vacio) return spec.opcional ? { ok: true, value: undefined } : { ok: false, error: `falta_${nombre}` };
  switch (spec.tipo) {
    case "enum": {
      const s = typeof v === "string" ? v.toLowerCase().trim() : "";
      return spec.valores.includes(s) ? { ok: true, value: s } : { ok: false, error: `${nombre}_invalido` };
    }
    case "rango": {
      if (typeof v !== "number" && !(typeof v === "string" && /^\d{1,4}$/.test(v.trim()))) return { ok: false, error: `${nombre}_invalido` };
      const n = Number(v);
      return Number.isInteger(n) && n >= spec.min && n <= spec.max ? { ok: true, value: n } : { ok: false, error: `${nombre}_fuera_de_rango` };
    }
    case "texto": {
      if (typeof v !== "string") return { ok: false, error: `${nombre}_invalido` };
      return v.trim() && v.length <= spec.max && !CONTROL.test(v) ? { ok: true, value: v } : { ok: false, error: `${nombre}_invalido` };
    }
    case "app": {
      const hit = (apps || []).find((a) => norm(a) === norm(v));
      return hit ? { ok: true, value: hit } : { ok: false, error: "app_no_permitida" };
    }
    default: return { ok: false, error: "tipo_desconocido" };
  }
}

// def = { nivel, params } (del servidor o de PC_ACTIONS). Devuelve { ok, params } | { ok:false, error }.
// Solo se copian los parámetros declarados; cualquier otra clave se descarta.
export function validateParams(id, input, { defs = PC_ACTIONS, apps = Object.keys(DEFAULT_APPS) } = {}) {
  const def = Object.hasOwn(defs, id) ? defs[id] : null;
  if (!def) return { ok: false, error: "accion_desconocida" };
  const src = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const params = {};
  for (const [k, spec] of Object.entries(def.params || {})) {
    const r = checkSpec(spec, src[k], k, apps);
    if (!r.ok) return r;
    if (r.value !== undefined) params[k] = r.value;
  }
  if (id === "volumen") {
    if (params.accion === "fijar" && params.nivel === undefined) return { ok: false, error: "falta_nivel" };
    if (params.accion !== "fijar") delete params.nivel;
    if (params.accion !== "subir" && params.accion !== "bajar") delete params.pasos;
  }
  return { ok: true, params, def };
}
