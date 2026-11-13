<!-- estado-proyecto -->
# Estado de Jarvis (13-nov-2026)

**Pedido:** Jarvis personal gratis (orbe azul, voz Algenib), en Render+Turso, con control del PC/iPhone y Modo Pro (Claude y Gemini/`agy` programando con verificación cruzada).

**Hecho:** nube Render+Turso, cadena gratis de IAs, web y `/m`, cola del teléfono, correo despertador y Web Push. Rama `pro-integracion`: P1-P4 fusionadas, Etapa 3 hecha (rol `commit` y plan en texto arreglados en el runner; `test/pro-e2e.test.js` con servidor real + worker real + fakes; docs PRO/PLAN/GUIA al día).

**Queda:** verificar `claude` y `agy` reales (`agy --help`, id del modelo, login AI Pro); `hubUrl` a https://jarvis-6pjr.onrender.com y enrolar el PC; `carpetas_permitidas`; fusionar `pro-integracion` a `main` y push (sin permiso aún); Bluetooth, Telegram, Google, Spotify, WhatsApp.

**Siguiente paso:** con permiso, fusionar y desplegar; luego probar una ronda Pro real en un repo de prueba.

**Verificar:** `npm test`; `node --test test/pro-e2e.test.js`; guía en docs/GUIA-USUARIO.md sección 15. Sin probar: CLIs reales, Render, iPhone.
