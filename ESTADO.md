# Estado de Jarvis (13-nov-2026)

**Pedido:** Jarvis personal gratis (orbe azul, voz Algenib, "Hola señor."), en Render+Turso, con control del PC y del iPhone.

**Hecho:** nube Render+Turso con cron anti-sueño; cadena gratis Gemini→Groq→OpenRouter→Cloudflare→Ollama; rediseño web; vista móvil `/m`; cola del teléfono con lista blanca y aprobaciones; correo despertador y Web Push (107/107 pruebas). Unido en la rama `pro-base`.

**Queda:** `main` y GitHub siguen en 9e8a3b5 (push de fases 3 y 4 bloqueado, falta permiso); definir `PHONE_NUDGE_EMAIL` en Render; plan de Gemini Flash/Pro (Opus en curso); pestañas Clásico/Pro y YouTube Music (otras sesiones); Bluetooth real; Telegram, Google, Spotify, WhatsApp.

**Siguiente paso:** con permiso del usuario, adelantar `main` a `pro-base` y hacer push (Render despliega solo). Luego mostrar el plan de Gemini y esperar "ya". Regenerar claves expuestas y cambiar la contraseña de prueba.

**Verificar:** `npm test` (107/107); `npm run dev` y abrir localhost:3055 y `/m`; en el iPhone armar el Atajo con docs/ATAJO-PUENTE.md. Sin probar: iPhone real, correo y push reales, voz en producción.
