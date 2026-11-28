// Funciones sin modelo (docs/FUNCIONES.md): buenos días, recordatorios, notas y comuna.
// Todo sale como privado: no entra al historial de otros modelos ni usa voces en la nube.
import { limpiar, local, sumarDias, fechaCorta, horaTexto, ZONA } from "./comun.js";
import { parseRecordatorio, createRecordatorios } from "./recordatorios.js";
import { createNotas, parseNotas } from "./notas.js";
import { createClima, parseComuna } from "./clima.js";
import { leerFecha, esPrueba, materia } from "../escolar-calendario.js";

const SALUDO = /^(?:buenos dias|buen dia)(?:,? (?:oye )?jarvis)?$/;
export const esBuenosDias = (text) => SALUDO.test(limpiar(text).p);
const MSG_CHAT = "En modo Chat no hago acciones, señor. Cambie a modo IA y vuelva a pedírmelo.";
const GUARDADO = "(Aquí le di al señor el resumen del día. No se guarda en la conversación.)";
const VENTANA = 7;

export function createFunciones({ db, escolar = null, audit = null, fetch: f, zona = ZONA, now = () => Date.now() }) {
  const recordatorios = createRecordatorios({ db, audit, zona, now });
  const notas = createNotas({ db, audit, now });
  const clima = createClima({ db, fetch: f, zona, now });

  const corto = (s, n = 50) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const diaDicho = (d, hoy) => (d === hoy ? "hoy" : d === sumarDias(hoy, 1) ? "mañana" : `el ${fechaCorta(d)}`);

  // reservado = al Atajo y a Telegram no viaja contenido escolar: solo cuántas cosas hay.
  async function delColegio(userId, hoy, reservado) {
    let datos;
    try { datos = escolar ? await escolar.resumen(userId) : null; } catch { datos = null; }
    if (!datos?.items.length) return ["No tengo datos de Classroom."];
    const hasta = sumarDias(hoy, VENTANA);
    const conFecha = datos.items.map((i) => ({ i, dia: leerFecha(i.fecha, hoy)?.dia }))
      .filter((x) => x.dia && x.dia >= hoy && x.dia <= hasta).sort((a, b) => a.dia.localeCompare(b.dia));
    const pruebas = conFecha.filter((x) => esPrueba(x.i));
    const tareas = conFecha.filter((x) => !esPrueba(x.i) && /tarea|entrega|assignment/i.test(x.i.tipo));
    const n = (l, uno, varios) => `${l.length} ${l.length === 1 ? uno : varios}`;
    if (reservado) {
      return [pruebas.length || tareas.length ? `Del colegio, esta semana: ${n(pruebas, "prueba", "pruebas")} y ${n(tareas, "tarea", "tareas")}; véalas en Jarvis.` : "Sin pruebas ni tareas con fecha esta semana."];
    }
    const out = [pruebas.length ? `Pruebas: ${pruebas.slice(0, 3).map((x) => `${materia(x.i)} ${diaDicho(x.dia, hoy)}`).join(", ")}${pruebas.length > 3 ? ` y ${pruebas.length - 3} más` : ""}.` : "Sin pruebas con fecha esta semana."];
    if (tareas.length) out.push(`Pendientes de Classroom: ${tareas.slice(0, 2).map((x) => `${corto(x.i.titulo, 40)} (${diaDicho(x.dia, hoy)})`).join(", ")}${tareas.length > 2 ? ` y ${tareas.length - 2} más` : ""}.`);
    return out;
  }

  async function resumenDia(userId, reservado = false) {
    const hoy = local(now(), zona).dia;
    const [tiempo, colegio, pend] = await Promise.all([clima.hoy(userId), delColegio(userId, hoy, reservado), recordatorios.pendientes(userId)]);
    const deHoy = pend.filter((r) => local(Number(r.due_at), zona).dia <= hoy);
    const rec = deHoy.length
      ? `Recordatorios de hoy: ${deHoy.slice(0, 3).map((r) => { const a = local(Number(r.due_at), zona); return `${Number(r.due_at) < now() ? "atrasado" : horaTexto(a.h, a.min)}, ${corto(r.text, 40)}`; }).join("; ")}${deHoy.length > 3 ? ` y ${deHoy.length - 3} más` : ""}.`
      : "Sin recordatorios para hoy.";
    return ["Buenos días, señor.", tiempo, ...colegio, rec].join(" ");
  }

  // Enganche del chat (docs/CONTROL.md). null = la frase no es de aquí y sigue su camino normal.
  async function intent({ userId, text, chatSolo = false, source = "texto" }) {
    const salida = (reply, extra = {}) => ({ status: "funcion", private: true, reply, ...extra });
    if (esBuenosDias(text)) {
      if (chatSolo) return null; // modo Chat: es solo un saludo
      return salida(await resumenDia(userId, source === "atajo" || source === "telegram"), { guardar: GUARDADO });
    }
    const comuna = parseComuna(text);
    const rec = comuna ? null : parseRecordatorio(text, now(), zona);
    if (chatSolo) return comuna || rec || parseNotas(text) ? salida(MSG_CHAT) : null;
    if (comuna) return salida(await clima.fijar(userId, comuna));
    if (rec) return salida(await recordatorios.atender(userId, rec));
    const nota = await notas.intent(userId, text);
    return nota ? salida(nota) : null;
  }

  return { intent, resumenDia };
}
