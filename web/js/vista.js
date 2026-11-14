// Sin scripts en línea (CSP script-src 'self'): redirección a /m en teléfonos y enlace de vuelta.
// Teléfonos (lado corto de la pantalla < 600 px) van a la vista móvil /m, salvo que se haya elegido "vista escritorio". iPad y Electron se quedan aquí.
(function () {
  try {
    var s = Math.min(screen.width, screen.height);
    if (s < 600 && !/Electron/i.test(navigator.userAgent) && localStorage.getItem("jarvis_vista") !== "escritorio") location.replace("/m");
  } catch (e) { /* sin redirección */ }
})();

document.addEventListener("DOMContentLoaded", function () {
  var a = document.getElementById("tomovil");
  if (a) a.addEventListener("click", function () { try { localStorage.removeItem("jarvis_vista"); } catch (e) {} });
});
