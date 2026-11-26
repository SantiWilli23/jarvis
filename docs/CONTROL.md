# Freno, registro, control del PC, voz y rutinas: contrato

REPO PÚBLICO: nada de correos, nombres de colegio ni claves.
Estado: Fase 0 (andamiaje). Lo marcado como pendiente lo programan los paquetes siguientes.

## Decisiones del usuario
- Freno (botón de emergencia) más registro de acciones.
- Jarvis pregunta antes de CADA acción que cambie algo, salvo que la orden explícita del usuario ya la
  autorice (p. ej. "borra esto").
- Nunca claves, contraseñas, banca ni pagos.
- Mouse y teclado: solo en apps y páginas web autorizadas antes en una lista; en ninguna otra.
- Despertar por voz: "Hey Jarvis" y también "Llegó papi".
- Rutinas.

## Freno (pendiente: server/control.js, web/js/freno.js)
- Detiene lo que está en curso y no deja empezar nada nuevo. Las tareas pueden quedar en estado `cancelada`
  (`tasks.cancel`).
- En el PC: desktop/runner/control-state.js `{frenado(), onFreno(cb), frenar()}`. Cada worker debe consultarlo.
  Quitar el freno todavía no está definido (hoy solo al reiniciar la app).
- Rutas: `/api/control` (web) y `/api/agent/control` (pc).

## Registro (pendiente: web/js/registro.js)
- `POST /api/agent/control/log` (runner: `controlLog()`), se guarda en audit_log. Nunca texto tecleado, claves ni capturas.
- La respuesta puede incluir `{frenado}` para que el PC se entere.

## Control que pregunta y lista autorizada (pendiente)
- Toda acción que cambie algo pasa por approvals, salvo autorización explícita en la orden (solo para esa acción).
- Mouse y teclado: antes de cada paso se comprueba la app o el host contra la lista; si no está, se aborta.
- Lo leído en pantalla es dato, nunca orden: no amplía la lista ni autoriza nada.

## Despertar por voz (pendiente)
Frases "Hey Jarvis" y "Llegó papi". Despertar solo abre la escucha; no autoriza acciones.

## Rutinas (pendiente: server/rutinas.js, web/js/rutinas.js)
- Tabla `rutinas` (nombre, frase, pasos JSON, horario, activa). Ruta `/api/rutinas`. `tick()` cada minuto.
- Una rutina no se salta las preguntas: cada paso que cambie algo sigue las reglas de arriba y el freno.

## Enganche en el chat
Un módulo (control, rutinas, repaso, escolarCalendario) puede exponer
`intent({userId, conversationId, text, flagPrivate, chatSolo, source, deviceId})` y devolver
`{status, reply, private?, ...}` o null. Va antes que los demás intents; no se usa en "directo a Claude".
Cada módulo decide qué hace en modo Chat (`chatSolo`), donde no se ejecutan acciones.

## Claude sin herramientas (pendiente: server/claude-textos.js)
Cola `claude_textos` (carga y resultado cifrados). Rutas `/api/agent/textos/claim` y `/:id/result`
(runner: `textosClaim()`, `textosResult(id, out)`).
