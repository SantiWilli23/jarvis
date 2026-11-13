# Guía de usuario: poner a Jarvis a funcionar

Esta guía es para la Fase 1: Jarvis corre en su computador, en `http://localhost:3000`. No cuesta nada. Sin claves también funciona, pero con respuestas simuladas.

## 1. Lo que necesita
- Node 24 o más nuevo (`node -v` en una terminal debe decir `v24...`).
- Esta carpeta (`jarvis`) y, dentro de ella, haber corrido `npm install` una vez.

## 2. Sacar la clave gratis de Groq
Groq pone la voz a texto (Whisper) y responde rápido. Es el único que recibe lo privado, además de Claude.
1. Entre a https://console.groq.com e inicie sesión (con Google sirve).
2. En el menú, abra **API Keys** y pulse **Create API Key**.
3. Póngale un nombre (por ejemplo "jarvis") y copie la clave que empieza con `gsk_`. Solo se muestra una vez.
4. Los límites gratuitos aparecen en la sección **Limits** de la misma consola. Verifíquelos ahí: Jarvis no los inventa.

## 3. Sacar la clave gratis de Gemini
Gemini ayuda con fotos y preguntas de razonamiento.
1. Entre a https://aistudio.google.com e inicie sesión con su cuenta de Google.
2. Pulse **Get API key** y luego **Create API key**.
3. Copie la clave (empieza con `AIza`).
4. Importante: Jarvis nunca le manda a Gemini nada marcado como privado.

## 4. Crear el archivo `.env`
1. En la carpeta `jarvis`, copie `.env.example` y llame a la copia `.env` (con el punto delante, sin nada más).
2. Ábralo con el Bloc de notas y rellene, sin comillas ni espacios:
   ```
   OWNER_PASSWORD=una-contraseña-larga-que-solo-usted-sepa
   GROQ_API_KEY=gsk_...
   GEMINI_API_KEY=AIza...
   ```
3. Guarde. El archivo `.env` nunca se sube a git ni se comparte.

## 5. Elegir la contraseña
La contraseña es `OWNER_PASSWORD`. Elija una larga (una frase de cuatro o cinco palabras sirve). Jarvis guarda solo su "hash" en la base de datos, nunca la contraseña. Para cambiarla: edite `.env` y reinicie; se actualiza sola. Tras 5 intentos fallidos seguidos, Jarvis se bloquea 15 minutos.

## 6. Encenderlo
En una terminal, dentro de la carpeta `jarvis`:
```
npm run dev
```
Abra http://localhost:3000, escriba la contraseña, toque el orbe: Jarvis dice "Hola señor." Después, un toque en el orbe para grabar y otro para enviar. También puede escribir en la casilla de abajo.

Si abre la página en el iPhone, use Safari. El micrófono pide permiso la primera vez.

## 7. Qué hace cada variable de `.env`
| Variable | Para qué sirve |
|---|---|
| `OWNER_PASSWORD` | Su contraseña. Obligatoria. |
| `OWNER_NAME` | Cómo se llama el usuario dueño en la base de datos (opcional). |
| `PORT` | Puerto local (por defecto 3000). |
| `DATABASE_URL` | Dirección de la base en la nube (Turso). Vacío = archivo local `data/jarvis.db`. |
| `DATABASE_AUTH_TOKEN` | Clave de la base en la nube. Solo si usa Turso. |
| `GROQ_API_KEY` | Groq: voz a texto, charla rápida y lo privado. |
| `GEMINI_API_KEY` | Gemini: fotos y razonamiento. |
| `MISTRAL_API_KEY`, `OPENROUTER_API_KEY`, `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`, `OLLAMA_URL`, `OPENAI_API_KEY`, `XAI_API_KEY`, `PERPLEXITY_API_KEY` | Proveedores de modelos; cada uno se enciende solo al poner su clave (sección 11). |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_ALLOWED_CHAT_IDS` | Telegram (sección 12). Las tres o queda apagado. |
| `CRON_SECRET`, `CRON_SUMMARY_HOUR_UTC`, `PUBLIC_URL` | Avisos proactivos y direcciones públicas (secciones 12 y 14). |
| `CONNECTIONS_KEY` | Clave que cifra los tokens de Google y Spotify en la base. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SPOTIFY_CLIENT_ID` | Conectores de Google y Spotify (sección 14). |
| `GAMES_API_URL`, `GAMES_API_TOKEN` | Juego de fútbol, solo lectura (sección 14). |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` | WhatsApp Cloud API (sección 14). |

## 8. Cosas que conviene saber
- **Directo a Claude:** si dice o escribe al INICIO "díselo a Claude: ...", "directo a Claude: ...", "tal cual: ..." (con los dos puntos) o "/claude ..." (decir "tal cual" dentro de una frase normal no activa nada), el texto se guarda palabra por palabra, sin que ningún modelo lo toque, y espera en la cola del panel derecho. La hora se guarda aparte.
- **Preparar:** si pide algo para el PC sin esas palabras, un modelo gratis lo ordena en pasos y preguntas; usted lo revisa en la cola y pulsa "Enviar al PC".
- **Privado:** marque la casilla "privado" o use una nota privada; ese mensaje solo va a Groq (o a Claude). Si Groq no puede, Jarvis dice que no hay cuota en vez de mandarlo a otro lado.
- **Notas "secretas"** nunca se guardan.
- **Sin claves:** Jarvis usa un proveedor de pruebas que repite lo que le dice. Sirve para ver que todo funciona.
- **Probar el sistema:** `npm test` corre las pruebas (no necesita red ni claves).
- El PC (Claude Code), Telegram y el widget de Atajos llegan en las fases 2, 3 y 4. Los botones de esas conexiones se ven apagados hasta entonces.

## 9. Voz de Jarvis (cadena de voz)
Cuando Jarvis habla, el servidor prueba en este orden y salta en silencio a la siguiente si falla:
1. **Frases pregrabadas** (sus propios audios).
2. **Gemini TTS** (voz grave y formal en español). Usa `GEMINI_API_KEY` y tiene un tope diario propio (`voz.gemini.tope_dia` en `config/providers.json`, 30 por defecto; ajústelo a lo que le permita su cuenta).
3. **MiniMax** (apagado por defecto: su cuenta no tiene saldo). Para activarlo ponga `MINIMAX_API_KEY` en `.env` y `"enabled": true` en `voz.minimax`. Tope de 5.000 caracteres al día; el consumo se ve en el panel "Voz".
4. **Voz del navegador** (tono bajo), si todo lo anterior falla o si el texto es privado.

Lo privado NUNCA se manda a Gemini ni a MiniMax. El saludo "Hola señor." se guarda en `data/cache/tts/` para no gastar cuota cada vez.

### Cómo agregar sus propios audios (mp3)
1. Grabe usted la frase (no use voces de actores ni audios de películas) y guárdela como mp3.
2. Cópiela en la carpeta `web/audio/phrases/` con el nombre que dice `web/audio/phrases/manifest.json`: `hola-senor.mp3`, `a-sus-ordenes.mp3`, `sistemas-en-linea.mp3`, `entendido.mp3`, `un-momento-senor.mp3`.
3. Para frases nuevas, añada una línea a `manifest.json`: `{ "id": "mi-frase", "texto": "Lo que dice.", "archivo": "mi-frase.mp3" }`.
4. No hace falta reiniciar. La frase coincide ignorando mayúsculas, espacios y puntuación. Si el mp3 no existe, simplemente se usa la voz de la cadena.

## 10. OpenRouter (relevo gratis)
Ponga `OPENROUTER_API_KEY` (https://openrouter.ai/keys) y se activa solo, después de Gemini, Groq y Mistral. Usa solo modelos `:free` (el id está en `config/providers.json`, `proveedores.openrouter.modelo`; si no termina en `:free` queda apagado). Tope propio de 50 pedidos al día. Nunca recibe mensajes privados.

## La app de Jarvis para Windows (Fase 2)

Es una ventana con el orbe, un icono en la bandeja y un "runner" que recoge la cola y se la pasa a Claude Code en su PC.

### 1. Instalar Claude Code e iniciar sesión con su plan Pro
1. Instale Node 24 o superior y abra PowerShell.
2. Instale Claude Code con el instalador oficial de Anthropic (o `npm install -g @anthropic-ai/claude-code`).
3. Escriba `claude` una vez, elija iniciar sesión con su cuenta (plan Pro) y termine el aviso del navegador. Jarvis nunca ve su contraseña: usa la sesión que ya dejó Claude Code.
4. Compruebe con `claude --version`. Si Jarvis no lo encuentra, ponga la ruta completa en `claudePath` del archivo de configuración.

### 2. Arrancar la app
1. En la carpeta del proyecto: `npm start` (servidor) y, en otra ventana, `cd desktop`, `npm install` y `npm start`.
2. Por defecto abre `http://localhost:3055`. Para otra dirección: variable `JARVIS_HUB_URL` o `hubUrl` en el archivo de configuración (menú de la bandeja > "Abrir archivo de configuración").
3. Inicie sesión en la ventana. La app pide por sí sola un token de dispositivo "PC" (se guarda cifrado en Windows) y el panel mostrará "PC en línea".
4. Atajo global: **Ctrl+Alt+J** abre Jarvis y activa el micrófono (cámbielo con `hotkey`). Cerrar la ventana la oculta; para salir use la bandeja > Salir. "Pausar cola" detiene el runner sin apagarlo.
5. Arranque con Windows: la versión empaquetada se registra sola al abrirse; al encender el PC la cola empieza de inmediato, el hub emite `pc_online` (Telegram lo avisará en la Fase 4) y Jarvis dice "Hola señor.".
6. Instalador: `cd desktop` y `npm run dist` (electron-builder genera un instalador en `desktop/dist`; sin probar en este equipo).

### 3. Qué puede hacer Claude solo y qué le pide permiso
- Solo: leer y escribir dentro de las carpetas de `config/permissions.json` (`carpetas_permitidas`; si está vacía solo lee).
- Siempre con su sí (tarjeta ámbar en la web): borrar, terminal libre, enviar mensajes, `git push`, desplegar. El permiso caduca a los 30 minutos.
- Topes de su plan Pro: `tope_claude` en `config/permissions.json` (`por_tarea_tokens`, `diario_tareas`, `diario_tokens`). Vacíos = sin tope hasta verificar sus límites reales.
- Modo Directo: el texto llega a Claude exactamente igual, byte a byte; la hora del dictado va aparte.

## 11. Más proveedores de modelos (qué clave sacar y dónde)
Todos quedan apagados mientras falte su clave. Ninguno recibe mensajes privados (solo Groq y Claude), salvo Ollama si corre en su mismo equipo (`localhost`). Los límites de uso no se inventan: míralos en cada consola y, si quiere un tope propio, ponga `rpd` en `config/providers.json`.

| Proveedor | Variable | Dónde sacarla | Costo |
|---|---|---|---|
| Mistral (mistral-small-latest, editable en config) | `MISTRAL_API_KEY` | https://console.mistral.ai > API Keys | Plan gratuito con límites (verifíquelos en la consola) |
| Cloudflare Workers AI | `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` | https://dash.cloudflare.com: el ID de cuenta está en la página de Workers AI; el token en My Profile > API Tokens con permiso "Workers AI" | Gratis con una cuota diaria (verifíquela en su panel) |
| Ollama | `OLLAMA_URL` (por ejemplo `http://localhost:11434`) | Instale Ollama (https://ollama.com), baje un modelo y déjelo corriendo. Solo se usa si responde | Gratis, local. En Render no sirve (no alcanza su PC) |
| ChatGPT (revisa fallas, fotos) | `OPENAI_API_KEY` | https://platform.openai.com/api-keys | De pago. Sin clave lo cubre Gemini |
| Grok (datos y videos) | `XAI_API_KEY` | https://console.x.ai | De pago. Sin clave lo cubre Groq |
| Perplexity (investigar) | `PERPLEXITY_API_KEY` | https://www.perplexity.ai/settings/api | De pago. Sin clave busca Gemini |

Los modelos exactos están en `config/providers.json` (campo `modelo`); verifique allí o en la consola que sigan vigentes. Perplexity usa su API "Agent" porque la documentación oficial anuncia el retiro de la API Sonar de chat.

### Búsqueda web
Preguntas como "últimas noticias de..." o "quién ganó..." (que no sean privadas) buscan en la web y responden con fuentes. Elige: Perplexity si hay clave; si no, Gemini con Google Search (usa su `GEMINI_API_KEY` y su cuota); si no, las respuestas instantáneas de DuckDuckGo (sin clave, resultados limitados). También se puede pedir directo: `POST /api/search` con `{"query":"..."}`. Si el texto es privado no se busca nada.

## 12. Telegram y avisos
1. En Telegram, abra una charla con **@BotFather**, escriba `/newbot` y siga los pasos. Le da el token: póngalo en `TELEGRAM_BOT_TOKEN`.
2. Invente un secreto largo (solo letras, números, `_` y `-`) y póngalo en `TELEGRAM_WEBHOOK_SECRET`.
3. Averigüe su chat id: escríbale al bot y abra `https://api.telegram.org/bot<TOKEN>/getUpdates` en el navegador; busque `"chat":{"id":...}`. Póngalo en `TELEGRAM_ALLOWED_CHAT_IDS` (varios separados por coma). Cualquier otro chat es ignorado.
4. Con Jarvis en internet (Render, URL https), corra una vez: `npm run telegram:setwebhook -- https://su-app.onrender.com`.
5. Listo: escriba o mande notas de voz al bot. Comandos: `/estado`, `/aprobaciones`, `/buscar ...`, `/recordar 30 sacar la basura`, `/correos`, `/agenda`, `/archivos`, `/suena`, `/pausa`, `/siguiente`. Las aprobaciones llegan como tarjetas con botones Aprobar y Rechazar.
Ojo: lo que usted escriba y lo que Jarvis conteste pasa por los servidores de Telegram; para temas muy privados use la web.

### Avisos proactivos (gratis)
Jarvis puede avisarle por Telegram de recordatorios, de si su PC se enciende o apaga y de un resumen diario de cuota. Para eso alguien debe "tocar" `/api/cron/tick` cada pocos minutos. Ponga un secreto largo en `CRON_SECRET` y use un cron externo gratis, por ejemplo https://cron-job.org: cree un trabajo cada 5 minutos con la URL `https://su-app.onrender.com/api/cron/tick`, método POST y una cabecera `Authorization: Bearer <su CRON_SECRET>` (el secreto va en la cabecera, nunca en la URL). Los GitHub Actions programados también sirven. Sin `CRON_SECRET` el cron está apagado. Nota: ese toque también despierta a Render; no es un "ping para mantenerlo despierto" a propósito, pero tenga en cuenta ese efecto.

## 13. Atajos de iPhone y widget
1. En la web de Jarvis (o con la API), cree un dispositivo tipo atajo: `POST /api/devices` con `{"name":"iPhone","kind":"shortcut"}`. Le devuelve un token **una sola vez**; cópielo. Ese token solo sirve para `/api/shortcut`.
2. En la app **Atajos** del iPhone cree un atajo nuevo con estas acciones: **Dictar texto** > **Obtener contenido de URL** (URL `https://su-app.onrender.com/api/shortcut`, método POST, cabecera `Authorization` = `Bearer <token>`, cuerpo JSON con el campo `text` = texto dictado) > **Obtener valor del diccionario** (clave `reply`) > **Pronunciar texto**.
   Para recibir solo texto, añada `?format=text` a la URL y salte el paso del diccionario.
3. Para el widget: en el atajo, pulse el nombre > **Añadir a pantalla de inicio**, o añada el widget "Atajos" y elija este atajo. También puede llamarse "Oye Siri, Jarvis".
4. Las respuestas salen cortas (unos 400 caracteres) para que suenen bien. Si dicta algo privado, añada `"private": true` al JSON.

## 14. Conectores (Fase 6)
Todo conector queda apagado sin sus credenciales. **Leer es automático; enviar o escribir siempre pide su aprobación en el teléfono** (tarjeta en la web o botones de Telegram). Lo que Jarvis lee de sus cuentas se marca como privado y no se manda a ningún modelo desde estos conectores. Las herramientas se ven en `GET /api/tools` y se usan con `POST /api/tools/<nombre>`.

Antes de nada, ponga `CONNECTIONS_KEY` en `.env` (cifra los tokens en la base). Genere una con: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Y ponga `PUBLIC_URL` con la dirección https de su Jarvis (en local, `http://localhost:3000`).

### Google (Gmail, Calendar, Drive), gratis
1. Entre a https://console.cloud.google.com, cree un proyecto.
2. **APIs y servicios > Biblioteca**: active Gmail API, Google Calendar API y Google Drive API.
3. **Pantalla de consentimiento OAuth**: tipo Externo, ponga su correo como usuario de prueba (así no necesita verificación de Google).
4. **Credenciales > Crear credenciales > ID de cliente OAuth**, tipo Aplicación web. En "URI de redireccionamiento autorizados" ponga `<PUBLIC_URL>/api/connect/google/callback`.
5. Copie el ID y el secreto en `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`.
6. Con sesión iniciada, pida `POST /api/connect/google/start`; devuelve una `url`: ábrala en el navegador y acepte. Modo de prueba: Google caduca el permiso a los 7 días; hay que repetir el paso 6.
Herramientas: `google.correos`, `google.eventos`, `google.archivos` (automáticas); `google.enviar_correo` y `google.crear_evento` (con aprobación). Alcances: leer y enviar correo, eventos, y solo metadatos de Drive.

### Spotify (gratis para leer; controlar exige Premium)
1. https://developer.spotify.com/dashboard > Create app. En Redirect URI ponga `<PUBLIC_URL>/api/connect/spotify/callback` (Spotify exige https salvo `127.0.0.1`).
2. Copie el Client ID en `SPOTIFY_CLIENT_ID` (no hace falta el secreto: usa PKCE).
3. `POST /api/connect/spotify/start` y abra la `url`.
Herramientas: `spotify.escuchando`, `spotify.recientes`, `spotify.control` (play, pausa, siguiente, anterior). El control es automático salvo que en `config/permissions.json` quite `spotify_control` de `automatico` y lo ponga en `requiere_aprobacion`.

### Juego de fútbol (solo lectura)
Ponga en `GAMES_API_URL` la dirección del servidor del juego. Sin más, Jarvis consulta estado y funciones activas (`/api/health`, `/api/public/features`, herramienta `games.estado`). El juego protege el resto (ranking, progreso) con un token de sesión de 30 días: si quiere `games.ranking` y `games.progreso`, inicie sesión en el juego (`POST /api/auth/login`) y pegue el token en `GAMES_API_TOKEN`; deberá renovarlo cada 30 días. El juego no ofrece hoy un endpoint "mis puntos" ni una clave de servicio; si quiere algo más estable habría que añadirle allí un token de solo lectura (Jarvis no modifica ese proyecto).

### WhatsApp (API oficial de Meta, con un número aparte)
1. https://developers.facebook.com > Crear app (tipo Empresa) > añada el producto **WhatsApp**. Use un número que no sea su WhatsApp personal.
2. En WhatsApp > Configuración de la API: copie el **Token** (`WHATSAPP_TOKEN`; el temporal dura 24 h, cree un usuario del sistema para uno permanente) y el **Identificador del número de teléfono** (`WHATSAPP_PHONE_ID`).
3. Invente un texto largo para `WHATSAPP_VERIFY_TOKEN`. En Configuración > Webhooks use la URL `<PUBLIC_URL>/api/whatsapp/webhook` y ese mismo texto; suscríbase a `messages`. Recomendado: ponga el "App secret" (Configuración de la app > Básica) en `WHATSAPP_APP_SECRET` para validar la firma.
4. Mensajes recibidos: se guardan como privados y se le avisa por Telegram. Enviar: `whatsapp.enviar` con `{"to":"57300...","text":"..."}`, siempre con aprobación. Meta limita los mensajes a quien no le ha escrito en 24 h (solo plantillas); en el modo de prueba solo se puede escribir a números verificados en su panel.

## 15. Modo Pro (Claude y Gemini programando en su PC)

Jarvis tiene dos modos. **Clásico**: la cola de siempre (usted pide, Claude Code lo hace en el PC). **Pro**: un chat de tres (usted, Claude y Gemini). Uno planea, usted aprueba el plan, uno programa, **el otro verifica** comparando lo que dijo haber hecho contra lo que realmente cambió en el repo, y al aceptar Jarvis hace un commit local (nunca sube nada). Máximo 2 correcciones automáticas por decisión suya.

### Qué debe instalar
1. **Claude Code** (ya hecho en la sección anterior; Pro usa los modelos `opus` y `sonnet`).
2. **Antigravity CLI (`agy`)** y entrar con la cuenta Google que tiene **AI Pro**. Es el "Gemini" de Pro (Gemini CLI ya no atiende esas cuentas). Compruebe con `agy --version`.
3. En su cuenta Google, **desactive el uso de datos para entrenamiento** (ajustes de actividad/privacidad de Gemini y Antigravity), porque el código de sus repos pasa por ahí.

### Dejarlo configurado
1. En el archivo de configuración de la app (bandeja > "Abrir archivo de configuración") ponga `"hubUrl": "https://jarvis-6pjr.onrender.com"`, reinicie la app, inicie sesión y deje que registre el PC (aparecerá "PC en línea").
2. En ese mismo archivo, `carpetas_permitidas`: lista de carpetas donde Pro puede trabajar, por ejemplo `["C:\Users\yo\proyectos"]`. Solo se usan repos git que estén dentro (la carpeta misma o sus subcarpetas directas). Fuera de ahí Pro rechaza el trabajo. Opcionales: `claudePath` y `geminiPath` si no los encuentra.
3. **Confirme los datos de `agy`** (se escribieron sin tenerlo instalado): ejecute `agy --help` y compruebe que existen `-p`, `--output-format` y `--model`; si no, corrija `desktop/runner/agy-args.js`. El id del modelo de planear/verificar es provisional (`argon` en `config/pro.json`): ponga el id real que muestre `agy`.

### Usarlo
Abra la pestaña **Pro** en Jarvis, elija repo (nuevo hilo) y escriba el pedido. Pro solo se activa con el PC encendido, Claude y `agy` listos y algún repo. Si falta algo, la pestaña le dice qué. Verá el plan; pulse Aprobar, Corregir o Rechazar. Tras programar y verificar, "Aceptar" hace el commit local. Si `agy` se queda sin cuota, Jarvis se detiene y se lo dice (no baja de modelo solo); si está saturado (503) al programar, baja de Flash a un Flash anterior. Nada privado (contraseñas, etc.) entra en Pro y los secretos se tapan.

### Límites conocidos
- `agy` no tiene un modo "solo lectura" garantizado: se le pide en el prompt y el diff real de git lo comprueba. Sus comandos peligrosos y `npm test` se vigilan y cortan el trabajo.
- Si cancela una ronda, el PC puede terminar el paso en curso (su resultado se descarta).
- Sin probar con las CLIs reales ni con Render: solo con simuladores.

## Gemini en el PC (agy): APAGADO por defecto

El agente Gemini del PC viene **apagado**. Mientras esté apagado: el servidor no encola nada para Gemini (responde que está apagado), el selector muestra "Gemini (apagado)", el puesto Gemini (PC) sale "apagado", el diagnóstico no ejecuta `agy` y Pro queda deshabilitado (motivo `gemini_apagado`). Claude y Flash siguen igual.

### Cómo encenderlo
1. Instale Antigravity CLI (`agy`) y ejecute `agy` una vez para iniciar sesión.
2. En `config/providers.json` ponga `"motores_pc": { "gemini": { "activo": true, ... } }` y reinicie el servidor. Solo el valor `true` lo enciende.
3. En `config/permissions.json`, `carpetas_gemini` = carpetas donde Gemini puede trabajar (si está vacío se usa DocumentosJarvisgemini; se crea sola). Gemini trabaja SIEMPRE con esa carpeta como directorio de trabajo; en Pro, el repo debe estar dentro de ellas.
4. Los términos de Google no admiten cuentas de consumo en aplicaciones de terceros: úselo bajo su responsabilidad. Desactive la recogida de datos en agy.
5. Elija "Gemini" en el selector o escriba `/gemini ...`. Con "privado" nunca se usa Gemini.

### Qué política aplica Jarvis (por rol)
- Planear y verificar (y todo trabajo de solo lectura): **sin comandos, sin escribir, sin navegador/red, sin MCP**; solo leer dentro de `carpetas_gemini`.
- Programar/corregir y tareas de la cola: puede escribir **solo dentro de `carpetas_gemini`; comandos solo de una lista corta (`git status|diff|log|show`, `ls`/`dir`, `node -v`, `npm -v`), un solo comando sin `;`, `&`, `|`, `>`, `<`, `$`; nunca navegador, red ni MCP; nunca `git push`, borrar, desplegar ni `npm test`.
- Nunca se usa `--dangerously-skip-permissions` ni modo automático. Se pasa `--sandbox`, pero **no se confía en él** (en Windows no confinó).
- Lo privado no entra: ni la cola ni el planificador de Gemini lo reciben.

### Límite exacto de seguridad (léalo)
**Lo que SÍ garantiza Jarvis:** apagado por defecto; con Gemini apagado no se ejecuta `agy` ni se encola nada; con él activo, `agy` nunca arranca si su carpeta de trabajo no está dentro de `carpetas_gemini`; nunca recibe privado; el pedido y los modelos permitidos son una lista cerrada; cada evento de herramienta que agy emite (comando, ruta, navegador, MCP) se revisa y, si no cumple la política, **se mata el proceso** y la tarea queda fallida/rechazada; cualquier rechazo de permiso cuenta como fallo.

**Lo que NO garantiza:**
1. El guardián **reacciona a los eventos**: se entera cuando agy anuncia la herramienta y mata el proceso, pero no puede impedir por sí mismo que esa primera acción llegue a ejecutarse (hay una carrera de milisegundos). No es un confinamiento del sistema operativo.
2. Un comando de la lista corta (por ejemplo `git log`) se permite tal cual; lo que haga por dentro no se vigila. Enlaces simbólicos/uniones dentro de `carpetas_gemini` que apunten fuera no se resuelven.
3. Si agy no emite evento de una herramienta (herramientas nuevas, otros nombres, eventos que no conozco), no hay nada que vigilar. Los nombres de herramienta se reconocen por patrón (`write`, `edit`, `command`, `browser`, `url`, `mcp`...) y un nombre desconocido sin rutas ni comando pasa.
4. No se controla lo que agy lee del sistema por su cuenta ni lo que envía a Google: todo lo que lea en `carpetas_gemini` va al servicio de Google. No ponga ahí secretos.
5. **No se pudo fijar un HOME/config propio por ejecución**: la documentación de agy no ofrece variable ni flag para eso, y su `settings.json` es global (`~/.gemini/antigravity-cli/settings.json`). Jarvis **no toca esa configuración**. Para una segunda barrera real puede copiar `config/agy-settings.recomendado.json` (reglas `permissions.deny/ask/allow`, `enableTerminalSandbox`) a ese archivo a mano; está sin verificar con agy real y hay un reporte público de que las reglas `allow` a veces se ignoran en Windows.
6. Los archivos `.geminiignore` pueden ser ignorados por agy.

**Recomendación:** si necesita aislamiento fuerte, ejecute el PC de Gemini en una cuenta de Windows o máquina virtual sin acceso a nada privado.
