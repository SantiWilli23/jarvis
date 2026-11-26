<!-- estado-proyecto -->
# Estado de Jarvis (25-nov-2026) - fase 1 unida, sin publicar
**Pedido:** memoria única que se reparte cada mes, freno, control que pregunta, mouse solo en lo autorizado, "Hey Jarvis" y "Llegó papi", voz de película, estudio + calendario MDE.
**Hecho:** publicado cd571a6. Local en main: fase 0 y fase 1 (reparto de memoria, MCP apagado, freno), 434 tests ok; freno y panel de memoria vistos en web local.
**Siguiente:** fase 2 (estudio, calendario MDE, rutinas, voz de activación, voz elegida), 3 control amplio, 4 mouse. Push solo con permiso.
**Del usuario:** elegir voz, sí/no a descargar Vosk, iniciar sesión en Classroom (cuenta del colegio) y Lirmi.
**Sin probar:** Classroom, Lirmi, calendario, recoger/repartir con IA reales, MCP con Claude, .mcpb, freno en Windows e iPhone, app empaquetada.
**Pendiente técnico:** claude-textos no consulta el freno; Calendar sin color, día completo ni sin duplicar.
**Menor:** aviso dice "en Escolar" y la sección es "Estudiar".
**Plan pendiente de "ya" (otro chat):** micrófono permanente en /m (orbe prende/apaga, "Jarvis", 3 s silencio, 8 s para seguir) y Atajo+widget con Algenib; sin código; cruzarlo con "Hey Jarvis".
**Verificar:** `npm test`.
