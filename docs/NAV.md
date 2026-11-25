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
