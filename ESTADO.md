<!-- estado-proyecto -->
# Estado de Jarvis (26-nov-2026) - fase 1 publicada, fase 2 en curso
**Pedido:** memoria única que se reparte cada mes, freno, control que pregunta, mouse solo en lo autorizado, "Hey Jarvis" y "Llegó papi", voz de película, estudio + calendario MDE.
**Hecho:** publicado y comprobado en Render (3ee0173, sw v21): reparto de memoria, freno, MCP apagado (responde 404).
**Siguiente:** unir ramas f2-calendario, f2-repaso, f2-rutinas, f2-despertar (agentes en marcha), probar y subir sw a v22; luego 3 control amplio, 4 mouse. Push solo con permiso.
**Del usuario:** elegir voz, sí/no a descargar Vosk, iniciar sesión en Classroom (cuenta del colegio) y Lirmi.
**Sin probar:** Classroom, Lirmi, calendario, recoger/repartir con IA reales, MCP con Claude, .mcpb, freno en Windows e iPhone, app empaquetada.
**Pendiente técnico:** claude-textos no consulta el freno; Calendar sin color, día completo ni sin duplicar.
**Menor:** aviso dice "en Escolar" y la sección es "Estudiar".
**Micrófono permanente (otro chat, sin código):** el usuario eligió hacerlo allí cuando acaben estas fases; dejar fuera la escucha en /m (orbe, "Jarvis", 3 s, 8 s) y el Atajo+widget.
**Verificar:** `npm test`.
