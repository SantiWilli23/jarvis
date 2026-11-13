# Plan de construcción de Jarvis

Planificado con Fable 5.2 (esfuerzo bajo). Se construye con Sonnet 5.5. Nada se despliega ni se publica sin permiso del dueño.

## Decisiones fijas
- Nube gratis (Render + Turso) como casa principal; el PC (app Electron) es un extra que recoge la cola y se la pasa a Claude Code (`claude -p --output-format stream-json`, sin `--bare`, texto por stdin).
- iPhone: PWA solo con Safari (graba audio y lo transcribe Groq Whisper; el mic se activa tocando el orbe), Telegram y widget de Atajos (`/api/shortcut`).
- Solo el dueño, pero BD con `users` y `user_id` en todo (invitados después, sin Claude ni PC).
- Seguridad: contraseña + lista de permitidos, límite de intentos, claves solo en `.env`, sin puertos abiertos.
- Privacidad: lo privado solo va a Claude y Groq; nunca a Gemini, Mistral, DeepSeek, OpenRouter.
- Claude Pro: tope por tarea y diario. Leer y escribir en carpetas permitidas = automático; borrar, terminal libre, enviar y `git push` = aprobación en el teléfono.
- Cadena gratis: Gemini, Groq, Mistral, DeepSeek vía OpenRouter, OpenRouter/Cloudflare, Ollama. ChatGPT, Grok y Perplexity son puestos apagados hasta pegar clave, con sustituto gratis.
- Voz: masculina grave en español (voz del sistema; luego Piper/Kokoro). No se clona la voz de ningún actor.
- Cola directa: el texto se guarda byte a byte, sin pasar por ningún modelo; la hora va en un encabezado aparte.

## Estructura
```
package.json  .env.example  .gitignore  render.yaml (preparado, no se despliega)
config/   providers.json  permissions.json  persona.md
server/   index.js  db/  auth/  router/  providers/  memory/  queue/
          approvals.js  audit.js  stt.js  ws-hub.js  routes/
web/      index.html (maqueta aprobada) css/hud.css  js/  manifest  sw.js
desktop/  (Fase 2) Electron
test/     router privacy queue-direct auth memory
docs/     PLAN.md  GUIA-USUARIO.md
```

## Base de datos (todas con user_id y created_at)
users, devices, login_attempts, conversations, messages, notes (+FTS), tasks (raw_text exacto + sha256), task_attachments, approvals, provider_usage, provider_state, claude_usage, audit_log, reminders, connections, settings. Las notas "secretas" nunca se guardan.

## API
REST bajo `/api`: health, auth, devices, chat, stt, tasks, memory, approvals, status, audit, shortcut, telegram/webhook, agent/*.
WebSocket `/ws`: estados del orbe, chat, tareas, aprobaciones, proveedores, estado del PC.

## Fases
1. Hub + enrutador + memoria + cola + web con orbe (sin claves funciona con proveedor `fake`).
2. App de escritorio Electron (bandeja, atajo, arranque con Windows, runner de Claude, sincronía de memoria).
3. Nube: repo remoto, Render, Turso, PWA con aviso "despertando…".
4. Telegram, Atajos, avisos proactivos.
5. Resto de la cadena, investigación web, puestos de ChatGPT/Grok/Perplexity.
6. Voz mejor, Gmail/Calendar/Drive, juegos, Spotify, WhatsApp oficial al final.

## Criterios de "terminado" de la Fase 1
- `npm test` pasa sin claves ni red.
- Enrutador: salta de proveedor al agotar cuota; un 429 pausa al proveedor; sin cuota devuelve `sin_cuota`.
- Privacidad: un mensaje privado solo llama a Groq o Claude, también si Groq falla.
- Cola directa: emojis, CRLF, espacios finales, comillas y 10 000 caracteres salen con el mismo sha256.
- Auth: bloqueo tras 5 fallos (15 min); token revocado se rechaza.
- Memoria: top-k dentro del presupuesto de tokens.
- Manual: `npm run dev` abre localhost, pide contraseña, saluda "Hola señor." y el orbe cambia de estado.

## No hacer
Push o deploy sin permiso, `--dangerously-skip-permissions`, claves en git o en el cliente, tokens en la URL, depender de Web Speech API, ping para mantener Render despierto, cifras de límites inventadas (van `null` hasta verificar).

## Ajuste Fase 1.5 (voz, OpenRouter, tema)
- OpenRouter pasa de esqueleto a proveedor real (solo `:free`, tope 50/día, no privado).
- Voz del servidor: `POST /api/tts` con cadena pregrabadas > Gemini TTS > MiniMax (apagado) > voz del navegador; lo privado nunca sale; saludo en caché de disco.
- HUD: paneles en gris grafito con texto claro; orbe y barras siguen azules.
- Cola directa: "tal cual" ahora exige "tal cual:" (o "díselo a Claude:" / "directo a Claude:" / "/claude") al inicio.

## Fase 2 (hecha; ver lo pendiente de verificar abajo)
- `desktop/`: Electron (ventana que carga la web del hub, bandeja, atajo Ctrl+Alt+J, arranque con Windows, saludo, instancia única) y `desktop/runner/` (cliente del hub, cola, `claude -p --output-format stream-json --verbose` con el pedido por stdin).
- Hub: `/api/agent/*` (hello, heartbeat, claim, events, approval, finish, bye) con token de dispositivo `pc`, que no sirve en el resto de la API (no puede aprobarse solo). Evento `pc_online`, estado del PC en el panel, uso en `claude_usage`, topes de `config/permissions.json`.
- Permisos: el runner no usa `--dangerously-skip-permissions`; lo denegado vuelve en `permission_denials`, se pide aprobación y se continúa con `--resume` y una regla exacta en `--allowedTools`.
- Pendiente de verificar a mano: `claude` real, ventana/voz/atajo en uso real, arranque con Windows, `npm run dist`.

## Fases 4, 5 y 6 (lado servidor, hechas sin credenciales reales)
- Fase 4: `/api/telegram/webhook` (secreto en cabecera, lista de chat_id, texto y voz, tarjetas de aprobación con botones), `/api/shortcut` completo, `/api/cron/tick` (recordatorios, PC encendido/apagado, resumen de cuota). Script `npm run telegram:setwebhook`.
- Fase 5: Mistral, Cloudflare Workers AI y Ollama reales (apagados sin credencial; Ollama solo si responde). Puestos ChatGPT, Grok y Perplexity reales y apagados sin clave; el sustituto entra por `orden_por_tipo`. Búsqueda web con citas (`/api/search`, y automática para preguntas de investigación no privadas): Perplexity > Gemini con Google Search > DuckDuckGo.
- Fase 6: Google (OAuth propio, tokens cifrados AES-256-GCM en `connections`), Spotify (PKCE), juego de fútbol (GET de solo lectura), WhatsApp Cloud API (envío siempre con aprobación). Registro de herramientas `/api/tools`. Leer = automático; enviar/escribir = aprobación en el teléfono.
- Pendiente (necesita credenciales o la app de escritorio): probar cada API de verdad, crear los clientes OAuth, registrar los webhooks, interfaz web para los botones "Conectar" y para las herramientas.

## Modo Pro (Clásico/Pro)
- Contrato y detalles en `docs/PRO.md`. Servidor: `server/pro/*`, `/api/pro`, `/api/agent/pro`. PC: `desktop/runner/pro-worker.js` (+ `agy-*`, `git-snapshot`, `outbox`, `doctor`). Web: pestaña Pro.
- Ronda: plan -> usted aprueba -> programar -> verifica el otro motor (informe vs. diff real de git) -> hasta 2 correcciones -> aceptar = commit local. Gemini = Antigravity CLI (`agy`, cuenta AI Pro).
- Etapa 3 (integración): servidor y runner, hechos en paralelo, se ajustaron al contrato (rol `commit` en el runner; plan como texto). Prueba extremo a extremo `test/pro-e2e.test.js` (servidor real + worker real + claude/agy falsos).
- Pendiente de verificar a mano: `claude` y `agy` reales (flags, id del modelo, login), Render real, la web Pro con una ronda real.

## Motores del PC (Flash / Gemini / Claude)

- Selector Auto/Flash/Gemini/Claude en el chat (`localStorage jarvis_motor`). "Privado" desactiva Gemini.
- Flash: cadena de nube (Gemini `gemini-3.8-flash`), siempre disponible. Con el PC apagado responde preguntas con la nota "(Flash: PC apagado)".
- Gemini PC: tareas con `engine='gemini'` ejecutadas por `agy -p` (Antigravity CLI) con `gemini-3.8-flash-high` (`config/providers.json > motores_pc`). Planificación con `gemini-4-hydrogen` por API.
- Disparadores: `/gemini`, `díselo a Gemini:`, `directo a Gemini:` (texto exacto, sin modelo).
- Lo privado nunca va a Gemini: se comprueba antes de encolar (`privado_no_gemini`).
- Solo trabaja en `carpetas_gemini` (por defecto Documentos\Jarvis\gemini). Topes propios en `ai_usage`.
- Límite conocido: `agy --sandbox` no confina en Windows; el runner vigila comandos y rutas (`guardTool`), best-effort. El pedido va por argumento (máx. 28000 caracteres).
- "Pasar a Claude" reasigna una tarea fallida/rechazada/pendiente a Claude.
