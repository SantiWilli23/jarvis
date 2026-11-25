<!-- estado-proyecto -->
# Estado de Jarvis (25-nov-2026) - main c094cfc + 3 ramas en curso
**Pedido:** voz en la pestaña Pro; desde Clásico, Claude Code del PC usa Chrome para preguntar a IAs web o buscar en Google (plan aceptado, contrato en `docs/NAV.md`).
**Hecho:** "abre Futotal/Ski" desplegado (c669f63). Probado: `claude -p --chrome` abre Google en el PC sin pedir permisos.
**En curso (worktrees):** `jarvis-voz-pro` (voz Pro), `jarvis-nav-pc` (runner del PC), `jarvis-nav-srv` (cola, chat y web).
**Queda:** revisar y unir las 3 ramas, `npm test`, prueba real en el PC, pedir permiso para push/deploy, reiniciar app del PC.
**Sin probar:** botones de juegos y bloqueo de pestañas en iPhone.
**Verificar:** `npm test`.
