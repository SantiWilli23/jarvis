# Estado de Jarvis (13-nov-2026)

**Pedido:** Jarvis personal gratis (orbe azul, voz Algenib, "Hola señor."), en Render+Turso, con control del PC y del iPhone.

**Hecho:** nube en Render+Turso con cron anti-sueño; cadena gratis Gemini→Groq→OpenRouter→Cloudflare→Ollama; voz Algenib; rediseño web (solo Conexiones, nombre en rojo al usar); vista móvil `/m` de una pantalla; cola del teléfono con lista blanca y aprobaciones (98/98 pruebas, commit 9e8a3b5).

**Queda:** fases 3 y 4 (correo despertador `PHONE_NUDGE_EMAIL` y push) en worktree `C:\Users\javit\jarvis-fase34` (rama fase34-despertador-push); plan de Gemini Flash/Pro (Opus en curso); pestañas Clásico/Pro y YouTube Music (otras sesiones); Bluetooth real; Telegram, Google, Spotify, WhatsApp; Claude Code sin instalar en el PC.

**Siguiente paso:** revisar y unir la rama de las fases 3 y 4, mostrar el plan de Gemini y esperar "ya". Regenerar claves expuestas en el chat y cambiar la contraseña de prueba.

**Verificar:** `npm test` (98/98); `npm run dev` y abrir localhost:3055 y `/m`; en el iPhone armar el Atajo con docs/ATAJO-PUENTE.md. Sin probar: iPhone real, push, voz y micrófono en producción.
