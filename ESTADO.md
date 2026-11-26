<!-- estado-proyecto -->
# Estado de Jarvis (25-nov-2026) - Fase 0 en commit local, sin push
**Pedido:** memoria única que se reparte cada mes, freno, control que pregunta, mouse solo en lo autorizado, "Hey Jarvis" y "Llegó papi", voz de película, estudio + calendario MDE.
**Plan aprobado:** Fase 0 base; 1 memoria/MCP, freno, mismo chat; 2 estudio, rutinas, voz; 3 control; 4 mouse.
**Hecho:** versión anterior publicada (cd571a6). Fase 0: andamiaje (docs/MEMORIA.md y CONTROL.md, sw v20); solo `memoria/proponer` funciona, /mcp da 501 (sin revisar).
**Falta:** revisar Fase 0, resto de fases 1-4, .mcpb. Freno hecho (rama f1-freno): subir sw a v21 al integrar; claude-textos debe consultar el freno al repartir. Push solo con permiso.
**Del usuario:** iniciar sesión en Classroom (cuenta del colegio) y Lirmi, elegir voz, sí/no a descargar Vosk.
**Sin probar:** freno en Windows real (bandeja, Ctrl+Alt+F, árbol de procesos) y en navegador; lectura de Classroom y Lirmi, calendario, reparto de memoria, iPhone real, app empaquetada.
**Menor:** aviso dice "en Escolar" y la sección es "Estudiar".
**Verificar:** `npm test` (414 ok con el freno).
