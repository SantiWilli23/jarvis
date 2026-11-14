<!-- estado-proyecto -->
# Estado de Jarvis (13-nov-2026)

**Pedido:** Jarvis personal gratis (orbe azul, voz Algenib), en Render+Turso, con control del PC/iPhone y Modo Pro (Claude y Gemini programando con verificación cruzada).

**Hecho:** nube Render+Turso, cadena gratis de IAs, web y `/m`, cola del teléfono. Clásico y Pro en `main`. Rama `quitar-agy` (sin push): se quitó el Gemini del PC de la cola de tareas (motor, topes, planificador, selector, puesto `gemini_pc`, "Pasar a Claude"); `/gemini ...` ahora contesta por la API con el proveedor gemini primero (privado: Groq) y no encola. Caché web v9.

**Queda:** el motor Gemini del Modo Pro sigue usando los archivos de Antigravity CLI del runner y `motores_pc.gemini.activo` (interruptor de Pro, apagado); quitarlo es decisión aparte. Push/deploy pendientes de permiso; una ronda Pro real; claves vistas en el chat, Telegram, Google, Spotify, WhatsApp.

**Coordinador Groq (rama pro-groq-coordinador, sin push):** Groq coordina en Pro; el usuario aprueba con botón. Ver docs/PRO.md.

**Siguiente paso:** revisar y mergear `quitar-agy`; luego push y deploy con permiso.

**Verificar:** `npm test`; `node --test test/gemini-prefijo.test.js`; abrir `/` y `/m` sin errores de consola.
