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
- Manual: `npm run dev` abre localhost, pide contraseña, saluda "Hola, señor." y el orbe cambia de estado.

## No hacer
Push o deploy sin permiso, `--dangerously-skip-permissions`, claves en git o en el cliente, tokens en la URL, depender de Web Speech API, ping para mantener Render despierto, cifras de límites inventadas (van `null` hasta verificar).

## Ajuste Fase 1.5 (voz, OpenRouter, tema)
- OpenRouter pasa de esqueleto a proveedor real (solo `:free`, tope 50/día, no privado).
- Voz del servidor: `POST /api/tts` con cadena pregrabadas > Gemini TTS > MiniMax (apagado) > voz del navegador; lo privado nunca sale; saludo en caché de disco.
- HUD: paneles en gris grafito con texto claro; orbe y barras siguen azules.
- Cola directa: "tal cual" ahora exige "tal cual:" (o "díselo a Claude:" / "directo a Claude:" / "/claude") al inicio.
