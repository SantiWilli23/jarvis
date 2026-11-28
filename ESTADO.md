<!-- estado-proyecto -->
# Estado de Jarvis (27-nov-2026) - velocidad publicada
**Pedido:** memoria única mensual, freno, control que pregunta, mouse solo en lo autorizado, "Hey Jarvis" y "Llegó papi", voz de película, estudio + calendario MDE.
**Publicado:** fases 1 y 2 (5bdf3aa, sw v22), comprobado en Render; app del PC reiniciada.
**Velocidad (publicada):** voz en dos partes preparadas con la respuesta, corte de silencio 1,5 s, silencios recortados, MiniMax apagado, sw v24, menos consultas; 509 pruebas. Medido antes: ~12-13 s por voz; meta 6-7 s.
**Voz medida (producción):** chat 1,9 s; audio listo a ~10 s (meta 6-7 s no lograda); el plan gratis de Gemini corta tras pocas respuestas y habla la voz del navegador.
**Siguiente:** fases 3 control amplio y 4 mouse (rama fase34, plan hecho, programando); 3 frases que faltan (`node scripts/gen-frases.mjs`); decidir voz rápida del navegador o Algenib.
**Del usuario:** elegir voz, sí/no a Vosk ("Llegó papi"), sesión en Classroom y Lirmi, conectar Google (guía §14).
**Sin probar:** Classroom, Lirmi, eventos reales, repaso con material real, micrófono real, app empaquetada, recoger/repartir, MCP, freno en Windows e iPhone; voz nueva con Google real.
**Pendiente técnico:** al cambiar fecha de una prueba no se borra el evento viejo; rutina por horario se pierde si Render duerme >10 min.
**Micrófono (publicado):** "Hey Jarvis" en /m (orbe prende/apaga, 3 s, 8 s) y Atajo con voz (docs/ATAJO-JARVIS.md); sw v23; 473 pruebas. Falta probar en iPhone y armar el Atajo.
**Navegador rápido (publicado; app del PC ya lo usa):** una prueba por IA: ChatGPT 102→67 s, Gemini 93→44 s; 476 pruebas. Sin probar: Perplexity, Grok, Claude, lectura y escolar.
**Navegador sin PC (investigado, sin código):** sin tarjeta no hay servidor gratis 24/7 fiable (Codespaces: por horas y solo para desarrollo; AWS: 6 meses, adultos). Recomendado: portátil siempre encendido; falta ajustar Windows y probar con la sesión bloqueada.
**Ahorro + funciones (rama integra-uso, sin publicar; 524 pruebas):** ahorro de uso (interruptores en config/nav.json > ahorro), buenos días, recordatorios hablados (arregla lo atrasado), notas (docs/FUNCIONES.md); sw v25. Sin probar: tarea real con Chrome.
**Verificar:** `npm test`.
