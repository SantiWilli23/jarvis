<!-- estado-proyecto -->
# Estado de Jarvis (26-nov-2026) - fase 2 publicada
**Pedido:** memoria única mensual, freno, control que pregunta, mouse solo en lo autorizado, "Hey Jarvis" y "Llegó papi", voz de película, estudio + calendario MDE.
**Publicado:** fases 1 y 2 (5bdf3aa, sw v22), comprobado en Render; app del PC reiniciada.
**Hecho:** calendario MDE, plan y repaso, rutinas, "Hey Jarvis" en el escritorio (apagado por defecto); 459 pruebas.
**Siguiente:** micrófono (otro chat), fase 3 control amplio, fase 4 mouse. Cada push, solo con permiso.
**Del usuario:** elegir voz, sí/no a Vosk ("Llegó papi"), sesión en Classroom y Lirmi, conectar Google (guía §14).
**Sin probar:** Classroom, Lirmi, crear eventos reales, repaso con material real, micrófono real, app empaquetada, recoger/repartir, MCP, freno en Windows e iPhone.
**Probado:** Claude real sin herramientas (0 herramientas, 0 conectores); paneles en web local.
**Pendiente técnico:** al cambiar fecha de una prueba no se borra el evento viejo; rutina por horario se pierde si Render duerme >10 min.
**Micrófono (rama mic-int, sin unir a main ni publicar):** "Hey Jarvis" en /m (orbe prende/apaga, 3 s, 8 s) y Atajo con voz (docs/ATAJO-JARVIS.md); sw v23; 473 pruebas. Falta permiso de push y probar en iPhone.
**Verificar:** `npm test`.
