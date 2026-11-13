/* Aplica o tema salvo antes de desenhar a página (evita piscar branco no modo escuro). */
(function () {
  try {
    var p = localStorage.getItem('arh.tema');
    var escuro = p === 'escuro' || (p !== 'claro' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (escuro) {
      document.documentElement.classList.add('dark');
      var m = document.querySelector('meta[name="theme-color"]');
      if (m) m.setAttribute('content', '#141413');
    }
  } catch (e) {}
})();
