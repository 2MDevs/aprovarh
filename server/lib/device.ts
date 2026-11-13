/** Leitura simples do User-Agent para mostrar "Chrome no Windows" na tela Dispositivos. */
export function descreverDispositivo(ua: string | undefined) {
  const s = ua || '';
  const sistema = /Windows/i.test(s)
    ? 'Windows'
    : /Android/i.test(s)
      ? 'Android'
      : /iPhone|iPad|iPod/i.test(s)
        ? 'iOS'
        : /Mac OS X|Macintosh/i.test(s)
          ? 'macOS'
          : /Linux/i.test(s)
            ? 'Linux'
            : 'Desconhecido';
  const navegador = /Edg\//.test(s)
    ? 'Edge'
    : /OPR\//.test(s)
      ? 'Opera'
      : /SamsungBrowser/.test(s)
        ? 'Samsung Internet'
        : /Chrome\//.test(s)
          ? 'Chrome'
          : /Firefox\//.test(s)
            ? 'Firefox'
            : /Safari\//.test(s)
              ? 'Safari'
              : 'Navegador';
  const tipo = /iPad|Tablet/i.test(s) ? 'tablet' : /Mobi|Android|iPhone/i.test(s) ? 'celular' : 'computador';
  return { sistema, navegador, tipo, nome: `${navegador} no ${sistema}` };
}
