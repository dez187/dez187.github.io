// Applica il tema scelto prima del primo disegno della pagina (niente lampo di colore sbagliato).
(function () {
  try {
    var t = localStorage.getItem("patrimonio:theme");
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
  } catch (e) {}
})();
