# Atajo "Jarvis Puente" (iPhone)

El iPhone no deja que una web controle la linterna, el brillo, etc. El Atajo hace de puente:
pregunta a Jarvis qué hay pendiente y lo ejecuta.

## 1. Crear el token
En la vista móvil (`/m`): Más, Dispositivos, "Crear token para el Atajo del iPhone".
(O `POST /api/devices` con `{"kind":"phone"}` desde una sesión web.) Cópielo: solo se muestra una vez.
Ese token solo sirve para `/api/phone/next` y `/api/phone/actions/:id/done`; para todo lo demás da 403.

## 2. Crear el Atajo (nombre exacto: Jarvis Puente)
1. **Obtener contenido de URL**
   - URL: `https://TU-SERVIDOR/api/phone/next`
   - Método: POST. Cabecera `Authorization` = `Bearer TU_TOKEN`.
   - Si Render estaba dormido tarda ~50 s: ponga el bloque dentro de "Repetir" 3 veces
     o añada "Esperar 20 s" y reintente si no hay respuesta.
2. **Obtener valor del diccionario** `acciones` y **Repetir con cada elemento**.
3. Dentro, **Obtener valor** `accion` y un bloque **Si** por cada acción de `config/phone-actions.json`
   (linterna, brillo, volumen, no_molestar, bajo_consumo, modo_oscuro, multimedia, decir, vibrar,
   bateria, abrir_app, alarma, recordatorio, bluetooth, wifi, datos_moviles, modo_avion, ubicacion,
   leer_portapapeles, enviar_mensaje, llamar, abrir_url, escena_homekit). Use `valor` y los extras
   (`minutos`, `para`, `etiqueta`) del elemento.
4. Al terminar cada una: **Obtener contenido de URL** POST a
   `https://TU-SERVIDOR/api/phone/actions/ID/done` (ID = `id` del elemento), mismo Bearer,
   cuerpo JSON `{"ok": true, "result": "lo que devolvió"}` (`"ok": false` si falló).

## 3. Lanzarlo
- Botón "Ejecutar en el iPhone" de la hoja Teléfono (abre `shortcuts://run-shortcut?name=Jarvis%20Puente`).
- O automatización de iOS (hora, llegar a un sitio, abrir una app) que ejecute el Atajo.

Las acciones sensibles (Wi-Fi off, modo avión, portapapeles, mensajes, llamadas) esperan su aprobación
en Jarvis antes de aparecer en `/next`. Una acción no recogida caduca a los 10 min.
