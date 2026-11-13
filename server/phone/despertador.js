// Correo despertador: único camino gratis para que el servidor "toque" el iPhone. Una automatización
// de iOS ("Correo", asunto con JARVIS·) ejecuta el Atajo Jarvis Puente al recibirlo.
// EXCEPCIÓN ACOTADA a "enviar correo pide aprobación": solo hacia PHONE_NUDGE_EMAIL y solo con asunto JARVIS·<nonce>,
// sin comando ni datos en el cuerpo. Cualquier otro envío sigue pasando por la aprobación del teléfono.
import { randomBytes } from "node:crypto";

const MAX_HORA = 20, HORA_MS = 3_600_000, AGRUPA_MS = 60_000;
const ASUNTO = /^JARVIS·[0-9a-f]{12}$/;

export function createDespertador({ env = process.env, bus, audit, getGoogle, now = () => Date.now() }) {
  const to = () => String(env.PHONE_NUDGE_EMAIL || "").trim();
  const envios = []; // marcas de tiempo de los correos enviados (en memoria)
  const log = (userId, action, detail = "") => audit?.log({ userId, action, detail });

  async function conectado(userId) {
    try { const g = getGoogle(); return !!(g && (await g.connected(userId))); } catch { return false; }
  }
  async function configurado(userId) { return !!to() && (await conectado(userId)); }

  async function nudge(userId) {
    const omitir = (why) => log(userId, "phone.despertador_omitido", why).then(() => ({ sent: false, why }));
    if (!to()) return omitir("sin PHONE_NUDGE_EMAIL");
    if (!(await conectado(userId))) return omitir("Gmail no conectado");
    const t = now();
    while (envios.length && t - envios[0] >= HORA_MS) envios.shift();
    if (envios.length && t - envios[envios.length - 1] < AGRUPA_MS) return { sent: false, why: "agrupado" };
    if (envios.length >= MAX_HORA) return omitir("límite de 20 por hora");
    const subject = `JARVIS·${randomBytes(6).toString("hex")}`; // nonce de un solo uso
    if (!ASUNTO.test(subject)) return omitir("asunto inválido");
    envios.push(t);
    try {
      await getGoogle().sendEmail(userId, { to: to(), subject, body: "Jarvis" });
    } catch (e) {
      envios.pop();
      return omitir(`error de envío: ${String(e.message).slice(0, 80)}`);
    }
    await log(userId, "phone.despertador_enviado", subject);
    return { sent: true, subject };
  }

  // Cada acción que queda "lista" (automática o ya aprobada) despierta el teléfono.
  bus?.on("phone.lista", ({ userId }) => { nudge(userId).catch((e) => console.error("[despertador]", e.message)); });
  return { nudge, configurado };
}
