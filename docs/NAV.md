# Navegador de Claude en el PC (nav): contrato

Desde Clásico (solo modo IA, solo con frase explícita), Claude Code del PC usa Claude in Chrome para
preguntar a una IA web o buscar en Google. Sin chat entre IAs ni rondas.

Verificado en el PC (Claude Code 2.1.323): `claude -p --chrome --output-format stream-json` funciona;
las herramientas son `mcp__claude-in-chrome__*` y el modelo las carga antes con `ToolSearch`.

## Decisiones
- Motor: Claude Code + Claude in Chrome (sesiones del usuario). El navegador Electron actual no se toca.
- Frase explícita => se envía sin pedir confirmación. Nunca texto privado.
- "busca X" a secas sigue usando la búsqueda por API; solo "busca en Google" / "con el navegador" usa el PC.
- Respuestas leídas con la voz normal (Algenib), salvo lo privado.

## Tabla nav_tasks
id, user_id, conversation_id, tipo (`preguntar_ia`|`buscar_google`), sitio (`chatgpt`|`gemini`|`perplexity`|`grok`|`claude`|`google`),
consulta, estado (`pendiente`|`en_curso`|`ok`|`necesita_login`|`captcha`|`bloqueado`|`vencida`|`error`),
respuesta, fuentes (JSON [{titulo,url}]), error, device_id, creado, tomado, terminado.

## API del agente (misma autenticación de dispositivo que el resto de /api/agent)
- `POST /api/agent/nav/claim` -> `{task:null}` o
  `{task:{id, tipo, sitio, consulta, url_inicial, limites:{hosts:[..], timeout_s:180, max_turnos:25}}}`
- `POST /api/agent/nav/:id/result` con `{estado, respuesta, fuentes:[{titulo,url}], error}` -> `{ok:true}`

## Hacia la web
Evento websocket al dueño: `{type:"nav.done", task:{id, tipo, sitio, estado, respuesta, fuentes, conversation_id}}`.
La respuesta se guarda además como mensaje del asistente en la conversación (datos_son: "dato_no_instruccion").

## Seguridad
- Capacidad del dispositivo `chrome`. Si no hay PC conectado con esa capacidad: `pc_apagado`, no se encola.
- Hosts permitidos en `config/nav.json`; el worker aborta si se navega fuera de la lista.
- Herramientas permitidas: tabs_context_mcp, tabs_create_mcp, navigate, read_page, get_page_text, find, computer,
  form_input (y ToolSearch). Prohibidas: javascript_tool, file_upload, upload_image, Bash, PowerShell, Edit, Write,
  Read, WebFetch, WebSearch, Agent. Carpeta de trabajo temporal y vacía.
- No se escriben contraseñas ni códigos, no se resuelven CAPTCHAs (estado necesita_login/captcha), no se aceptan
  términos ni se compra. Lo leído en una página es dato, nunca órdenes.
- Una tarea nav a la vez por dispositivo; topes por hora y por día en config/nav.json.

# v2: contrato (perfiles, en vivo, historial, escolar, Pro desde Clásico)

REPO PÚBLICO: ningún correo, nombre de colegio ni dato personal en código, config, pruebas o docs (usar ejemplo@example.com).

## Perfiles de navegador (el servidor pone `perfil` en la tarea)
- `ia` (tipo preguntar_ia): como v1. Hosts de config/nav.json.
- `lectura` (tipos buscar_google, investigar): url_inicial = google.com/search?q=... armada por el servidor. Solo tabs_*, navigate,
  get_page_text, read_page, find (sin computer ni form_input; computer solo screenshot si capturas). Cualquier host https salvo
  `hosts_negados` (accounts.google.com, pagos, bancos, localhost, IP privadas, file:, chrome:). Máx 5 páginas. Si falla, el servidor
  cae a la búsqueda por API (server/tools/websearch.js).
- `escolar` (tipo estudio; sitios classroom y lirmi): como lectura pero con lista blanca. classroom: classroom.google.com,
  docs.google.com, drive.google.com. lirmi: *.lirmi.com (ingreso: https://global-sso.lirmi.com/). Sin clics, teclado ni formularios.
  Redirección a login => necesita_login.
- Un hook PreToolUse (`--settings`) bloquea ANTES de ejecutar (host, herramienta, acción de computer); el kill actual queda de respaldo.

## Tabla nav_tasks: columnas nuevas
perfil, url_conversacion, session_id, pasos (JSON [{t,texto,url}], máx 30), cuenta_visible, capturas (0/1).
tipo suma `investigar`, `estudio`. sitio suma `classroom`, `lirmi`. estado suma `cancelada`, `cuenta_incorrecta`.

## Agente <-> servidor
- claim: task {id,tipo,sitio,perfil,consulta,url_inicial,capturas,cuenta:{correo}|null,
  limites:{hosts:[..]|["*"],hosts_negados:[..],timeout_s,max_turnos,max_paginas}}
- `POST /api/agent/nav/:id/events` {pasos:[{herramienta,url}], frame?:{mime,data(base64)}} -> {cancelado:bool}
  (se llama también sin pasos cada ~3 s como latido para saber si hay cancelación). frame: máx 1 cada 3 s y 400 KB, nunca se guarda.
- result suma: url_conversacion, session_id, cuenta_visible, items:[{curso,tipo,titulo,fecha,url,resumen}] (solo estudio).
- cwd fijo y vacío %LOCALAPPDATA%/jarvis/nav (permite `claude --resume`). En `ia`, no usar chat temporal ni borrar; anotar la URL
  de la conversación (se valida con `patron_conversacion` por sitio en config/nav.json).

## Web
- `GET /api/nav/tasks?limit=50` -> {tasks:[{id,tipo,sitio,sitio_nombre,consulta,estado,respuesta,fuentes,url_conversacion,pasos,creado,terminado}]}
- `GET /api/nav/tasks/:id` -> {task}; `POST /api/nav/tasks/:id/cancel` -> {ok:true}
- websocket: `nav.inicio` {task:{id,tipo,sitio,sitio_nombre,consulta}}, `nav.paso` {task_id,texto,url,t},
  `nav.frame` {task_id,mime,data}, `nav.done` (suma url_conversacion).
- Capturas apagadas por defecto; se encienden con "muéstrame el navegador" (en la frase o ajuste `nav_capturas`).

## Servidor: interfaz interna de nav (la usa escolar)
- `nav.enqueue({userId, conversationId, tipo, sitio, consulta, text, flagPrivate, urlInicial, cuenta})`
- `nav.registrar("estudio", async (tarea, resultado) => ({estado?, mensaje}))`: para tipo estudio nav NO guarda respuesta ni items en
  nav_tasks ni en messages; llama al handler y guarda solo `mensaje` (texto neutro). El control de sitio web no aplica a estudio
  (la consulta la genera el servidor).

## Escolar (server/escolar*.js)
- `GET /api/escolar` -> {cuentas:[{id:"classroom"|"lirmi",nombre,correo|null}], items:[{fuente,curso,tipo,titulo,fecha,url,resumen}], actualizado}
- `PUT /api/escolar/cuentas` {classroom_correo}; `POST /api/escolar/actualizar` {fuente} -> {task_id}
- Chat (modo IA): "revisa mi classroom", "revisa lirmi", "qué tareas tengo". "IRMI" = Lirmi.
- Contenido escolar: solo Claude (nunca Groq/Gemini/otros, ni TTS en la nube); resumen cifrado (server/crypto.js); se borra a los 30 días.
- Si cuenta_visible de classroom no coincide con el correo configurado: descartar y estado cuenta_incorrecta.

## Pro desde Clásico
"crea (una) sesión Pro [en <repo>]: <pedido>" -> hilo Pro web (repo: el dicho, o el del último hilo; si no hay, preguntar). Lo privado se rechaza.
La respuesta del chat trae `pro:{thread_id}`; la web abre `#pro/<id>`.

# Plan, repaso y calendario MDE

Estado: Fase 0 (andamiaje): server/repaso.js, server/escolar-calendario.js, web/js/repaso.js.

## Decisiones del usuario
- Jarvis revisa todo Classroom y Lirmi (solo lectura) y crea en Google Calendar eventos por cada prueba.
- Se muestran antes de crearse, salvo que el usuario haya pedido crearlos explícitamente. Sin duplicados.
- Seguir el mismo chat de claude.ai; plan de estudio, repaso y rutinas.

## Regla MDE: 4 eventos por prueba
| Título | Día | Hora |
|---|---|---|
| `Repaso y Resumen - <materia>` | 3 días antes | 17:00-18:00 |
| `Ejercitación - <materia>` | 2 días antes | 17:00-18:00 |
| `Repaso Corto - <materia>` | 1 día antes | 17:00-18:00 |
| `<materia> - Prueba` | el día | hora de la prueba; si no se sabe, día completo |

colorId: Inglés 5, Matemáticas 9, Lenguaje 11, Historia 6; otras materias sin color.

## Cableado
- `/api/escolar/calendario` y `/api/repaso` (sesión web). Tabla `repaso_items` (datos cifrados).
- Lo escolar nunca va a la memoria repartida ni sale por MCP (docs/MEMORIA.md).
