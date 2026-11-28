# Navegador de Claude en el PC (nav): contrato

Desde Clásico (solo modo IA, solo con frase explícita), Claude Code del PC usa Claude in Chrome para
preguntar a una IA web o buscar en Google. Sin chat entre IAs ni rondas.

Verificado en el PC (Claude Code 2.1.323): `claude -p --chrome --output-format stream-json` funciona;
las herramientas son `mcp__claude-in-chrome__*` y el modelo las carga antes con `ToolSearch`.

## Decisiones
- Motor: Claude Code + Claude in Chrome (sesiones del usuario). El navegador Electron actual no se toca.
- Frase explícita => se envía sin pedir confirmación. Nunca texto privado.
- "busca X" a secas sigue usando la búsqueda por API; solo "busca en Google" / "con el navegador" usa el PC.
- Respuestas leídas con la voz normal (Enceladus), salvo lo privado.

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
  form_input, browser_batch (y ToolSearch). Prohibidas: javascript_tool, file_upload, upload_image, Bash, PowerShell, Edit, Write,
  Read, WebFetch, WebSearch, Agent. Carpeta de trabajo temporal y vacía.
- El hook corre con el node del PATH (si no hay o falla, con el propio ejecutable de la app) y Claude con `--effort low`.
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

## Seguir el mismo chat (claude.ai)
- "háblale a Claude", "dile a Claude" o "sigue con Claude" (y "pregúntale a Claude") continúan la conversación; "chat nuevo con Claude" abre otra.
- Solo sitios con `continuar` en config/nav.json: último `url_conversacion` válido de la misma conversación de Jarvis o de las últimas `continuar_horas`.
- Se revalida al reclamar; la tarea lleva `continuacion:true` (escribir al final y copiar solo la respuesta nueva).
- Tipos `memoria_recoger` y `memoria_repartir`: docs/MEMORIA.md.

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

Estado: hechos el plan y repaso (server/repaso.js, web/js/repaso.js) y el calendario (server/escolar-calendario.js, botón en Estudiar).

## Plan de estudio y repaso
- Chat (solo modo IA): "hazme un plan de estudio", "repasemos <materia>" (materia conocida o curso guardado).
- Plan: 7 días, según lo escolar guardado con fecha en los próximos 14. Repaso: 8 tarjetas; sin material, generales.
- Espaciado: niveles 0 a 5 (0, 1, 3, 7, 14, 30 días); fallar vuelve a 0 y reaparece en 10 minutos.
- Solo Claude en el PC (cola de textos, docs/CONTROL.md). `repaso_items` cifrado, 30 días.
- El chat solo dice avisos neutros (nada escolar en messages, voz ni Atajo); el contenido se ve en el panel Repaso.
- Rutas: `GET /api/repaso`, `POST /plan`, `/materia`, `/tarjetas/:id {sabia}`, `DELETE /datos`.

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

## Calendario (server/escolar-calendario.js)
- Pruebas: lo escolar guardado con tipo o título de evaluación y fecha de hoy en adelante (AAAA-MM-DD, dd/mm, "3 de diciembre"; hora solo si viene en `fecha`, y dura 1 h). Las de fecha ilegible se cuentan y se avisa.
- `GET /api/escolar/calendario` -> {conectado, eventos:[{id,titulo,dia,inicio,fin,colorId?,existe?}], sinFecha, mensaje}. `POST` {ids} -> {creados,omitidos,fallidos,mensaje} (solo los ids mostrados). El clic es el permiso: no pasa por approvals.
- Duplicado = mismo título (sin tildes ni mayúsculas) y mismo día. Si no se puede consultar el calendario, no se crea.
- Chat: "pon mis pruebas en el calendario" crea; "qué pondrías en el calendario" solo muestra. Modo Chat: no actúa. Con freno no crea. Atajo y Telegram no reciben la lista.
- `intent()` puede devolver `guardar`: texto neutro que va a messages y al bus en lugar de `reply`. Audit: solo conteos.
- Zona horaria: `CALENDARIO_ZONA` (por defecto America/Santiago).

## Cableado
- `/api/escolar/calendario` y `/api/repaso` (sesión web). Tabla `repaso_items` (datos cifrados).
- Lo escolar nunca va a la memoria repartida ni sale por MCP (docs/MEMORIA.md).

# Ahorro de uso de Claude

## Medida y topes
- El PC lee de `result` el costo equivalente y los tokens (entrada, salida, caché leída y escrita) y los manda en `uso` dentro del resultado. Columnas `costo_usd`, `tok_*` y `guardada` de nav_tasks. Log del PC sin contenido. `/api/status` trae `uso_navegador: {costo_dia, tope}` (últimas 24 h).
- Una tarea cortada antes de `result` (cancelada, tiempo, host bloqueado) no informa costo y no suma.
- `limites.max_budget_usd` por tarea (`--max-budget-usd`; puede pasarse un poco) y `limites.tope_costo_dia` al encolar (error `tope_costo`). Con 0 o sin la clave quedan apagados.
- `perfiles.<perfil>.modelo`: por defecto sonnet.

## Ajustes (config/nav.json, `ahorro`; viajan en el claim; `false` vuelve a lo anterior)
| Clave | Qué hace |
|---|---|
| `cache_5m` | `CLAUDE_CODE_PROMPT_CACHE_TTL=5m` |
| `sin_toolsearch` | `ENABLE_TOOL_SEARCH=false`, sin paso ToolSearch, `--tools ""` y se deniegan las de Chrome que sobran |
| `sin_texto` | sin texto entre herramientas |
| `entorno_limpio` | no hereda `CLAUDE*` (salvo CLAUDE_CONFIG_DIR, CLAUDE_CODE_OAUTH_TOKEN, CLAUDE_CODE_GIT_BASH_PATH) |
| `prompt_propio` | `--system-prompt` en vez de añadir al de Claude Code |
| `pocas_capturas` | perfil ia: find/read_page en vez de capturas; get_page_text solo al final |

Sin probar con Chrome real: `sin_toolsearch`, `prompt_propio` y `pocas_capturas`. Si las tareas fallan, apague primero esas tres.

## Respuestas guardadas
`cache_horas` (24; 0 apaga). Mismo usuario, tipo, sitio y consulta exacta con éxito: se entrega con "(respuesta guardada)", sin PC y sin contar en los topes. No aplica a estudio ni memoria, a chats que se continúan, a "de nuevo"/"chat nuevo" ni al pedir capturas. La privacidad se revisa antes.

## Fuera del navegador
- Textos y sondas: caché de 5 min. Sondas del doctor: 24 h (se olvidan si una tarea falla por modelo o sesión; reiniciar la app también sondea), sin guardar sesión. Con `local_visible:false` en config/pro.json no se sondea ni se exige Opus.
- Clásico y Pro: `--strict-mcp-config --disable-slash-commands`. No se usa `--setting-sources`: quitaría hooks, permisos, modelo por defecto e instrucciones del usuario o del repo. La descripción de capturas sí usa `--setting-sources ""`.

# Modelo: selector Haiku/Sonnet

Encendido (`ahorro.elegir_modelo: true` en config/nav.json; con `false` vuelve a lo de antes). Por usuario: `PUT /api/settings {nav_elegir_modelo: true|false}`
(si no se puso, manda la config). Fuera de Pro el modelo va siempre explícito y nunca es Opus.

`modelos`: `barato` (claude-haiku-5-5), `fuerte` (sonnet), `umbral` (3), `escalar` (true), `capturas` (`fuerte`|`barato`).

## Cómo elige (server/modelo-elige.js, sin IA; se decide en el claim)
Puntos >= umbral => fuerte. buscar_google y preguntar a ChatGPT/Gemini/Perplexity/Grok 0; claude.ai +1; investigar, estudio y memoria +3;
seguir un chat -1; capturas +2; consulta de más de 1500 caracteres +1; varios pasos +2; entregar/subir/rellenar/publicar +3;
Haiku con 25% o más de fallos ahí (mínimo 4 casos, 30 días) +3. Perfil escolar o tareas del colegio: siempre Sonnet.
Textos: Haiku solo si son menos de 2000 caracteres, sin tono formal ni código y no escolares (plan y repaso lo son: hoy van con Sonnet).
Clásico: siempre Sonnet. Capturas: `modelos.capturas`.

## Forzar por texto (funciona también con el selector apagado)
"con haiku", "con sonnet", "con (el) modelo rápido|fuerte": antes de la orden ("con haiku, pregúntale a ..."), justo después
("pregúntale a ChatGPT con haiku ...") o al final tras una coma. En medio de la consulta no cuenta. No usa respuestas guardadas.
Las tareas del colegio siguen con Sonnet.

## Reintento
El claim manda `limites.modelo` y, si es Haiku, `limites.escalar` y `margen_dia_usd`. El PC repite UNA vez con Sonnet si hubo
modelo_no_disponible, tope de costo, tope de turnos, respuesta sin JSON o estado error. No si quedó bloqueado, cancelada, tiempo,
sin login o sin cuota, ni si hubo algún clic, tecleo o formulario (en la práctica: solo fallos antes de actuar). Además el intento
debe costar menos de la mitad de `max_budget_usd`, quedar tope diario y plazo. Los costos se suman y el resultado lleva
`escalada` y `motivo_escalada`.

## Vuelta atrás y disponibilidad
- Con 4 o más tareas de Haiku en un tipo y sitio, si costaron (reintentos incluidos) 70% o más de lo estimado con Sonnet
  (promedio medido ahí), Haiku se apaga ahí 7 días (ajuste `nav_haiku_pausa:<tipo>:<sitio>`). Sin costos de Sonnet no se evalúa.
- El doctor sondea también el id barato; si no responde se usa el fuerte y Pro no se ve afectado.
- nav_tasks: `modelo`, `modelo_motivo`, `escalada`, `modelo_forzado`. La vista Chats muestra modelo y motivo.
- Una app del PC antigua usa `limites.modelo` pero no reintenta; con un servidor antiguo la app nueva usa Sonnet.

Prueba real (gasta uso de Claude): `node scripts/probar-haiku.mjs` (`--falso` ensaya sin modelos).
