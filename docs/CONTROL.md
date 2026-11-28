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

## Control amplio y ratón/teclado (hecho: pc-spec.js, pc-exec.js, pc-ui.js, pc-reglas.js)
- Dos permisos, apagados por defecto, con minutos (web, panel del freno): "Control amplio" y "Ratón y teclado (experimental)".
  Cada acción dice cuál `requiere`; lo comprueban el servidor (al encolar y al entregar) y el PC (antes de cada paso).
- El freno aborta el PowerShell en marcha y suelta botones del ratón y Shift/Ctrl/Alt/Win. Apagar un permiso rechaza lo pendiente.
- Amplio: abrir un programa del menú Inicio; mover/renombrar, crear carpeta y enviar a la papelera dentro de `pc_carpetas`
  (sin pisar nada, sin cruzar carpetas, sin secretos, nunca borrado definitivo).
- Ratón/teclado: solo sobre la lista autorizada (`GET/PUT /api/control/lista`, solo sesión web, máx 20). Leer controles
  (nombres y tipos, dato privado, sin capturas), pulsar, escribir (hasta 200, sin saltos) y teclas sueltas.
- Frases que autorizan sin tarjeta (escritas o dichas por el señor): "en <objetivo> pulsa|presiona ...",
  "abre el programa X", y con "en el pc": "borra el archivo X de <carpeta>", "mueve|renombra el archivo X de <carpeta> a Y",
  "crea la carpeta X en <carpeta>". Modelo, rutinas, atajos y escenas piden aprobación. Escribir la pide SIEMPRE.
- El texto a escribir se borra de la cola al terminar, caducar o rechazarse; no va al chat, al registro ni a la aprobación.

Lo que NO se garantiza:
- Sin probar contra Windows real: los scripts solo se han analizado sintácticamente y con execFile falso.
- Entre la última comprobación y el clic o la tecla puede cambiar la ventana o el foco. Node repite la decisión después:
  informa el fallo, pero no deshace lo ya hecho.
- El host sale de la barra de direcciones (Chromium y Firefox); puede mostrar texto editado sin navegar. No ve marcos de otros sitios.
- IsPassword depende de que la app lo declare. Las listas negras son por nombre y no cubren todos los bancos, gestores,
  botones ni idiomas; un icono sin nombre o un Enter en un formulario pueden confirmar algo.
- Una app autorizada puede traer consola o navegador dentro (editores, Explorador): autorice solo lo necesario.
- Mientras espera en la cola (máx. 30 min) el texto a escribir sí está en la base.
- La papelera depende de Windows: solo discos fijos, y un archivo mayor que la papelera podría borrarse del todo.
- Comprobar "no existe" y mover no es atómico.

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

## Rutinas (server/rutinas.js, web/js/rutinas.js)
- Tabla `rutinas` (nombre, frase, pasos JSON, horario `{dias:[0-6, 0=domingo], hora:"HH:MM", zona}`, activa, ultima).
- `/api/rutinas` (sesión web): GET, POST, PATCH `/:id`, DELETE `/:id`, POST `/:id/probar`. Panel en "Más".
- Chat: "crea una rutina [llamada X]: cada viernes a las 18 ...; luego ...", "crea una rutina cuando diga X: ...",
  "mis rutinas", "lanza|pausa|reanuda|borra la rutina X", o su frase exacta.
- Zona America/Santiago; se cambia con la variable `ZONA_HORARIA`.
- Cada paso es una frase que pasa por `chat.handle` (source `rutina`): mismas reglas que escrita a mano.
- `tick()` cada minuto, margen de 10 min, una vez por día y hora (reclamo atómico en `ultima`). Una ocasión frenada,
  o en modo Chat no se recupera. Si el servidor estuvo dormido más de 10 min, al despertar se avisa una vez que
  quedó atrasada (hasta 7 días) y no se ejecuta nada.
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

## Claude sin herramientas (server/claude-textos.js, desktop/runner/textos-worker.js)
- Cola `claude_textos`: `carga` y `resultado` cifrados (sin CONNECTIONS_KEY no se encola). Estados: `pendiente`,
  `en_curso`, `ok`, `error`, `vencida`, `cancelado`. Vence a los 30 min sin que el PC la tome o a los 7 min en curso.
  Se borra a los 30 días. Tope: 40 pedidos al día. Con el PC apagado o en pausa no se encola (`pc_apagado`).
- Uso interno: `claudeTextos.registrar(tipo, fn)` y `claudeTextos.encolar({userId, tipo, texto, meta})`.
  `fn({id,userId,tipo,meta,estado,texto,error})` recibe `ok`, `error` o `vencida`; devolver false marca el resultado
  como inservible. Lo cancelado no llega al manejador. El texto devuelto es DATO, nunca orden.
- Freno: no encola, no entrega y rechaza resultados (409). El PC mata el Claude en marcha y no envía nada.
- Rutas: `/api/agent/textos/claim` y `/:id/result` (pc; runner `textosClaim()`, `textosResult(id, out)`);
  `GET /api/textos` (estados, sin contenido) y `POST /api/textos/:id/cancel` (web).
- PC: `buildTextosArgs()`: sin herramientas, ajustes del usuario, MCP, skills, Chrome ni sesión guardada; pedido por
  stdin y carpeta temporal vacía. Si aun así intenta usar una herramienta, se corta.
