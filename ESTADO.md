# Estado de Jarvis (13-nov-2026)

**Pedido:** Jarvis personal gratis (orbe azul, voz Algenib, "Hola señor."), en Render+Turso, con control del PC y del iPhone.

**Hecho:** nube Render+Turso con cron anti-sueño; cadena gratis de IAs; rediseño web y vista móvil `/m` (en main/GitHub); cola del teléfono; correo despertador y Web Push (107/107 pruebas, solo en rama `pro-base`). Plan de Gemini Flash/Pro hecho; decisiones: usar `agy` con AI Pro, Flash si PC apagado, respaldo a Gemini Pro, Flash 3.8.

**Queda:** push de `main` con fases 3 y 4 (bloqueado, falta permiso); `PHONE_NUDGE_EMAIL` en Render; fase 0 de Gemini (usuario instala `agy` ≥1.1.1 y entra con AI Pro); programar Gemini cuando la sesión Clásico/Pro haga commit (tocan agent.js, context.js, schema.sql, db/index.js); Bluetooth real; Telegram, Google, Spotify, WhatsApp.

**Siguiente paso:** con permiso, adelantar `main` a `pro-base` y push; luego fase 0 de Gemini y lanzar a Sonnet (F1 servidor, F2 runner agy, F3 web).

**Verificar:** `npm test` (107/107); `npm run dev` → localhost:3055 y `/m`; Atajo con docs/ATAJO-PUENTE.md. Sin probar: iPhone real, correo/push reales, `agy`.
