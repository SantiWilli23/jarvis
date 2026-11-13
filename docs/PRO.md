# Modo Pro de Jarvis: contrato

Chat de tres (usuario, Claude, Gemini). Jarvis orquesta: enruta por tipo de tarea, el informe del primero pasa al segundo y este compara lo dicho contra lo realmente cambiado en el repo (diff de git). Este documento es el contrato compartido por: UI Clásico, orquestador servidor (`server/pro/*`, `server/routes/pro.js`, `server/routes/agent-pro.js`), runner del PC (`desktop/runner/*`) y web Pro. Configuración: `config/pro.json`.

## 1. Reglas

1. Máximo 2 correcciones por decisión del usuario (`limites.correcciones_max`). Al agotarlas la ronda pasa a `necesita_usuario`.
2. Nada privado entra en Pro: los mensajes marcados privados por `server/router/privacy.js` se rechazan (`422 privado`) y nunca viajan a Claude ni a Gemini CLI.
3. Redacción de secretos: antes de guardar o emitir prompts, informes, diffs y logs se enmascaran claves (`sk-`, `AIza`, `ghp_`, `Bearer ...`, líneas de `.env`, tokens largos). Los archivos `.env*`, `*.pem`, `*.key` nunca se incluyen en prompts ni en el diff guardado (solo aparecen por nombre en `archivos_tocados`).
4. Pro está habilitado solo si: PC en línea + Claude ok (modelos `opus` y `sonnet`) + Gemini CLI con login Google + al menos un repo git. `status.pro = { habilitado, motivos[] }`; motivos: `pc_apagado`, `claude_no_listo`, `gemini_sin_login`, `sin_repos_git`.
5. El repo se elige por hilo (`pro_threads.repo`) y debe estar dentro de `permissions.carpetas_permitidas` y ser repo git. Fuera de esas carpetas el job se rechaza (`repo_invalido`).
6. Acciones de `permissions.requiere_aprobacion` (git_push, borrar, terminal_libre, desplegar) siguen pidiendo aprobación; `approvals.pro_job_id` enlaza la aprobación con el job.

## 2. Modelos

| Rol | Claude (CLI) | Gemini CLI |
|---|---|---|
| Planear | `opus`, solo lectura | `gemini-3.1-pro-preview` |
| Programar | `sonnet`, `acceptEdits` | `gemini-3.8-flash`; solo ante 503: `3.7-flash`, luego `3.6-flash` |
| Verificar | `opus` | `gemini-3.1-pro-preview` |

- Si Gemini no tiene cuota al planear o verificar NO se baja de modelo en silencio: el job falla con `error: "sin_cuota"` y se avisa al usuario.
- Bajar de Flash solo por HTTP 503; un 429 no baja.
- Nunca: Flash-Lite, `gemini-2.5-pro`, `gemini-4-*`.

## 3. Tablas (server/db/schema.sql)

- `pro_threads(id, user_id, title, repo, status['abierto'|'cerrado'], created_at, updated_at)`
- `pro_messages(id, thread_id, user_id, round_id, author['usuario'|'jarvis'|'claude'|'gemini'], kind['texto'|'plan'|'informe'|'verificacion'|'sistema'], text, meta JSON, created_at)`
- `pro_rounds(id, thread_id, user_id, message_id, task_kind, programmer['claude'|'gemini'], verifier, corrections 0..2, status, summary, created_at, updated_at)`; status: `planeando|esperando_aprobacion|programando|verificando|corrigiendo|hecha|necesita_usuario|fallida|cancelada`
- `pro_jobs(id, round_id, thread_id, user_id, role['planear'|'programar'|'verificar'], engine['claude'|'gemini'], model, repo, prompt, mode['solo_lectura'|'editar'], status['pendiente'|'reclamado'|'en_curso'|'hecho'|'fallido'|'cancelado'], tree_before, tree_after, diff, error, created_at, started_at, finished_at)`
- `pro_reports(id, job_id, round_id, kind['informe'|'verificacion'], body JSON, created_at)`
- `ai_usage(id, user_id, day 'YYYY-MM-DD', engine, model, role, job_id, tokens_in, tokens_out, created_at)`
- `approvals.pro_job_id INTEGER` (migración idempotente en `server/db/index.js#migrate`).

## 4. Endpoints web (`/api/pro`, sesión web)

| Método y ruta | Descripción |
|---|---|
| `GET /api/pro/status` | `{habilitado, motivos[]}` |
| `GET /api/pro/threads` y `POST /api/pro/threads {title?, repo}` | listar y crear hilo |
| `GET /api/pro/threads/:id` | hilo, mensajes y rondas |
| `POST /api/pro/threads/:id/messages {text}` | mensaje del usuario; abre ronda; 409 si Pro no está habilitado |
| `POST /api/pro/rounds/:id/decision {accion:'aprobar'\|'rechazar'\|'corregir', text?}` | decisión del usuario; reinicia el contador de correcciones |
| `POST /api/pro/rounds/:id/cancel` | cancela los jobs vivos |
| `GET /api/pro/jobs/:id` | job, informe y diff (redactado) |

Solo `GET /api/pro/status` existe en la base; el resto lo implementa P2.

## 5. Endpoints del PC (`/api/agent/pro`, token `pc`)

| Método y ruta | Descripción |
|---|---|
| `GET /api/agent/pro/status` | igual que web |
| `POST /api/agent/pro/claim` | entrega el siguiente job `pendiente` y lo pasa a `reclamado` (`{job:null}` si no hay) |
| `POST /api/agent/pro/jobs/:id/events {events:[{kind,text}]}` | progreso; el servidor emite `pro.delta` |
| `POST /api/agent/pro/jobs/:id/report {informe, tree_before, tree_after, diff, usage:{tokens_in,tokens_out}}` | cierra el job; guarda `pro_reports` y `ai_usage` |
| `POST /api/agent/pro/jobs/:id/fail {error}` | falla (`sin_cuota`, `timeout`, `repo_invalido`, ...) |

`hello` y `heartbeat` de `/api/agent` aceptan `capabilities` (sección 8) y devuelven `uso` (`usageToday`: `{tareas, tokens, ai:{<engine>:{tokens,llamadas}}}`).

## 6. Job e informe

Job entregado al PC:

```json
{ "id": 12, "round_id": 5, "role": "programar", "engine": "claude", "model": "sonnet",
  "repo": "C:\\Users\\x\\proyecto", "mode": "editar", "prompt": "...", "timeout_s": 1800 }
```

Informe del job (`pro_reports.body`, kind `informe`):

```json
{ "dijo_hizo": ["Añadí la ruta /x", "Corregí el test y"],
  "archivos_tocados": ["server/a.js", "test/a.test.js"],
  "comandos": ["npm test"],
  "resultado": "ok | parcial | fallo: texto breve" }
```

Verificación (kind `verificacion`; la hace el otro motor comparando el informe con el diff real):

```json
{ "dijo_no_hizo": ["Dijo añadir test y, no está en el diff"],
  "hizo_no_dijo": ["server/b.js modificado sin mencionarlo"],
  "cambios_ajenos": ["config/x.json (no relacionado con el pedido)"],
  "veredicto": "aprobado | corregir | necesita_usuario" }
```

Si el veredicto es `corregir` y `corrections < 2`, el orquestador abre un job `programar` de corrección con la verificación como prompt; si no, la ronda pasa a `necesita_usuario`. Quien programa nunca verifica su propio trabajo: verifica el otro motor.

## 7. Diff real (lo calcula el runner, sin tocar el índice)

Antes y después de programar, en el repo, con un índice temporal propio:

```
GIT_INDEX_FILE=<tmp> git read-tree HEAD    (índice vacío si no hay commits)
GIT_INDEX_FILE=<tmp> git add -A
GIT_INDEX_FILE=<tmp> git write-tree        -> tree_before / tree_after
git diff --name-status --stat -M <tree_before> <tree_after>
```

El índice real y el árbol de trabajo no se modifican; el archivo temporal se borra. Respeta `.gitignore`. `diff` se recorta a `limites.diff_max_caracteres`.

## 8. Eventos WebSocket

Hacia la web (el bus lleva `userId`; el mensaje WS no):

- `pro.status` `{habilitado, motivos[]}`
- `pro.message` `{thread_id, message:{id, author, kind, text, meta, created_at}}`
- `pro.delta` `{thread_id, round_id, job_id, author, text}` (texto en vivo)
- `pro.round` `{thread_id, round:{id, status, corrections, programmer, verifier, summary}}`
- `conn.using` `{id}`: conexión usada ahora (`groq`, `gemini`, `openrouter`, `claude_pc`, ...).

`/api/status.connections[]` = `{id, nombre, ok, usa}`; `usa` es true durante 6 s tras el último uso. El router lo emite solo vía `onUse(id, {userId})`; el orquestador avisa uso de Claude o Gemini CLI con `bus.emit("pc.using", {userId, id: "claude_pc"})`.

Capacidades que el PC manda en `hello` y `heartbeat`:

```json
{ "capabilities": { "claude": {"ok": true, "modelos": ["opus","sonnet"]},
                    "agy": {"ok": true, "login": "google"},
                    "repos": ["C:\\Users\\x\\proyecto"] } }
```

## Ampliaciones P2

Cambio de motor: el motor logico `gemini` es ahora **Antigravity CLI (`agy`)** con login de la cuenta Google AI Pro (Gemini CLI ya no atiende esas cuentas). Las capacidades pasan a `agy: {ok, login}` (se acepta `gemini_cli` por compatibilidad; el servidor lo guarda como `agy`). `config/pro.json`: `modelos.gemini.planear/verificar` son configurables (por defecto `argon`, id exacto por confirmar); ya no se prohibe `gemini-4-*`. El motivo de `status.pro` sigue llamandose `gemini_sin_login`.

Roles e informes:
- Job con `role: "commit"` (mode `editar`): el `prompt` es el mensaje de commit; el runner hace `git add -A && git commit` local (nunca push) y envia `report` con `informe.resultado: "ok"`. Se emite al aceptar (`aprobar` sobre una ronda ya programada).
- `report` de `planear`: `informe` es texto (string) o `{plan|texto}`. De `verificar`: `informe` es el JSON de verificacion (o string que lo contenga). De `programar`: JSON del punto 6 (string aceptado).
- `claim` acepta `{again: <job_id>}` para recuperar un job `reclamado`/`en_curso` cuya respuesta se perdio; los `reclamado` sin eventos tras `timeouts.job_reclamado_s` vuelven a `pendiente`. El job puede traer `fallback_models` y `fallback_solo_por` (solo ante 503) para Gemini/agy al programar.
- `events` y `report` responden `{ok:true, cancelado:true}` / `{ignorado:true}` si la ronda se cancelo (el runner debe abortar). Reenviar `report`/`fail` de un job cerrado devuelve `{ok:true, duplicado:true}` (idempotente); `report` sobre un job `fallido` da 409 `job_cerrado`.
- Aprobacion de `npm test` y otras acciones: `POST /api/agent/pro/jobs/:id/approval {kind, summary, detail}` crea la aprobacion (con `pro_job_id`); `GET /api/agent/pro/approvals/:id` consulta su estado. La web la resuelve con `/api/approvals`.
- Estados de ronda: tras verificar `aprobado` la ronda queda en `esperando_aprobacion` (fase "aceptar"); `aprobar` ahi lanza el commit. `necesita_usuario` admite `aprobar` (aceptar igualmente), `corregir` (reinicia contador) o `rechazar`. `decision` acepta `motor: "claude"|"gemini"` al replanificar.
- Errores: 409 `ronda_activa`, 409 `estado_invalido`, 422 `repo_invalido`, 422 `privado`, 400 `texto_invalido`, 409 `pro_deshabilitado` con `motivos`.
- `fail {error}`: `sin_cuota` deja la ronda en `necesita_usuario` (sin bajar de modelo); `timeout` u otros la dejan `fallida`; un `commit` fallido deja la ronda en `esperando_aprobacion` para reintentar.
- Eventos: `pc.using` con `id` `claude_pc` o `gemini`; `pro.status` cuando cambia la habilitacion.
