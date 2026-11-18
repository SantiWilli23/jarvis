<!-- estado-proyecto -->
# Estado de Jarvis (18-nov-2026) - rama control-pc-ola2 (desde main c669f63)
**Pedido:** Ola D1 lado PC: archivos, captura, suspender/apagar seguros.
**Hecho:** apagar/reiniciar/suspender SIEMPRE con aprobación (forzado en `validateParams`); suspender real por PowerShell; `cancelar_apagado`; `archivos_listar`/`archivos_leer` (`pc-files.js`, raíces `pc_carpetas`, realpath, 100 entradas, 1 MB, 2000 car.); `captura` (`pc-capture.js`, Claude local sin herramientas, JPEG 1568 px, borrado siempre); GUARDIANES y SECRETOS ampliados; intents en español.
**Pruebas:** `test/pc-ola2.test.js`; `npm test` 323 verdes.
**Queda:** probar en Windows/Electron real (OneDrive, suspender, captura, flags de Claude `--tools ""` + entrada stream-json con imagen). Tope diario/registro de capturas: ola D2 (servidor). Sin push ni deploy.
**Verificar:** `npm test`.
