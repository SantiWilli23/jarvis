<!-- estado-proyecto -->
# Estado de Jarvis (25-nov-2026) - main local, sin push
**Pedido:** voz en la pestaña Pro; desde Clásico, Claude Code del PC usa Chrome para preguntar a IAs web o buscar en Google (contrato `docs/NAV.md`).
**Hecho:** voz en Pro (escritorio y /m), cola `nav` en servidor, runner nav en el PC; 3 ramas unidas. Tarea nav aislada con `--strict-mcp-config`.
**Probado:** búsqueda real en Google desde el PC con el worker (estado ok, con fuentes).
**Queda:** permiso para push/deploy, reiniciar la app del PC, probar "pregúntale a Gemini/ChatGPT", voz en navegador/iPhone, limpiar worktrees (ojo: junctions node_modules).
**Límites:** el control de hosts no ve clics ni redirecciones; sin PC encendido + Chrome con extensión no hay navegador.
**Verificar:** `npm test`.
