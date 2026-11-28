# Funciones sin modelo

Se resuelven con reglas en el servidor (`server/funciones/`): no gastan Claude y no van a Gemini ni OpenRouter.
Sirven por chat, voz, /m, Telegram (texto libre) y Atajo. Las respuestas se tratan como privadas.
En modo Chat no se hacen acciones.

## Buenos días
- "Buenos días, Jarvis"
- "Mi comuna es Valdivia" (se dice una vez)

Dice el clima de hoy (Open-Meteo, sin clave; solo se le envía la comuna o sus coordenadas), las pruebas y pendientes
de Classroom de los próximos 7 días si ya hay datos leídos, y los recordatorios de hoy. En el Atajo y en Telegram,
del colegio solo se dice cuántas cosas hay.

## Recordatorios
- "Recuérdame el jueves a las 5 llevar el libro"
- "Mañana a las 8 recuérdame estudiar"
- "Recuérdame en 20 minutos sacar la ropa"
- "Recuérdame el 3 de diciembre pagar la cuota"
- "Mis recordatorios", "qué recordatorios tengo mañana"
- "Borra el recordatorio 2", "borra el último recordatorio", "borra el recordatorio del libro", "borra todos los recordatorios"

Zona America/Santiago. Sin "de la mañana/tarde": de 1 a 6 es la tarde; de 7 a 10, la próxima que venga.
Sin hora: 08:00 (si es para hoy, 18:00). Jarvis confirma lo que entendió. El aviso llega por push y/o Telegram;
si no hay ningún canal, se reintenta. Con Render dormido sale al despertar, una vez, como "atrasado".

## Notas (1,0 a 7,0)
- "Me saqué un 5,8 en mate", "me saqué un 6,2 en historia que vale 30%"
- "¿Cuál es mi promedio?", "¿cuál es mi promedio de mate?"
- "¿Cuánto necesito en la próxima para promediar 6?" (sin ramo, usa el de la última nota)
- "Mis notas", "mis notas de historia"
- "Borra la última nota", "corrige la última nota a 6,1"

Con ponderaciones, las notas sin porcentaje se reparten lo que falta hasta 100. "Cuánto necesito" no cuenta
el redondeo a favor. El promedio general es el promedio de los promedios de cada ramo.
