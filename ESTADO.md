<!-- estado-proyecto -->
# Estado de Jarvis (27-nov-2026) - fases 3 y 4 publicadas
**Pedido:** memoria única mensual, freno, control que pregunta, mouse solo en lo autorizado, "Hey Jarvis" y "Llegó papi", voz de película, estudio + calendario MDE.
**Publicado:** fases 1 y 2 (5bdf3aa, sw v22), comprobado en Render; app del PC reiniciada.
**Velocidad (publicada):** voz en dos partes preparadas con la respuesta, corte de silencio 1,5 s, silencios recortados, MiniMax apagado, sw v24, menos consultas; 509 pruebas. Medido en producción: chat 1,9 s, audio ~10 s (meta 6-7 s no lograda); Gemini gratis corta y habla la voz del navegador.
**Fases 3 y 4 (publicadas 8bdab80, comprobado en Render; app del PC reiniciada):** control amplio y ratón/teclado, apagados por defecto, panel "Control del PC", sw v26, 541 pruebas; sin probar en Windows real (docs/CONTROL.md).
**Siguiente:** primera prueba real (Bloc de notas); 3 frases que faltan (Gemini TTS gratis: 10 pedidos al día; `node scripts/gen-frases.mjs`); decidir voz del navegador o Algenib.
**Del usuario:** elegir voz, sí/no a Vosk ("Llegó papi"), sesión en Classroom y Lirmi, conectar Google (guía §14).
**Sin probar:** Classroom, Lirmi, eventos reales, repaso con material real, micrófono real, app empaquetada, recoger/repartir, MCP, freno en Windows e iPhone; voz nueva con Google real.
**Pendiente técnico:** al cambiar fecha de una prueba no se borra el evento viejo; si Render duerme, recordatorios y rutinas avisan tarde (marcados atrasados).
**Micrófono (publicado):** "Hey Jarvis" en /m (orbe prende/apaga, 3 s, 8 s) y Atajo con voz (docs/ATAJO-JARVIS.md); sw v23; 473 pruebas. Falta probar en iPhone y armar el Atajo.
**Navegador rápido (publicado; app del PC ya lo usa):** una prueba por IA: ChatGPT 102→67 s, Gemini 93→44 s; 476 pruebas. Sin probar: Perplexity, Grok, Claude, lectura y escolar.
**Navegador sin PC (investigado, sin código):** sin tarjeta no hay servidor gratis 24/7 fiable (Codespaces: por horas y solo para desarrollo; AWS: 6 meses, adultos). Recomendado: portátil siempre encendido; falta ajustar Windows y probar con la sesión bloqueada.
**Ahorro + funciones (publicado 811a570, sw v25; 524 pruebas):** buenos días, recordatorios hablados, notas (docs/FUNCIONES.md); ahorro de uso (config/nav.json > ahorro). Una prueba real ChatGPT OK: 0,057 vs ~0,077 USD antes. Sin probar: Gemini, lectura, escolar, Clásico/Pro, iPhone.
**Verificar:** `npm test`.
