// Clasifica una acción que Claude no pudo hacer sin permiso en uno de los tipos de config/permissions.json.
const BORRAR = /(^|[\s;&|])(rm|rmdir|del|erase|rd|unlink|shred|remove-item|ri)(\s|$)|git\s+(clean|reset\s+--hard|branch\s+-D)/i;
const PUSH = /git\s+push/i;
const DESPLEGAR = /(deploy|desplieg|npm\s+publish|vercel|netlify|render\s|fly\s+deploy|gh\s+release|docker\s+push|kubectl\s+apply)/i;
const MENSAJE = /(sendmail|mailx?\s|smtp|telegram|slack|whatsapp|twilio|gh\s+(pr|issue)\s+comment|Send-MailMessage)/i;

export function classifyDenial({ tool_name: tool, tool_input: input = {} }) {
  const cmd = String(input.command ?? "");
  if (tool === "Bash" || tool === "PowerShell") {
    if (PUSH.test(cmd)) return { kind: "git_push", summary: `Subir cambios con git push`, detail: cmd };
    if (DESPLEGAR.test(cmd)) return { kind: "desplegar", summary: `Desplegar o publicar`, detail: cmd };
    if (BORRAR.test(cmd)) return { kind: "borrar", summary: `Borrar archivos`, detail: cmd };
    if (MENSAJE.test(cmd)) return { kind: "enviar_mensaje", summary: `Enviar un mensaje`, detail: cmd };
    return { kind: "terminal_libre", summary: `Ejecutar en la terminal`, detail: cmd };
  }
  const objetivo = input.file_path || input.path || input.url || input.pattern || "";
  if (/^(WebFetch|WebSearch)$/.test(tool)) return { kind: "enviar_mensaje", summary: `Acceder a internet (${tool})`, detail: String(objetivo) };
  return { kind: "terminal_libre", summary: `Usar ${tool} fuera de lo permitido`, detail: String(objetivo) };
}

// Regla --allowedTools que habilita exactamente lo aprobado (no toda la herramienta).
export function allowRule({ tool_name: tool, tool_input: input = {} }) {
  if (input.command) return `${tool}(${input.command})`;
  const t = input.file_path || input.path;
  return t ? `${tool}(${t})` : tool;
}
