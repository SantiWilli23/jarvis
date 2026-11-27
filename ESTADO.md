<!-- estado-proyecto -->
# Estado de Jarvis (27-nov-2026) - velocidad unida en main, sin publicar
**Pedido:** memoria única mensual, freno, control que pregunta, mouse solo en lo autorizado, "Hey Jarvis" y "Llegó papi", voz de película, estudio + calendario MDE.
**Publicado:** fases 1 y 2 (5bdf3aa, sw v22), comprobado en Render; app del PC reiniciada.
**Velocidad (en main, falta push):** voz en dos partes preparadas con la respuesta, corte de silencio 1,5 s, silencios recortados, MiniMax apagado, sw v24, menos consultas; 509 pruebas. Medido antes: ~12-13 s por voz; meta 6-7 s.
**Siguiente:** publicar (con permiso), medir en producción, 6 frases pregrabadas que faltan (`node scripts/gen-frases.mjs`), fase 3 control amplio, fase 4 mouse.
**Del usuario:** elegir voz, sí/no a Vosk ("Llegó papi"), sesión en Classroom y Lirmi, conectar Google (guía §14).
**Sin probar:** Classroom, Lirmi, eventos reales, repaso con material real, micrófono real, app empaquetada, recoger/repartir, MCP, freno en Windows e iPhone; voz nueva con Google real.
**Pendiente técnico:** al cambiar fecha de una prueba no se borra el evento viejo; rutina por horario se pierde si Render duerme >10 min.
**Micrófono (publicado):** "Hey Jarvis" en /m (orbe prende/apaga, 3 s, 8 s) y Atajo con voz (docs/ATAJO-JARVIS.md); sw v23; 473 pruebas. Falta probar en iPhone y armar el Atajo.
**Navegador rápido (publicado; app del PC ya lo usa):** una prueba por IA: ChatGPT 102→67 s, Gemini 93→44 s; 476 pruebas. Sin probar: Perplexity, Grok, Claude, lectura y escolar.
**Navegador sin PC (investigado, sin código):** sin tarjeta no hay servidor gratis 24/7 fiable (Codespaces: por horas y solo para desarrollo; AWS: 6 meses, adultos). Recomendado: portátil siempre encendido; falta ajustar Windows y probar con la sesión bloqueada.
**Plan (sin código, falta "ya"):** ahorrar uso de Claude (medir coste; caché 5 min; sondas del doctor cada 24 h; flags estrictas en Clásico/Pro; nav con menos turnos y capturas) y funciones nuevas (buenos días, recordatorios hablados, notas/promedio; las que usan base de datos, tras publicar velocidad).
**Verificar:** `npm test`.
