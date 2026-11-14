<!-- estado-proyecto -->
# Estado de Jarvis (13-nov-2026)
**Pedido:** Jarvis personal gratis (orbe azul, voz Algenib), en Render+Turso, con control del PC/iPhone y Modo Pro (Claude y Gemini/`agy` programando con verificación cruzada).

**Hecho:** nube Render+Turso, cadena gratis de IAs, web y `/m`, cola del teléfono. Clásico y Pro en `main` y desplegados hasta c5a6d43. Local (sin push, 871817e): runner adaptado a `agy` real (`--mode plan`, modelos `gemini-3.8-flash-*`, login por `agy models`). PC: Claude Code y `agy` instalados con login, app de escritorio enrolada contra Render, `carpetas_permitidas` = jarvis; doctor lo detecta todo.

**Queda:** push/deploy de 871817e (pendiente de permiso); probar `agy --mode accept-edits` real, 429/503 reales, bloqueo de comandos con `agy` real, una ronda Pro completa; confirmar que el plan de `agy` llega completo en el mensaje; Gemini Pro/Argon no existe en la cuenta. Aparte: limpiar worktrees `jarvis-p1..p4`, regenerar claves vistas en el chat, Telegram, Google, Spotify, WhatsApp.

**Coordinador Groq (rama pro-groq-coordinador, sin push):** Groq coordina en Pro (habla, consulta a Claude/Gemini solo lectura, propone; el usuario aprueba con botón); fallback al flujo clásico. Probado con Groq simulado; sin probar con Groq real. Ver docs/PRO.md.

**Rama pro-estabilidad (sin push):** Pro con solo Claude (ids 5.5, sonda real en el doctor, reserva de Opus avisada en el hilo, cancelar real, Reintentar paso, commit solo de la ronda, envío atómico, web con motivos/avisos). Ver docs/PRO.md al final. Sin probar: ronda real completa.

**Siguiente paso:** con permiso, push y deploy; luego una ronda Pro real en un repo de prueba.

**Verificar:** `npm test` (202); `node --test test/pro-e2e.test.js`; guía docs/GUIA-USUARIO.md sección 15. Sin probar: ronda real, iPhone.
