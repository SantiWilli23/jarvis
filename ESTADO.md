<!-- estado-proyecto -->
# Estado de Jarvis (14-nov-2026)

**Pedido:** Jarvis personal gratis (orbe azul, voz Algenib), en Render+Turso, con control del PC/iPhone, Modo Pro y Estudio/Navegador.

**Hecho:** nube Render+Turso, cadena gratis de IAs, web y `/m`, cola del teléfono, Pro con ids Claude 5.5 y sonda en el doctor, Estudio (`/estudio`, Gemini por API, privado bloqueado) y Navegador de Jarvis. Rama `quitar-agy` (sin push, con main mezclado): la cola de tareas ya no usa Gemini del PC (motor, topes, planificador, puesto `gemini_pc`, "Pasar a Claude"); `/gemini ...` contesta por la API con el proveedor gemini primero (privado: Groq) y no encola. Caché web v9.

**GitHub (rama github-lectura):** conector solo lectura `server/connectors/github.js` + `/api/github/*` (status, repos, branches); llaves fine-grained `GITHUB_TOKEN(S)` en .env y Render; guía en docs. Sin token real no probado; el Pro web aún no.

**Queda:** el Modo Pro conserva el interruptor `motores_pc.gemini.activo` (apagado) y los archivos del CLI de Gemini del runner; quitarlos es decisión aparte. Push/deploy con permiso; una ronda Pro real; claves vistas en el chat, Telegram, Google, Spotify, WhatsApp.

**Siguiente paso:** revisar y mergear `quitar-agy`; luego push y deploy con permiso.

**Verificar:** `npm test`; `node --test test/gemini-prefijo.test.js`; abrir `/`, `/m` y `/estudio` sin errores de consola.
