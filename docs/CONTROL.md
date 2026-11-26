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

## Rutinas (server/rutinas.js, web/js/rutinas.js)
- Tabla `rutinas` (nombre, frase, pasos JSON, horario `{dias:[0-6, 0=domingo], hora:"HH:MM", zona}`, activa, ultima).
- `/api/rutinas` (sesión web): GET, POST, PATCH `/:id`, DELETE `/:id`, POST `/:id/probar`. Panel en "Más".
- Chat: "crea una rutina [llamada X]: cada viernes a las 18 ...; luego ...", "crea una rutina cuando diga X: ...",
  "mis rutinas", "lanza|pausa|reanuda|borra la rutina X", o su frase exacta.
- Zona America/Santiago; se cambia con la variable `ZONA_HORARIA`.
- Cada paso es una frase que pasa por `chat.handle` (source `rutina`): mismas reglas que escrita a mano.
- `tick()` cada minuto, margen de 10 min, una vez por día y hora (reclamo atómico en `ultima`). Una ocasión frenada,
  en modo Chat o con el servidor dormido más de 10 min no se recupera.
- Por horario NO hay autorización: solo corren solos los pasos que leen (lo escolar, "revisa mis tareas", estado del
  PC o del iPhone). Cada paso restante pide una aprobación `rutina:<id>` (vale 12 h); al aprobar se ejecuta ese paso
  con las reglas de siempre, que pueden pedir otra. Los pasos que esperan no detienen a los que leen.
- Con el freno o en modo Chat no corre nada. Una rutina no crea ni lanza otra.
- Topes: 20 rutinas, 8 pasos de 200 caracteres, 30 ejecuciones en 24 h, una a la vez.
- No se guardan pasos privados, de claves ni de pagos. Aviso push solo con cifras, sin nombres ni contenido.
- audit: `rutina.creada|cambiada|borrada|ejecutada|omitida|paso|permiso_vencido` (solo ids y estados).

## Enganche en el chat
Un módulo (control, rutinas, repaso, escolarCalendario) puede exponer
`intent({userId, conversationId, text, flagPrivate, chatSolo, source, deviceId})` y devolver
`{status, reply, private?, ...}` o null. Va antes que los demás intents; no se usa en "directo a Claude".
Cada módulo decide qué hace en modo Chat (`chatSolo`), donde no se ejecutan acciones.

## Claude sin herramientas (pendiente: server/claude-textos.js)
Cola `claude_textos` (carga y resultado cifrados). Rutas `/api/agent/textos/claim` y `/:id/result`
(runner: `textosClaim()`, `textosResult(id, out)`).
