// Segundo detector: "Llegó papi". PREPARADO, SIN IMPLEMENTAR. No hay nada descargado ni instalado para esto.
//
// Falta:
//  1. Permiso del usuario para descargar el modelo pequeño en español de Vosk (vosk-model-small-es,
//     unos 40 MB) y la librería que lo ejecute (p. ej. vosk-browser, WASM). Revisar origen, licencia y sha256.
//  2. Guardar el modelo fuera del repo, junto a los de openWakeWord (<datos de la app>/wake).
//  3. Devolver aquí { procesar(muestras 16 kHz escala int16) -> Promise<boolean>, reiniciar() }, con
//     gramática restringida ["llegó papi", "[unk]"] y antirrebote como el de detector.js.
//  4. Probar falsos positivos con conversación normal y música.
// escucha.js admite varios detectores: al devolver algo distinto de null queda enchufado.
export async function crearDetectorLlegoPapi() {
  return null;
}
