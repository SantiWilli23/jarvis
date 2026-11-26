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

## Despertar por voz
Frases "Hey Jarvis" y "Llegó papi". Despertar solo abre la escucha; no autoriza acciones.

Hecho en la app de escritorio ("Hey Jarvis", desktop/wake/):
- Interruptor "Escuchar Hey Jarvis" en la bandeja, apagado por defecto (config.json `despertar`). Encendido:
  punto verde en el icono y aviso en el texto emergente. El freno lo apaga y no se vuelve a encender solo.
- Detección local con openWakeWord sobre onnxruntime-web. Una ventana oculta captura el micrófono y pasa
  bloques al proceso principal; mientras espera, el audio no sale del PC ni se guarda.
- Al oírlo se muestra la ventana y se lanza `jarvis:mic` (igual que el atajo). La grabación termina como
  siempre: otro toque o 30 s (aún sin corte por silencio).
- Se pausa mientras la web graba, piensa o habla (`state.js` y `ocupado()` de `voice.js`) o si no cargó.
- Modelos (CC BY-NC-SA, no comercial; no van al repo): `node scripts/get-wake-models.mjs` los baja de la
  release v0.5.1 de dscripka/openWakeWord a `%APPDATA%/jarvis-desktop/wake` y comprueba su sha256.

Pendiente:
- "Llegó papi" (desktop/wake/llego-papi.js, vacío): falta permiso para descargar el modelo Vosk en español
  y su librería, implementarlo y medir falsos positivos.
- Vista del teléfono /m (orbe, "Jarvis", 3 s de silencio) y Atajo/widget.
- Probar con micrófono real y con la app instalada (empaquetada).

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
