# Hablar con Jarvis desde el iPhone (Atajo "Jarvis")

Usted dice algo, Jarvis contesta en voz alta y vuelve a escuchar. Se puede lanzar con Siri, con un botón o
tocando la parte de atrás del teléfono.

> **No probado en un iPhone real.** La parte del servidor tiene pruebas automáticas; los nombres de botones y
> menús del iPhone pueden cambiar según la versión de iOS. Si un bloque no aparece con ese nombre, búsquelo por
> una palabra ("dictar", "Base64", "sonido", "hablar").

Este Atajo es **distinto** de "Jarvis Puente" ([ATAJO-PUENTE.md](ATAJO-PUENTE.md)). No borre ni cambie aquel, y
no reutilice su clave: aquí no sirve.

## 1. Crear la clave
1. En el iPhone abra Jarvis (`https://jarvis-6pjr.onrender.com/m`).
2. Toque **Más**, luego **Dispositivos**, luego **Crear clave para hablar con Jarvis**.
3. Copie la clave: solo se muestra una vez. No la comparta ni haga capturas donde se vea.

Si no ve ese botón, es que esta novedad aún no está publicada, o hay que cerrar y volver a abrir Jarvis.

## 2. Armar el Atajo
Abra la app **Atajos**, toque **+** y póngale de nombre **Jarvis**. Añada los bloques en este orden.

1. **Repetir** (ponga **6** veces). Todo lo que sigue va **dentro** del Repetir.
2. **Dictar texto**. Toque la flecha: idioma **Español** y **Dejar de escuchar: Después de una pausa**.
3. **Si** "Texto dictado" **no tiene ningún valor**: dentro ponga **Detener este atajo**. Después, **Finalizar si**.
4. **Obtener contenido de URL**, con esta dirección: `https://jarvis-6pjr.onrender.com/api/shortcut`.
   Toque la flecha para ver sus opciones:
   - Método: **POST**
   - Cabeceras: añada una. En el nombre escriba `Authorization`. En el valor escriba `Bearer`, **un espacio** y
     pegue su clave. Queda así: `Bearer SU_CLAVE`
   - Cuerpo de la solicitud: **JSON**, con dos campos:
     - `text`, tipo **Texto**: elija la variable **Texto dictado**.
     - `voz`, tipo **Booleano**: **Verdadero**.
5. **Obtener valor del diccionario**: la clave `audio_b64`, en "Contenido de URL".
6. **Si** ese valor **tiene algún valor**, dentro:
   1. **Codificar Base64**: cambie "Codificar" por **Decodificar**. Entrada: el valor del paso 5.
   2. **Reproducir sonido** con el resultado.
7. En la parte **Si no** del mismo bloque:
   1. **Obtener valor del diccionario**: la clave `speak`, en "Contenido de URL".
   2. **Si** `speak` **tiene algún valor**: **Hablar texto** con `speak`, en español.
   3. En su "Si no": **Mostrar alerta** con "Contenido de URL" (para ver qué pasó) y **Detener este atajo**.
8. Compruebe que cada **Si** tiene su **Finalizar si** y que debajo de todo queda **Finalizar repetición**.

Para terminar la conversación, quédese callado. Si el Atajo no se detiene solo, toque el botón de parar.
Si quiere más o menos vueltas, cambie el número del paso 1.

La primera vez, ejecútelo tocándolo dentro de Atajos y acepte los permisos (micrófono, dictado y conexión con
`jarvis-6pjr.onrender.com`; si ofrece **Permitir siempre**, elíjalo).

## 3. Cómo lanzarlo
- **Siri:** diga "Oye Siri, Jarvis". Si abre otra cosa (por ejemplo "Jarvis Puente"), cambie el nombre de este
  Atajo a algo como "Habla Jarvis" y diga ese nombre.
- **Sin decir "Oye Siri"** (iOS 18 o posterior): **Ajustes > Accesibilidad > Atajos vocales** (o "Atajos de voz"),
  añada uno, elija el Atajo **Jarvis** y grabe la palabra "Jarvis".
- **Widget:** mantenga pulsada la pantalla de inicio, añada el widget **Atajos** y elija **Jarvis**.
- **Centro de control** (iOS 18 o posterior): ábralo, mantenga pulsado un hueco, **Añadir un control**, **Atajo**,
  y elija **Jarvis**.
- **Pantalla bloqueada** (iOS 18 o posterior): mantenga pulsada la pantalla bloqueada, **Personalizar**, y cambie
  uno de los botones de abajo por el control de Atajos con **Jarvis**.
- **Tocar atrás:** **Ajustes > Accesibilidad > Tocar > Tocar atrás > Tocar dos veces > Jarvis**.
- **Botón de acción** (solo en los iPhone que lo tienen): **Ajustes > Botón de acción > Atajo > Jarvis**.

Con el teléfono bloqueado, iOS puede pedir que lo desbloquee antes de seguir, según cómo lo lance y sus ajustes
de Siri (permitir Siri con el iPhone bloqueado).

## 4. Qué voz va a oír
- Lo normal: la voz de Jarvis (Algenib).
- La voz del iPhone cuando la respuesta es **privada** (no se envía a ningún servicio de voz externo), cuando se
  acabó el cupo de voz del día (el tope puesto en Jarvis son 30 respuestas) o si la voz falla.

Si quiere que algo se trate como privado siempre, añada al JSON un campo `private`, tipo Booleano, Verdadero.

## 5. Si algo va mal
- `no_autorizado`: la clave está mal copiada o fue revocada.
- `dispositivo_no_permitido`: usó otra clave (por ejemplo la de "Jarvis Puente"). Cree la del apartado 1.
- Tarda mucho o da error la primera vez: Jarvis estaba dormido; espere cerca de un minuto y repita.
- Las acciones delicadas siguen pidiendo su aprobación en Jarvis, y el freno sigue mandando.

## 6. Lo que falta comprobar en un iPhone real
- Que los bloques se llamen así y se puedan armar como se describe.
- Que **Reproducir sonido** suene bien con el audio recibido y que termine antes de volver a escuchar (si Jarvis se
  escucha a sí mismo, añada un bloque **Esperar** de 1 segundo antes de **Finalizar repetición**).
- Que el dictado funcione con el teléfono bloqueado y desde cada una de las formas del apartado 3.
- Que quedarse callado deje el texto vacío y detenga el Atajo.
- Cuánto tarda cada respuesta.
