// Lee un examen en LaTeX que use \ejercicio{[CE x.y] enunciado} y lo trocea en ejercicios y apartados.
// Cada etiqueta [CE x.y] del título es un apartado con su criterio; sin etiquetas, un único apartado sin criterio.

const escapar = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Devuelve [contenido, índice posterior al cierre] del grupo {…} que empieza en i (s[i] === '{').
function grupo(s, i, abre = '{', cierra = '}') {
  if (s[i] !== abre) return null;
  let n = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '\\') { j++; continue; }
    if (s[j] === abre) n++;
    else if (s[j] === cierra && --n === 0) return [s.slice(i + 1, j), j + 1];
  }
  return null;
}

const sinComentarios = (s) => s.replace(/(^|[^\\])%.*$/gm, '$1');

function parsearExamen(tex) {
  let cuerpo = sinComentarios(tex);
  const ini = cuerpo.indexOf('\\begin{document}');
  if (ini >= 0) cuerpo = cuerpo.slice(ini + '\\begin{document}'.length);
  const fin = cuerpo.indexOf('\\end{document}');
  if (fin >= 0) cuerpo = cuerpo.slice(0, fin);

  const marcas = [];
  const re = /\\ejercicio\s*(?=\{)/g;
  let m;
  while ((m = re.exec(cuerpo))) {
    const g = grupo(cuerpo, m.index + m[0].length);
    if (g) marcas.push({ ini: m.index, titulo: g[0], desde: g[1] });
  }

  // Exámenes sin \ejercicio: un enumerate donde cada \item empieza por \textbf{[CE 4.1 CE 5.1]}. Cada \item es un ejercicio de un único apartado.
  if (!marcas.length) marcas.push(...itemsDeEnumerate(cuerpo));

  const items = [];
  marcas.forEach((mk, k) => {
    const ejercicio = k + 1;
    const resto = cuerpo.slice(mk.desde, mk.fin != null ? mk.fin : k + 1 < marcas.length ? marcas[k + 1].ini : cuerpo.length);
    const etiquetas = [...mk.titulo.matchAll(/\[\s*(C[EC]\s*[\d.]+)\s*\]/gi)].map((x) => x[1].replace(/\s+/g, ' ').toUpperCase());
    const titulo = mk.titulo.replace(/\[\s*C[EC]\s*[\d.]+\s*\]/gi, '').replace(/\s+/g, ' ').trim();
    const enunciado = texAHtml(resto);
    if (mk.junto) {
      const codigos = [...mk.titulo.matchAll(/C[EC]\s*[\d.]+/gi)].map((x) => x[0].replace(/\s+/g, ' ').toUpperCase());
      const inicio = resto.replace(/\$/g, '').replace(/\s+/g, ' ').trim();
      items.push({ ejercicio, apartado: '', titulo: inicio.length > 70 ? inicio.slice(0, 70).replace(/\s\S*$/, '') + '…' : inicio, enunciado, fuente: resto.replace(/\\newpage|\\vspace\{[^}]*\}/g, '').replace(/\n{3,}/g, '\n\n').trim(), criterio: codigos.join(', '), max: 4 });
      return;
    }
    const n = Math.max(etiquetas.length, 1);
    for (let p = 0; p < n; p++) {
      items.push({
        ejercicio,
        apartado: n === 1 ? '' : String.fromCharCode(97 + p),
        titulo,
        enunciado,
        fuente: resto.replace(/\\newpage|\\vspace\{[^}]*\}/g, '').replace(/\n{3,}/g, '\n\n').trim(),
        criterio: etiquetas[p] || '',
        max: 4,
      });
    }
  });
  return items;
}

function itemsDeEnumerate(cuerpo) {
  const ini = cuerpo.search(/\\begin\{enumerate\}(\[[^\]]*\])?/);
  if (ini < 0) return [];
  const re = /\\(begin|end)\{(enumerate|itemize)\}|\\item\b/g;
  re.lastIndex = ini;
  let nivel = 0, fin = cuerpo.length;
  const cortes = [];
  let m;
  while ((m = re.exec(cuerpo))) {
    if (m[1] === 'begin') nivel++;
    else if (m[1] === 'end') { if (--nivel === 0) { fin = m.index; break; } }
    else if (nivel === 1) cortes.push([m.index, m.index + m[0].length]);
  }
  return cortes.map(([ini, c], k) => {
    const e = cuerpo.slice(c, k + 1 < cortes.length ? cortes[k + 1][0] : fin).match(/^\s*\\textbf\{\s*(\[[^\]]*\])\s*\}/);
    return e ? { ini, titulo: e[1], desde: c + e[0].length, junto: true } : null;
  }).filter(Boolean).map((x, k, todos) => ({ ...x, fin: k + 1 < todos.length ? todos[k + 1].ini : fin }));
}

// ── Conversión muy básica a HTML (las fórmulas se dejan para MathJax en el navegador) ──
const HUECO = '\\underline{\\phantom{xxxxxxxx}}';

function texAHtml(src) {
  const mates = [];
  const guardar = (s) => `\u0002${mates.push(s) - 1}\u0003`;
  let s = sinComentarios(src);

  s = s.replace(/\\hueco(\[[^\]]*\])?/g, '\u0004');
  s = s.replace(/\\begin\{(align|flalign|alignat|equation|gather|eqnarray)(\*?)\}([\s\S]*?)\\end\{\1\2\}/g,
    (_, e, st, c) => guardar(`\\begin{${e}${st}}${c.replace(/\u0004/g, HUECO)}\\end{${e}${st}}`));
  s = s.replace(/\\\[([\s\S]*?)\\\]/g, (_, c) => guardar(`\\[${c.replace(/\u0004/g, HUECO)}\\]`));
  s = s.replace(/\$([^$]+)\$/g, (_, c) => guardar(`$${c.replace(/\u0004/g, HUECO)}$`));
  s = s.replace(/\u0004/g, '________');

  s = escapar(s);

  s = s.replace(/\\begin\{(itemize|enumerate)\}(\[[^\]]*\])?/g, (_, t) => (t === 'itemize' ? '<ul>' : '<ol>'));
  s = s.replace(/\\end\{(itemize|enumerate)\}/g, (_, t) => (t === 'itemize' ? '</ul>' : '</ol>'));
  s = s.replace(/\\item\s*/g, '<li>');
  s = tablas(s);
  s = s.replace(/\\begin\{minipage\}(\[[^\]]*\])?\{[^}]*\}/g, '<div class="mini">').replace(/\\end\{minipage\}/g, '</div>');
  s = s.replace(/\\begin\{(center|small|footnotesize)\}/g, '<div>').replace(/\\end\{(center|small|footnotesize)\}/g, '</div>');
  s = s.replace(/\\text(bf|it|sc)\{([^{}]*)\}/g, (_, t, c) => (t === 'bf' ? `<b>${c}</b>` : t === 'it' ? `<i>${c}</i>` : c));
  s = s.replace(/\\emph\{([^{}]*)\}/g, '<i>$1</i>');
  s = s.replace(/\\(setlength|renewcommand|vspace\*?|hspace\*?)\s*(\{[^{}]*\})+/g, '');
  s = s.replace(/\\(setlength|renewcommand)\*?\{[^{}]*\}\{[^{}]*\}/g, '');
  s = s.replace(/\\rightarrow/g, '→');
  s = s.replace(/\\(q?quad)\b/g, ' ');
  s = s.replace(/\\(newpage|noindent|hfill|medskip|smallskip|bigskip|par|centering|footnotesize|small|large|Large|raggedright|clearpage)\b\s*/g, '');
  s = s.replace(/\\\\(\[[^\]]*\])?/g, '<br>');
  s = s.replace(/\\([%&_#{}])/g, '$1');

  s = s.replace(/\u0002(\d+)\u0003/g, (_, i) => escapar(mates[+i]));
  return s.replace(/(<br>\s*){2,}/g, '<br>').replace(/\n{2,}/g, '\n').trim();
}

// Tablas tabular → <table>. Se hace sobre texto ya escapado: el separador de celdas es "&amp;".
function tablas(s) {
  let out = '';
  let pos = 0;
  const re = /\\begin\{tabular\*?\}/g;
  let m;
  while ((m = re.exec(s))) {
    if (m.index < pos) continue;
    const cierre = s.indexOf('\\end{tabular}', m.index);
    if (cierre < 0) break;
    let ini = m.index + m[0].length;
    const esp = grupo(s, s[ini] === '{' ? ini : s.indexOf('{', ini));
    if (!esp) break;
    const filas = s.slice(esp[1], cierre).replace(/\\hline|\\cline\{[^}]*\}/g, '')
      .split(/\\\\(?:\[[^\]]*\])?/).map((f) => f.trim()).filter(Boolean)
      .map((f) => '<tr>' + f.split('&amp;').map((c) => `<td>${c.trim()}</td>`).join('') + '</tr>');
    out += s.slice(pos, m.index) + `<table class="tex">${filas.join('')}</table>`;
    pos = cierre + '\\end{tabular}'.length;
    re.lastIndex = pos;
  }
  return out + s.slice(pos);
}

module.exports = { parsearExamen, texAHtml };
