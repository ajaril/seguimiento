'use strict';

const $ = (s, r = document) => r.querySelector(s);
const vista = $('#vista');
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);
const fmt = (n) => (n == null ? '–' : String(Math.round(n * 100) / 100).replace('.', ','));
const estadoDe = (p) => (p == null ? '' : p < 50 ? 'flojo' : p < 75 ? 'mejorable' : 'bien');
const ETIQUETA = { flojo: 'Reforzar', mejorable: 'Mejorable', bien: 'Bien' };
const chip = (p) => (p == null ? '' : `<span class="chip ${estadoDe(p)}">${ETIQUETA[estadoDe(p)]}</span>`);
const barra = (p, clase) => `<div class="barra ${estadoDe(p)}" title="${fmt(nota10(p))} / 10"><i style="width:${Math.min(100, Math.max(0, p || 0))}%"></i>${clase != null ? `<b style="left:${Math.min(100, clase)}%" title="Media de la clase: ${fmt(nota10(clase))} / 10"></b>` : ''}</div>`;
const calor = (p) => (p == null ? '' : `background:hsl(${Math.round(p * 1.2)} 70% 50% / .38)`);
const enlazar = (t) => esc(t).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);

function aviso(msg, error) {
  const d = document.createElement('div');
  d.className = 'aviso' + (error ? ' error' : '');
  d.textContent = msg;
  $('#avisos').append(d);
  setTimeout(() => d.remove(), error ? 6000 : 2500);
}

async function api(metodo, url, cuerpo) {
  const opts = { method: metodo, headers: {} };
  if (cuerpo instanceof FormData) opts.body = cuerpo;
  else if (cuerpo !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(cuerpo); }
  const r = await fetch('/api' + url, opts);
  let json = null;
  try { json = await r.json(); } catch { /* sin cuerpo */ }
  if (r.status === 401 && !url.startsWith('/auth/')) { mostrarLogin(); throw new Error('Sesión caducada'); }
  if (!r.ok) throw new Error((json && json.error) || `Error ${r.status}`);
  return json;
}
// Ejecuta una acción de botón mostrando el error en un aviso en vez de dejarlo sin tratar.
const hacer = (fn) => fn().catch((e) => { if (e.message !== 'Sesión caducada') aviso(e.message, true); });

function formArchivo(input, extra = {}) {
  const f = input.files[0];
  if (!f) throw new Error('Elige primero un archivo');
  const fd = new FormData();
  fd.append('archivo', f);
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  return fd;
}

function typeset(despues) {
  let intentos = 0;
  const ir = () => {
    if (window.MathJax && MathJax.typesetPromise) MathJax.typesetPromise([vista]).catch(() => {}).then(() => despues && despues());
    else if (intentos++ < 40) setTimeout(ir, 250);
    else if (despues) despues();
  };
  ir();
}

function migas(...trozos) {
  $('#migas').innerHTML = trozos.map(([txt, href]) => ' / ' + (href ? `<a href="${href}">${esc(txt)}</a>` : esc(txt))).join('');
}

// ── Sesión ─────────────────────────────────────────────────────────────────────
let yo = null;

function mostrarLogin(mensaje) {
  yo = null;
  $('#cabecera').hidden = true;
  vista.onclick = vista.onchange = vista.onsubmit = null;
  vista.innerHTML = `<div class="login"><div class="tarjeta">
    <h1>Seguimiento de alumnos</h1>
    <p class="suave">Acceso solo para cuentas autorizadas.</p>
    <div id="boton-google"></div>
    <p id="error-login" class="pequeno" style="color:var(--flojo)">${esc(mensaje || '')}</p></div></div>`;
  let intentos = 0;
  (async function pintar() {
    if (!(window.google && google.accounts && google.accounts.id)) {
      if (intentos++ < 40) return setTimeout(pintar, 250);
      $('#error-login').textContent = 'No he podido cargar el acceso de Google.';
      return;
    }
    const { googleClientId } = await api('GET', '/auth/config');
    google.accounts.id.initialize({
      client_id: googleClientId,
      callback: async ({ credential }) => {
        try {
          await api('POST', '/auth/google', { credential });
          await arrancar();
        } catch (e) { $('#error-login').textContent = e.message; }
      },
    });
    google.accounts.id.renderButton($('#boton-google'), { theme: 'outline', size: 'large', text: 'signin_with', locale: 'es' });
  })();
}

async function arrancar() {
  try { yo = await api('GET', '/auth/me'); } catch { return mostrarLogin(); }
  $('#cabecera').hidden = false;
  $('#usuario').textContent = yo.nombre || yo.email;
  $('#enlace-admin').hidden = !yo.admin;
  ruta();
}

$('#salir').onclick = async () => {
  await api('POST', '/auth/logout').catch(() => {});
  if (window.google && google.accounts) google.accounts.id.disableAutoSelect();
  mostrarLogin();
};

// ── Rutas ──────────────────────────────────────────────────────────────────────
const TITULO_WEB = document.title;
function ruta() {
  if (!yo) return;
  document.title = TITULO_WEB; // al imprimir, el navegador propone el título como nombre del PDF
  vista.onclick = vista.onchange = vista.onsubmit = null;
  window.scrollTo(0, 0);
  window.__listo = false;
  const p = (location.hash.slice(1) || '/').split('?')[0].split('/').filter(Boolean);
  const id = Number(p[1]);
  let v;
  if (!p.length) v = vistaGrupos();
  else if (p[0] === 'g' && id) v = vistaGrupo(id);
  else if (p[0] === 'e' && id && p[2] === 'informe' && Number(p[3])) v = vistaInformes(id, Number(p[3]));
  else if (p[0] === 'e' && id && p[2] === 'todos') v = vistaInformes(id);
  else if (p[0] === 'e' && id && p[2] === 'actividades') v = vistaInformes(id, null, true);
  else if (p[0] === 'e' && id && p[2] === 'profesor') v = vistaProfesor(id);
  else if (p[0] === 'e' && id) v = vistaExamen(id, p[2] || 'notas');
  else if (p[0] === 'admin' && yo.admin) v = vistaAdmin();
  else v = vistaGrupos();
  v.catch((e) => { if (e.message !== 'Sesión caducada') vista.innerHTML = `<div class="tarjeta"><p>${esc(e.message)}</p><a href="#/">Volver al inicio</a></div>`; });
}
window.addEventListener('hashchange', ruta);

// ── Grupos ─────────────────────────────────────────────────────────────────────
async function vistaGrupos() {
  migas();
  const grupos = await api('GET', '/grupos');
  vista.innerHTML = `
    <h1>Mis grupos</h1>
    <div class="rejilla" style="margin:1rem 0">
      ${grupos.map((g) => `<a class="tarjeta" href="#/g/${g.id}"><strong>${esc(g.nombre)}</strong>
        <div class="suave pequeno">${esc(g.curso)}</div>
        <div class="pequeno" style="margin-top:.5rem">${g.alumnos} alumnos · ${g.examenes} pruebas y exámenes</div></a>`).join('')}
      ${grupos.length ? '' : '<p class="vacio">Aún no tienes grupos. Crea el primero aquí abajo.</p>'}
    </div>
    <form class="tarjeta fila" id="nuevo-grupo">
      <label class="campo">Nombre del grupo<input name="nombre" required maxlength="80" placeholder="1º ESO A"></label>
      <label class="campo">Curso<input name="curso" maxlength="20" placeholder="2026-27"></label>
      <button style="align-self:flex-end">Crear grupo</button>
    </form>`;
  vista.onsubmit = (e) => {
    e.preventDefault();
    hacer(async () => {
      const f = Object.fromEntries(new FormData(e.target));
      const { id } = await api('POST', '/grupos', f);
      location.hash = `#/g/${id}`;
    });
  };
}

async function vistaGrupo(id) {
  const [g, resumen] = await Promise.all([api('GET', `/grupos/${id}`), api('GET', `/grupos/${id}/resumen`)]);
  migas([g.nombre]);
  vista.innerHTML = `
    <div class="fila entre">
      <div><h1>${esc(g.nombre)}</h1><div class="suave">${esc(g.curso)}</div></div>
      <div class="fila"><button class="sec" data-a="renombrar">Renombrar</button><button class="peligro" data-a="borrar-grupo">Eliminar grupo</button></div>
    </div>

    <section class="tarjeta" style="margin-top:1rem">
      <h2>Pruebas y Exámenes</h2>
      ${g.examenes.length ? `<table><tbody>${g.examenes.map((e) => `<tr><td><a href="#/e/${e.id}"><strong>${esc(e.nombre)}</strong></a></td><td class="suave">${esc(e.fecha)}</td></tr>`).join('')}</tbody></table>` : '<p class="vacio">Todavía no has subido ninguna prueba ni examen.</p>'}
      <form id="nuevo-examen" class="fila" style="margin-top:.8rem">
        <label class="campo">Nombre<input name="nombre" maxlength="120" placeholder="U1 Divisibilidad"></label>
        <label class="campo">Fecha<input name="fecha" type="date"></label>
        <label class="campo">Prueba o examen en LaTeX (.tex)<input type="file" name="tex" accept=".tex,text/x-tex,text/plain"></label>
        <button style="align-self:flex-end">Crear prueba o examen</button>
      </form>
    </section>

    <section class="tarjeta">
      <h2>Rendimiento acumulado por criterio</h2>
      ${tablaResumen(resumen)}
    </section>

    <section class="tarjeta">
      <div class="fila entre"><h2>Alumnos (${g.alumnos.length})</h2></div>
      <div class="fila" style="margin-bottom:.8rem">
        <input type="file" id="excel-lista" accept=".xlsx">
        <button class="sec" data-a="importar-lista">Cargar lista desde Excel</button>
        <span class="suave pequeno">Columna A: número · columna B: iniciales</span>
      </div>
      <div class="fila" style="margin-bottom:.8rem">
        <input type="file" id="excel-carpetas" accept=".xlsx">
        <button class="sec" data-a="importar-carpetas">Cargar carpetas personales</button>
        <span class="suave pequeno">Columna A: nombre del alumno · columna B: enlace a su carpeta</span>
      </div>
      <table id="tabla-alumnos"><thead><tr><th>Nº</th><th>Iniciales o nombre</th><th>Carpeta</th><th></th></tr></thead><tbody>
        ${g.alumnos.map((a) => `<tr data-id="${a.id}"><td><input data-c="num" type="number" min="1" value="${a.num}" style="width:4.5rem"></td>
          <td><input data-c="iniciales" maxlength="80" value="${esc(a.iniciales)}" style="width:min(24rem, 90%)"></td>
          <td>${a.carpeta ? `<a href="${esc(a.carpeta)}" target="_blank" rel="noopener noreferrer">Abrir</a>` : '<span class="suave">–</span>'}</td>
          <td><button class="peligro mini" data-a="borrar-alumno" title="Eliminar alumno y sus notas">✕</button></td></tr>`).join('')}
      </tbody></table>
      <form id="nuevo-alumno" class="fila" style="margin-top:.6rem">
        <input name="iniciales" placeholder="Iniciales o nombre" maxlength="80" required style="width:min(24rem, 90%)">
        <button class="sec">Añadir alumno</button>
      </form>
    </section>`;

  vista.onclick = (e) => {
    const b = e.target.closest('button[data-a]');
    if (!b) return;
    hacer(async () => {
      const a = b.dataset.a;
      if (a === 'renombrar') {
        const nombre = prompt('Nombre del grupo', g.nombre);
        if (!nombre) return;
        const curso = prompt('Curso', g.curso);
        await api('PUT', `/grupos/${id}`, { nombre, curso: curso ?? g.curso });
        ruta();
      } else if (a === 'borrar-grupo') {
        if (!confirm(`¿Eliminar «${g.nombre}» con todos sus alumnos, pruebas y exámenes y notas? No se puede deshacer.`)) return;
        await api('DELETE', `/grupos/${id}`);
        location.hash = '#/';
      } else if (a === 'importar-lista') {
        const r = await api('POST', `/grupos/${id}/alumnos/importar`, formArchivo($('#excel-lista')));
        aviso(`${r.importados} alumnos importados`);
        ruta();
      } else if (a === 'importar-carpetas') {
        const r = await api('POST', `/grupos/${id}/alumnos/carpetas`, formArchivo($('#excel-carpetas')));
        aviso(`${r.asignadas} carpetas asignadas` + (r.sinCasar.length ? `. Sin casar con ningún alumno: ${r.sinCasar.join(', ')}` : ''), !!r.sinCasar.length);
        ruta();
      } else if (a === 'borrar-alumno') {
        const tr = b.closest('tr');
        if (!confirm(`¿Eliminar a ${tr.querySelector('[data-c=iniciales]').value} y todas sus notas?`)) return;
        await api('DELETE', `/alumnos/${tr.dataset.id}`);
        ruta();
      }
    });
  };
  vista.onchange = (e) => {
    const inp = e.target.closest('#tabla-alumnos input');
    if (!inp) return;
    const tr = inp.closest('tr');
    hacer(async () => {
      try {
        await api('PUT', `/alumnos/${tr.dataset.id}`, { num: tr.querySelector('[data-c=num]').value, iniciales: tr.querySelector('[data-c=iniciales]').value });
        aviso('Guardado');
      } catch (err) { ruta(); throw err; }
    });
  };
  vista.onsubmit = (e) => {
    e.preventDefault();
    hacer(async () => {
      if (e.target.id === 'nuevo-alumno') {
        await api('POST', `/grupos/${id}/alumnos`, { iniciales: e.target.iniciales.value });
        ruta();
      } else if (e.target.id === 'nuevo-examen') {
        const f = e.target;
        const datos = { nombre: f.nombre.value, fecha: f.fecha.value };
        let fd;
        if (f.tex.files[0]) fd = formArchivo(f.tex, datos);
        else { fd = new FormData(); Object.entries(datos).forEach(([k, v]) => fd.append(k, v)); }
        const r = await api('POST', `/grupos/${id}/examenes`, fd);
        aviso(r.apartados ? `Examen creado con ${r.apartados} apartados` : 'Examen creado');
        location.hash = `#/e/${r.id}/estructura`;
      }
    });
  };
}

// Media de las notas de los criterios que lleva el alumno (los que no tienen dato no cuentan).
function mediaCriterios(r, a) {
  const ps = r.criterios.map((c) => (r.celdas[a.id] || {})[c.codigo]).filter((p) => p != null);
  if (!ps.length) return '<td class="sin">–</td>';
  const m = ps.reduce((x, y) => x + y, 0) / ps.length;
  return `<td style="${calor(m)}"><strong>${fmt(nota10(m))}</strong></td>`;
}

function tablaResumen(r) {
  if (!r.criterios.length) return '<p class="vacio">Aparecerá cuando haya pruebas o exámenes con criterios y notas.</p>';
  return `<div class="tabla-scroll"><table class="mapa"><thead><tr><th>Nº</th><th>Alumno</th>${r.criterios.map((c) => `<th class="num" title="${esc(c.descripcion)}">${esc(c.codigo)}</th>`).join('')}<th class="num" title="Media de los criterios que lleva el alumno">Media</th></tr></thead><tbody>
    ${r.alumnos.map((a) => `<tr><td>${a.num}</td><td style="text-align:left">${esc(a.iniciales)}</td>${r.criterios.map((c) => {
      const p = (r.celdas[a.id] || {})[c.codigo];
      return p == null ? '<td class="sin">–</td>' : `<td style="${calor(p)}">${fmt(nota10(p))}</td>`;
    }).join('')}${mediaCriterios(r, a)}</tr>`).join('')}</tbody></table></div>
    <p class="leyenda">Nota de 0 a 10 en cada criterio (dos decimales, sin redondear al alza), sumando todas las pruebas y exámenes del grupo. «Media»: media de los criterios que lleva cada alumno.</p>`;
}

// ── Examen ─────────────────────────────────────────────────────────────────────
async function vistaExamen(id, tab) {
  const ex = await api('GET', `/examenes/${id}`);
  migas([ex.grupo.nombre, `#/g/${ex.grupo.id}`], [ex.nombre]);
  const tabs = [['notas', 'Notas'], ['estructura', 'Apartados y criterios'], ['analisis', 'Análisis de la clase'], ['claude', 'Análisis por ejercicio (Claude)'], ['informes', 'Informes por alumno']];
  vista.innerHTML = `
    <div class="fila entre">
      <div><h1>${esc(ex.nombre)}</h1><div class="suave">${esc(ex.grupo.nombre)} · ${esc(ex.fecha)}</div></div>
      <div class="fila"><button class="sec" data-a="renombrar">Editar nombre/fecha</button><button class="peligro" data-a="borrar">Eliminar examen</button></div>
    </div>
    <nav class="pestanas">${tabs.map(([k, t]) => `<a href="#/e/${id}/${k}" class="${k === tab ? 'activa' : ''}">${t}</a>`).join('')}</nav>
    <div id="pestana"></div>`;
  const cont = $('#pestana');
  const comun = (e) => {
    const b = e.target.closest('button[data-a]');
    if (!b) return false;
    const a = b.dataset.a;
    if (a === 'renombrar') hacer(async () => {
      const nombre = prompt('Nombre del examen', ex.nombre);
      if (!nombre) return;
      const fecha = prompt('Fecha (AAAA-MM-DD)', ex.fecha);
      await api('PUT', `/examenes/${id}`, { nombre, fecha: fecha ?? ex.fecha });
      ruta();
    });
    else if (a === 'borrar') hacer(async () => {
      if (!confirm(`¿Eliminar «${ex.nombre}» y todas sus notas? No se puede deshacer.`)) return;
      await api('DELETE', `/examenes/${id}`);
      location.hash = `#/g/${ex.grupo.id}`;
    });
    else return false;
    return true;
  };
  if (tab === 'estructura') pestanaEstructura(ex, cont, comun);
  else if (tab === 'analisis') await pestanaAnalisis(ex, cont, comun);
  else if (tab === 'claude') pestanaClaude(ex, cont, comun);
  else if (tab === 'informes') await pestanaInformes(ex, cont, comun);
  else pestanaNotas(ex, cont, comun);
}

const NIVELES = ['En blanco / sin resolver', 'Casi mal', 'A medias', 'Casi bien', 'Perfecto'];
const nivelDe = (puntos, max) => Math.min(4, Math.max(0, Math.round((puntos / max) * 4)));
const refDe = (it) => `${it.ejercicio}${it.apartado}`;

function pestanaNotas(ex, cont, comun) {
  if (!ex.alumnos.length) { cont.innerHTML = `<div class="tarjeta"><p>Este grupo no tiene alumnos. <a href="#/g/${ex.grupo.id}">Carga la lista de clase primero.</a></p></div>`; vista.onclick = (e) => { comun(e); }; return; }
  cont.innerHTML = `
    <div class="tarjeta">
      <div class="fila">
        <input type="file" id="excel-notas" accept=".xlsx">
        <button class="sec" data-a="importar-notas">Importar notas de Idoceo</button>
        <span class="suave pequeno">Los alumnos se emparejan por sus iniciales.</span>
      </div>
      <div id="resultado-import" class="pequeno" style="margin-top:.6rem"></div>
    </div>
    ${ex.items.length ? `<div class="tarjeta tabla-scroll"><table class="nota"><thead><tr><th>Nº</th><th>Alumno</th>
      ${ex.items.map((i) => `<th class="num">${refDe(i)}<small>${esc(i.criterio)}</small><small>/${i.max}</small></th>`).join('')}<th class="num">Nota</th></tr></thead><tbody>
      ${ex.alumnos.map((a) => `<tr data-al="${a.id}"><td>${a.num}</td><td>${esc(a.iniciales)}</td>
        ${ex.items.map((i) => { const v = ex.notas[`${i.id}:${a.id}`]; return `<td class="num"><input inputmode="decimal" data-it="${i.id}" data-max="${i.max}" value="${v == null ? '' : v}"></td>`; }).join('')}
        <td class="num"><strong data-nota></strong></td></tr>`).join('')}</tbody></table></div>
      <p class="suave pequeno">Deja la casilla vacía si el apartado no se evaluó (no cuenta como fallo). Un 0 sí cuenta.</p>`
      : '<div class="tarjeta"><p class="vacio">Este examen aún no tiene apartados. Súbele el .tex en «Apartados y criterios» o importa las notas de Idoceo y se crearán solos.</p></div>'}`;

  const recalcular = (tr) => {
    let o = 0, p = 0;
    tr.querySelectorAll('input').forEach((i) => { if (i.value !== '') { const v = parseFloat(i.value.replace(',', '.')); if (!isNaN(v)) { o += v; p += +i.dataset.max; } } });
    tr.querySelector('[data-nota]').textContent = p ? fmt((o / p) * 10) : '';
  };
  cont.querySelectorAll('tbody tr').forEach(recalcular);

  vista.onclick = (e) => {
    if (comun(e)) return;
    const b = e.target.closest('button[data-a=importar-notas]');
    if (!b) return;
    hacer(async () => {
      const r = await api('POST', `/examenes/${ex.id}/notas/importar`, formArchivo($('#excel-notas')));
      const avisos = [];
      if (r.apartadosCreados.length) avisos.push(`Apartados creados: ${r.apartadosCreados.join(', ')}.`);
      if (r.sinCasar.length) avisos.push(`Sin alumno en el grupo (revisa las iniciales): ${r.sinCasar.join(', ')}.`);
      if (r.repetidas.length) avisos.push(`Iniciales repetidas en el grupo, no importadas: ${r.repetidas.join(', ')}.`);
      if (r.fueraDeRango.length) avisos.push(`Notas por encima del máximo del apartado, no importadas: ${r.fueraDeRango.join(', ')}.`);
      $('#resultado-import').innerHTML = `<strong>${r.casados} alumnos importados.</strong> ${esc(avisos.join(' '))}`;
      aviso(`${r.casados} alumnos importados`);
      if (!avisos.length) ruta();
    });
  };
  vista.onchange = (e) => {
    const inp = e.target.closest('input[data-it]');
    if (!inp) return;
    const tr = inp.closest('tr');
    hacer(async () => {
      try {
        await api('PUT', `/examenes/${ex.id}/notas`, { item_id: inp.dataset.it, alumno_id: tr.dataset.al, puntos: inp.value });
        inp.classList.remove('mal'); inp.classList.add('ok');
        setTimeout(() => inp.classList.remove('ok'), 700);
        recalcular(tr);
      } catch (err) { inp.classList.add('mal'); throw err; }
    });
  };
}

function pestanaEstructura(ex, cont, comun) {
  cont.innerHTML = `
    <div class="tarjeta">
      <h2>Prueba o examen en LaTeX</h2>
      <p class="suave pequeno">${ex.tieneTex ? `Subido: ${esc(ex.archivo || '')}. ` : 'Aún no has subido el .tex. '}Se reconocen los ejercicios escritos como <code>\\ejercicio{[CE 2.1] Enunciado…}</code>; cada etiqueta <code>[CE x.y]</code> del título es un apartado (a, b…) con su criterio. Si lo subes de nuevo se actualizan enunciados y criterios sin borrar notas.</p>
      <div class="fila"><input type="file" id="tex" accept=".tex,text/x-tex,text/plain"><button class="sec" data-a="subir-tex">${ex.tieneTex ? 'Reemplazar .tex' : 'Subir .tex'}</button></div>
    </div>
    <div class="tarjeta">
      <h2>Rúbrica</h2>
      <p class="suave pequeno">${ex.items.some((i) => i.rubrica) ? `${ex.items.filter((i) => i.rubrica).length} de ${ex.items.length} apartados con rúbrica. ` : ''}Sube un CSV o Excel con una fila por «Ejercicio N … Apartado x» y columnas «Nivel 4», «Nivel 3»… «Nivel 0». Se usa en los informes y en la petición a Claude. También puedes editarla apartado a apartado abajo.</p>
      <div class="fila"><input type="file" id="rubrica" accept=".csv,.xlsx,text/csv"><button class="sec" data-a="subir-rubrica">Importar rúbrica</button></div>
      <div id="resultado-rubrica" class="pequeno" style="margin-top:.5rem"></div>
    </div>
    <div class="tarjeta">
      <h2>Apartados</h2>
      ${ex.items.length ? `<div class="tabla-scroll"><table id="tabla-items"><thead><tr><th>Ej.</th><th>Qué pide</th><th>Criterio</th><th>Pts. máx.</th><th></th></tr></thead><tbody>
        ${ex.items.map((i) => `<tr data-id="${i.id}"><td><strong>${refDe(i)}</strong></td>
          <td>${esc(i.titulo)}${i.enunciado ? `<details><summary>Ver enunciado</summary><div class="enunciado">${i.enunciado}</div></details>` : ''}
            <details><summary>Rúbrica${i.rubrica ? '' : ' (vacía)'}</summary>${[4, 3, 2, 1, 0].map((n) => `<label class="campo" style="margin-top:.3rem">Nivel ${n} · ${NIVELES[n]}<textarea data-c="r${n}" maxlength="600" style="min-height:2.6rem">${esc(i.rubrica ? i.rubrica[n] : '')}</textarea></label>`).join('')}</details></td>
          <td><input data-c="criterio" value="${esc(i.criterio)}" maxlength="80" style="width:7rem">${i.criterio_alt && i.criterio_alt !== i.criterio ? `<div class="suave pequeno">Idoceo: ${esc(i.criterio_alt)}</div>` : ''}</td>
          <td><input data-c="max" type="number" min="0.5" step="0.5" value="${i.max}" style="width:4.5rem"></td>
          <td><button class="peligro mini" data-a="borrar-item" title="Quitar apartado y sus notas">✕</button></td></tr>`).join('')}</tbody></table></div>`
        : '<p class="vacio">Sin apartados todavía.</p>'}
      <form id="nuevo-item" class="fila" style="margin-top:.8rem">
        <label class="campo">Ejercicio<input name="ejercicio" type="number" min="1" required style="width:5rem"></label>
        <label class="campo">Apartado<input name="apartado" maxlength="3" placeholder="a" style="width:4rem"></label>
        <label class="campo">Criterio<input name="criterio" maxlength="40" style="width:7rem"></label>
        <label class="campo">Pts. máx.<input name="max" type="number" min="0.5" step="0.5" value="4" style="width:4.5rem"></label>
        <label class="campo" style="flex:1;min-width:12rem">Qué pide<input name="titulo"></label>
        <button class="sec" style="align-self:flex-end">Añadir apartado</button>
      </form>
    </div>
    <div class="tarjeta">
      <h2>Fichas de los criterios</h2>
      <p class="suave pequeno">La descripción aparece en los informes. En «material de repaso» escribe lo que quieras darle al alumno cuando este criterio esté flojo (fichas, vídeos, enlaces…). Se reutiliza en tus otros exámenes con el mismo código.</p>
      ${ex.criterios.length ? ex.criterios.map((c) => `<div class="item-repaso" data-cod="${esc(c.codigo)}" style="margin-bottom:1rem">
          <strong>${esc(c.codigo)}</strong>
          <label class="campo">Descripción<input data-c="descripcion" maxlength="400" value="${esc(c.descripcion)}"></label>
          <label class="campo" style="margin-top:.4rem">Material de repaso<textarea data-c="repaso" maxlength="4000">${esc(c.repaso)}</textarea></label></div>`).join('')
        : '<p class="vacio">Los criterios aparecen aquí cuando los apartados tienen código.</p>'}
    </div>`;

  const datosFila = (tr) => ({ criterio: tr.querySelector('[data-c=criterio]').value, max: tr.querySelector('[data-c=max]').value, titulo: ex.items.find((i) => i.id == tr.dataset.id).titulo, rubrica: Object.fromEntries([0, 1, 2, 3, 4].map((n) => [n, tr.querySelector(`[data-c=r${n}]`).value])) });
  vista.onclick = (e) => {
    if (comun(e)) return;
    const b = e.target.closest('button[data-a]');
    if (!b) return;
    hacer(async () => {
      if (b.dataset.a === 'subir-tex') {
        const r = await api('POST', `/examenes/${ex.id}/tex`, formArchivo($('#tex')));
        aviso(`${r.apartados} apartados leídos`);
        ruta();
      } else if (b.dataset.a === 'subir-rubrica') {
        const r = await api('POST', `/examenes/${ex.id}/rubrica`, formArchivo($('#rubrica')));
        aviso(`Rúbrica guardada en ${r.guardadas} apartados`);
        if (!r.sinCasar.length) return ruta();
        $('#resultado-rubrica').innerHTML = `<strong>${r.guardadas} apartados con rúbrica.</strong> No existen en el examen: ${esc(r.sinCasar.join(', '))}.`;
      } else if (b.dataset.a === 'borrar-item') {
        const tr = b.closest('tr');
        if (!confirm('¿Quitar este apartado y las notas que tenga?')) return;
        await api('DELETE', `/items/${tr.dataset.id}`);
        ruta();
      }
    });
  };
  vista.onchange = (e) => {
    const t = e.target;
    if (t.closest('#tabla-items')) {
      const tr = t.closest('tr');
      hacer(async () => {
        try { await api('PUT', `/items/${tr.dataset.id}`, datosFila(tr)); aviso('Guardado'); if (t.dataset.c === 'criterio') ruta(); }
        catch (err) { ruta(); throw err; }
      });
    } else if (t.closest('[data-cod]')) {
      const d = t.closest('[data-cod]');
      hacer(async () => {
        await api('PUT', `/examenes/${ex.id}/criterios`, { codigo: d.dataset.cod, descripcion: d.querySelector('[data-c=descripcion]').value, repaso: d.querySelector('[data-c=repaso]').value });
        aviso('Guardado');
      });
    }
  };
  vista.onsubmit = (e) => {
    e.preventDefault();
    hacer(async () => {
      await api('POST', `/examenes/${ex.id}/items`, Object.fromEntries(new FormData(e.target)));
      ruta();
    });
  };
  typeset();
}

function pestanaClaude(ex, cont, comun) {
  const hechos = ex.items.filter((i) => i.analisis).length;
  cont.innerHTML = `
    <div class="tarjeta">
      <h2>Análisis por ejercicio y apartado con Claude</h2>
      <p class="suave">Para cada apartado obtienes qué evalúa, los errores típicos, un consejo, un repaso breve y ejercicios de práctica. Todo eso aparece después en el informe de cada alumno según lo que le haya fallado.</p>
      <p class="suave pequeno">En la petición solo van los enunciados y los resultados de la clase por apartado: no salen iniciales ni notas individuales.</p>
      <ol>
        <li><button data-a="copiar">Copiar petición para Claude</button> y pégala en una conversación de Claude.</li>
        <li>Claude te devolverá un bloque JSON. Cópialo y pégalo aquí:</li>
      </ol>
      <textarea id="respuesta" placeholder="Pega aquí la respuesta de Claude (vale con el mensaje entero, se busca el JSON dentro)" style="min-height:9rem"></textarea>
      <div class="fila" style="margin-top:.6rem"><button data-a="guardar-analisis">Guardar análisis</button>${hechos ? '<button class="peligro sec" data-a="borrar-analisis">Borrar análisis guardado</button>' : ''}</div>
      <div id="resultado-claude" class="pequeno" style="margin-top:.6rem"></div>
      <details style="margin-top:.8rem"><summary>Ver el texto de la petición</summary><textarea id="peticion" readonly style="min-height:10rem;margin-top:.4rem"></textarea></details>
    </div>
    <div class="tarjeta"><h2>Estado (${hechos} de ${ex.items.length} apartados con análisis)</h2>
      <table><tbody>${ex.items.map((i) => `<tr><td><strong>${refDe(i)}</strong></td><td>${i.analisis ? esc(i.analisis.habilidad || i.titulo) : '<span class="suave">Sin analizar</span>'}</td>
        <td class="suave pequeno">${i.analisis ? esc(i.analisis.que_evalua) : ''}</td></tr>`).join('')}</tbody></table></div>`;

  typeset();
  vista.onclick = (e) => {
    if (comun(e)) return;
    const b = e.target.closest('button[data-a]');
    if (!b) return;
    hacer(async () => {
      if (b.dataset.a === 'copiar') {
        const { texto } = await api('GET', `/examenes/${ex.id}/peticion-claude`);
        $('#peticion').value = texto;
        try { await navigator.clipboard.writeText(texto); aviso('Petición copiada: pégala en Claude'); }
        catch { $('#peticion').closest('details').open = true; $('#peticion').select(); aviso('No he podido copiar solo: cópiala del cuadro de abajo', true); }
      } else if (b.dataset.a === 'guardar-analisis') {
        const r = await api('PUT', `/examenes/${ex.id}/analisis-claude`, { texto: $('#respuesta').value });
        const av = [];
        if (r.sinCasar.length) av.push(`Apartados que no existen en el examen: ${r.sinCasar.join(', ')}.`);
        if (r.faltan.length) av.push(`Sin análisis en la respuesta: ${r.faltan.join(', ')}.`);
        aviso(`${r.guardados} apartados analizados`);
        if (!av.length) return ruta();
        $('#resultado-claude').innerHTML = `<strong>${r.guardados} apartados guardados.</strong> ${esc(av.join(' '))}`;
      } else if (b.dataset.a === 'borrar-analisis') {
        if (!confirm('¿Borrar el análisis guardado de todos los apartados?')) return;
        await api('DELETE', `/examenes/${ex.id}/analisis-claude`);
        ruta();
      }
    });
  };
}

function detalleItem(it) {
  const a = it && it.analisis;
  if (!a) return '';
  return `<div class="suave pequeno">${a.habilidad ? `<strong>${esc(a.habilidad)}.</strong> ` : ''}${esc(a.que_evalua)}</div>
    ${a.errores_tipicos.length ? `<ul class="pequeno" style="margin:.2rem 0">${a.errores_tipicos.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}`;
}

async function pestanaAnalisis(ex, cont, comun) {
  const an = await api('GET', `/examenes/${ex.id}/analisis`);
  vista.onclick = (e) => { comun(e); };
  if (!an.clase.presentados) { cont.innerHTML = '<div class="tarjeta"><p class="vacio">Todavía no hay notas en este examen.</p></div>'; return; }
  const c = an.clase;
  const porId = new Map(ex.items.map((i) => [i.id, i]));
  cont.innerHTML = `
    <div class="estadisticas">
      <div><strong>${fmt(c.media)}</strong>nota media</div>
      <div><strong>${c.aprobados}/${c.presentados}</strong>aprobados</div>
    </div>
    <div class="tarjeta"><h2>Por criterio</h2><table><tbody>
      ${c.criterios.map((k) => `<tr><td><strong>${esc(k.codigo)}</strong><div class="suave pequeno">${esc(k.descripcion)}</div></td><td style="width:40%">${barra(k.pct)}</td><td class="num">${fmt(nota10(k.exacto))}</td><td>${chip(k.pct)}</td></tr>`).join('')}</tbody></table></div>
    <div class="tarjeta"><h2>Qué ejercicios se han atascado más</h2><table><thead><tr><th>Ej.</th><th>Qué pide</th><th>Criterio</th><th></th><th class="num">Nota (0-10)</th><th class="num">Con 0 pts.</th></tr></thead><tbody>
      ${[...c.items].sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101)).map((i) => `<tr><td><strong>${i.ref}</strong></td><td>${esc(i.titulo)}${detalleItem(porId.get(i.id))}</td><td>${esc(i.criterio)}</td><td style="width:20%">${barra(i.pct)}</td><td class="num">${fmt(nota10(i.exacto))}</td><td class="num">${i.ceros}/${i.n}</td></tr>`).join('')}</tbody></table></div>
    <div class="tarjeta tabla-scroll"><h2>Mapa de la clase</h2><table class="mapa"><thead><tr><th>Nº</th><th>Alumno</th>
      ${ex.items.map((i) => `<th class="num">${refDe(i)}</th>`).join('')}<th class="num">Nota</th></tr></thead><tbody>
      ${an.alumnos.map((a) => `<tr><td>${a.num}</td><td style="text-align:left">${esc(a.iniciales)}</td>${a.porItem.map((i) => `<td class="${i.puntos == null ? 'sin' : ''}" style="${calor(i.pct)}">${i.puntos == null ? '–' : fmt(i.puntos)}</td>`).join('')}<td><strong>${fmt(a.nota)}</strong></td></tr>`).join('')}</tbody></table>
      <p class="leyenda">Verde: apartado bien resuelto · rojo: pocos puntos · «–»: sin nota.</p></div>`;
  typeset();
}

// ── Informes ───────────────────────────────────────────────────────────────────
const opciones = { hoja: true, soluciones: false };

// ── Subida de informes a las carpetas de Drive de cada alumno ──────────────────
// Se pide a Google un permiso temporal (solo en este navegador) y el PDF se sube directamente desde aquí a la carpeta.
let tokenDrive = null; // { valor, caduca }
function permisoDrive() {
  if (tokenDrive && tokenDrive.caduca > Date.now() + 60000) return Promise.resolve(tokenDrive.valor);
  return new Promise(async (ok, mal) => {
    if (!(window.google && google.accounts && google.accounts.oauth2)) return mal(new Error('No he podido cargar el acceso de Google.'));
    const { googleClientId } = await api('GET', '/auth/config');
    google.accounts.oauth2.initTokenClient({
      client_id: googleClientId,
      scope: 'https://www.googleapis.com/auth/drive',
      callback: (r) => {
        if (r.error || !r.access_token) return mal(new Error('Google no ha dado permiso para escribir en Drive' + (r.error ? ` (${r.error})` : '') + '.'));
        tokenDrive = { valor: r.access_token, caduca: Date.now() + (Number(r.expires_in) || 3600) * 1000 };
        ok(tokenDrive.valor);
      },
      error_callback: (e) => mal(new Error('No se ha podido pedir el permiso a Google' + (e && e.type ? ` (${e.type})` : '') + '.')),
    }).requestAccessToken();
  });
}

const idCarpeta = (url) => { const m = String(url).match(/\/folders\/([\w-]+)/) || String(url).match(/[?&]id=([\w-]+)/); return m ? m[1] : null; };

async function driveFetch(token, url, opts) {
  const r = await fetch(url, { ...opts, headers: { ...(opts && opts.headers), Authorization: `Bearer ${token}` } });
  if (!r.ok) {
    let msg = ''; try { msg = (await r.json()).error.message; } catch { /* sin cuerpo */ }
    throw new Error(r.status === 404 ? 'Drive no encuentra la carpeta (¿tienes acceso con esta cuenta?)' : r.status === 403 ? 'Drive no te deja escribir en esa carpeta' : msg || `Drive ha respondido ${r.status}`);
  }
  return r.json();
}

// Sube el PDF a la carpeta; si ya hay uno con el mismo nombre lo reemplaza (no se duplican al volver a subir).
async function subirPdf(token, carpeta, nombre, blob) {
  const q = encodeURIComponent(`name = '${nombre.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' and '${carpeta}' in parents and trashed = false`);
  const ya = await driveFetch(token, `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`);
  if (ya.files.length) {
    return driveFetch(token, `https://www.googleapis.com/upload/drive/v3/files/${ya.files[0].id}?uploadType=media&supportsAllDrives=true`, { method: 'PATCH', headers: { 'Content-Type': 'application/pdf' }, body: blob });
  }
  const f = new FormData();
  f.append('metadata', new Blob([JSON.stringify({ name: nombre, parents: [carpeta], mimeType: 'application/pdf' })], { type: 'application/json' }));
  f.append('file', blob);
  return driveFetch(token, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true', { method: 'POST', body: f });
}

let pdfConHoja = true; // los PDF (ZIP y subida a Drive) llevan la hoja de práctica salvo que se desmarque

// Genera el PDF del alumno en el servidor y lo sube a su carpeta. Devuelve el nombre del archivo.
async function subirInforme(token, examenId, alumno) {
  const carpeta = idCarpeta(alumno.carpeta);
  if (!carpeta) throw new Error('el enlace de su carpeta no es de Drive');
  const r = await fetch(`/api/examenes/${examenId}/informes/${alumno.id}/pdf${pdfConHoja ? '' : '?hoja=0'}`);
  if (!r.ok) { let m = ''; try { m = (await r.json()).error; } catch { /* sin cuerpo */ } throw new Error(m || `Error ${r.status}`); }
  const nombre = decodeURIComponent(r.headers.get('X-Nombre-Archivo') || `${alumno.iniciales}.pdf`);
  await subirPdf(token, carpeta, nombre, await r.blob());
  return nombre;
}

async function pestanaInformes(ex, cont, comun) {
  const an = await api('GET', `/examenes/${ex.id}/analisis`);
  const carpeta = new Map(ex.alumnos.map((x) => [x.id, x.carpeta]));
  const conCarpeta = an.alumnos.filter((a) => a.nota != null && idCarpeta(carpeta.get(a.id)));
  vista.onclick = (e) => {
    if (comun(e)) return;
    const b = e.target.closest('button[data-subir]');
    if (!b) return;
    const todos = b.dataset.subir === 'todos';
    const lista = todos ? conCarpeta : conCarpeta.filter((a) => a.id === Number(b.dataset.subir));
    if (!lista.length) return aviso('Ese alumno no tiene carpeta de Drive asignada.', true);
    if (todos && !confirm(`¿Subir los informes (con su hoja de práctica) de ${lista.length} alumnos a sus carpetas? Si ya hay un archivo con el mismo nombre, se reemplaza.`)) return;
    hacer(async () => {
      const texto = b.textContent;
      b.disabled = true;
      const fallos = [];
      try {
        const token = await permisoDrive();
        for (let i = 0; i < lista.length; i++) {
          b.textContent = todos ? `Subiendo ${i + 1}/${lista.length}…` : 'Subiendo…';
          try { await subirInforme(token, ex.id, { id: lista[i].id, iniciales: lista[i].iniciales, carpeta: carpeta.get(lista[i].id) }); }
          catch (er) { fallos.push(`${lista[i].iniciales}: ${er.message}`); }
        }
      } finally { b.disabled = false; b.textContent = texto; }
      const ok = lista.length - fallos.length;
      aviso(`${ok} de ${lista.length} informes subidos a Drive.` + (fallos.length ? ` Fallos: ${fallos.join(' · ')}` : ''), !!fallos.length);
    });
  };
  vista.onchange = (e) => {
    if (e.target.id !== 'chk-pdf-hoja') return;
    pdfConHoja = e.target.checked;
    $('#enlace-zip').href = `/api/examenes/${ex.id}/informes.zip${pdfConHoja ? '' : '?hoja=0'}`;
  };
  cont.innerHTML = `
    <div class="tarjeta">
      <p>Cada informe incluye la nota, los puntos fuertes y flojos por criterio, el detalle ejercicio a ejercicio y qué repasar. Se imprime (o se guarda en PDF) desde el navegador.</p>
      <a class="boton" href="#/e/${ex.id}/todos">Ver / imprimir los de toda la clase</a>
      <a class="boton" href="#/e/${ex.id}/actividades">Descargar solo las actividades (PDF para imprimir)</a>
      <a class="boton" id="enlace-zip" href="/api/examenes/${ex.id}/informes.zip${pdfConHoja ? '' : '?hoja=0'}" download>Descargar ZIP con los informes en PDF</a>
      <a class="boton sec" href="#/e/${ex.id}/profesor">Hoja del profesor (con soluciones)</a>
      <label style="display:block;margin-top:.6rem"><input type="checkbox" id="chk-pdf-hoja" ${pdfConHoja ? 'checked' : ''}> Incluir la hoja de práctica al final de cada PDF (ZIP y subida a Drive)</label>
      <button data-subir="todos" style="margin-top:.4rem" ${conCarpeta.length ? '' : 'disabled'} title="${conCarpeta.length ? '' : 'Asigna primero las carpetas en la ficha del grupo'}">Subir todos a sus carpetas de Drive (${conCarpeta.length})</button>
    </div>
    <div class="tarjeta"><table><thead><tr><th>Nº</th><th>Alumno</th><th class="num">Nota</th><th>Resumen</th><th></th><th></th></tr></thead><tbody>
      ${an.alumnos.map((a) => `<tr><td>${a.num}</td><td>${esc(a.iniciales)}</td><td class="num"><strong>${fmt(a.nota)}</strong></td>
        <td class="suave pequeno">${a.texto.reforzar.length ? 'Reforzar: ' + esc(a.texto.reforzar.map((r) => r.codigo).join(', ')) : a.nota == null ? 'Sin notas' : 'Sin bloques flojos'}</td>
        <td><a href="#/e/${ex.id}/informe/${a.id}">Informe</a></td>
        <td>${a.nota == null ? '' : idCarpeta(carpeta.get(a.id)) ? `<button class="sec mini" data-subir="${a.id}">Subir a su carpeta</button>` : '<span class="suave pequeno">sin carpeta</span>'}</td></tr>`).join('')}</tbody></table></div>`;
}

async function vistaInformes(examenId, alumnoId, soloActividades) {
  const [ex, an] = await Promise.all([api('GET', `/examenes/${examenId}`), api('GET', `/examenes/${examenId}/analisis`)]);
  migas([ex.grupo.nombre, `#/g/${ex.grupo.id}`], [ex.nombre, `#/e/${examenId}/informes`], [soloActividades ? 'Actividades para imprimir' : alumnoId ? 'Informe' : 'Todos los informes']);
  // ?pdf=1: lo abre el servidor para generar el PDF individual (sin soluciones; con su hoja de práctica salvo que lleve &hoja=0).
  if (location.hash.includes('pdf=1')) { opciones.hoja = !location.hash.includes('hoja=0'); opciones.soluciones = false; }
  const unico = alumnoId && an.alumnos.find((a) => a.id === alumnoId);
  document.title = soloActividades ? `${ex.nombre} - actividades` : unico ? `Informe ${ex.nombre} - ${unico.iniciales}` : `${ex.nombre} - informes`;
  const lista = alumnoId ? an.alumnos.filter((a) => a.id === alumnoId) : an.alumnos.filter((a) => a.nota != null);
  const pintar = () => {
    vista.innerHTML = `<div class="barra-informe noprint">
        <a href="#/e/${examenId}/informes">← Volver</a>
        ${soloActividades ? '' : `<label><input type="checkbox" id="chk-hoja" ${opciones.hoja ? 'checked' : ''}> Incluir hoja de práctica</label>`}
        <label title="Por defecto la hoja del alumno va sin soluciones; las tienes todas en la hoja del profesor"><input type="checkbox" id="chk-sol" ${opciones.soluciones ? 'checked' : ''}> Soluciones en la hoja del alumno</label>
        <a href="#/e/${examenId}/profesor">Hoja del profesor</a>
        <span class="espacio"></span>
        <button onclick="window.print()">Imprimir / guardar PDF</button></div>
      ${lista.length ? lista.map((a) => informe(ex, an, a, soloActividades)).join('') : '<p class="vacio">No hay alumnos con notas.</p>'}`;
    typeset(() => { ajustar(); window.__listo = true; });
  };
  vista.onchange = (e) => {
    if (e.target.id === 'chk-hoja') opciones.hoja = e.target.checked;
    else if (e.target.id === 'chk-sol') opciones.soluciones = e.target.checked;
    else return;
    pintar();
  };
  pintar();
}

// ── Informe para el alumno: hoja 1 (notas), hoja 2 (qué ha fallado), hoja 3 (práctica) ──
const nota10 = (pct) => (pct == null ? null : Math.floor(pct * 10 + 1e-6) / 100); // sobre 10, con dos decimales truncados (como Idoceo)
const barra10 = (n, media) => barra(n == null ? null : n * 10, media == null ? null : media * 10);
const ETQ_AL = { flojo: 'A reforzar', mejorable: 'Casi lo tienes', bien: '¡Muy bien!' };
const chipAl = (p) => (p == null ? '' : `<span class="chip ${estadoDe(p)}">${ETQ_AL[estadoDe(p)]}</span>`);
const FLOJO_MAX = 50; // «2 o menos» sobre 4

function cabeceraAlumno(ex, a, titulo) {
  return `<div class="cabecera">
    <div><div class="suave pequeno">${esc(ex.nombre)} · ${esc(ex.grupo.nombre)}${ex.fecha ? ' · ' + esc(ex.fecha) : ''}</div>
      <h2 style="margin:.1rem 0 0">${esc(a.iniciales)}</h2></div>
    <div class="titulo-hoja">${esc(titulo)}</div></div>`;
}

function filaEjercicio(d, it) {
  const r = it.rubrica;
  const n = d.puntos == null ? null : nivelDe(d.puntos, d.max);
  const desc = r && n != null && d.puntos < d.max && r[n] ? `<div class="desc">${esc(r[n])}</div>` : '';
  return `<tr><td><strong>${d.ref}</strong></td><td>${esc(d.titulo)}${desc}</td><td class="num">${d.puntos == null ? '–' : fmt(d.puntos) + '/' + d.max}</td><td class="col-barra">${d.pct == null ? '' : barra(d.pct)}</td></tr>`;
}

function tarjetaFallo(d, it, nEjemplos) {
  const an = it.analisis;
  const n = nivelDe(d.puntos, d.max);
  const r = it.rubrica;
  const ej = (an && an.ejemplos.slice(0, nEjemplos)) || [];
  return `<div class="fallo nivel${n}">
    <div class="cab"><span class="ref">${d.ref}</span><strong>${esc((an && an.habilidad) || d.titulo)}</strong><span class="suave pequeno">${fmt(d.puntos)} / ${d.max} puntos · nivel ${n}</span></div>
    ${r ? `<table class="rub"><tbody>${[4, 3, 2, 1, 0].filter((k) => r[k]).map((k) => `<tr class="${k === n ? 'mi' : ''}"><th>Nivel ${k}<small>${NIVELES[k]}</small></th><td>${esc(r[k])}${k === n ? ' <span class="tu">← tu resultado</span>' : ''}</td></tr>`).join('')}</tbody></table>`
      : an && an.que_evalua ? `<div><b>Qué se evalúa:</b> ${esc(an.que_evalua)}</div>` : ''}
    ${an && an.errores_tipicos.length ? `<div><b>Errores frecuentes:</b> ${an.errores_tipicos.slice(0, 3).map(esc).join(' · ')}</div>` : ''}
    ${an && an.consejo ? `<div><b>Consejo:</b> ${esc(an.consejo)}</div>` : ''}
    ${ej.length ? `<div class="ejemplos"><b>Ejemplos resueltos</b>${ej.map((x, i) => `<div class="ej"><div><span class="suave">Ejemplo ${i + 1}.</span> ${esc(x.enunciado)}</div>${x.solucion ? `<div class="solucion"><span class="suave">Solución:</span> ${esc(x.solucion)}</div>` : ''}</div>`).join('')}</div>`
      : an && an.repaso ? `<div class="repaso">${esc(an.repaso)}</div>` : ''}
  </div>`;
}

const porRef = (x, y) => x.ref.localeCompare(y.ref, 'es', { numeric: true });

// Ejercicios de la hoja de un alumno: todos los apartados donde tiene 2 puntos o menos y hay material
// (los ejercicios de práctica de cada apartado son los mismos para toda la clase).
function seleccionHoja(ex, an, a) {
  const itemPorId = new Map(ex.items.map((i) => [i.id, i]));
  return a.porItem.filter((d) => d.pct != null && d.pct <= FLOJO_MAX && (() => {
    const it = itemPorId.get(d.id); return it && ((it.analisis && it.analisis.practica.length) || it.enunciado);
  })()).sort(porRef);
}

function hojaPractica(ex, a, flojos, itemPorId) {
  // Como mucho 2 caras (un folio): los cuadros se reparten enteros entre las dos y cada cara se achica si hace falta.
  // Dos ejercicios por apartado; solo con más de 8 apartados baja a uno para que todo quepa en las dos caras.
  const k = flojos.length <= 8 ? 2 : 1;
  const cuadro = (d) => {
    const it = itemPorId.get(d.id);
    const pr = (it.analisis && it.analisis.practica.slice(0, k)) || [];
    return `<div class="cuadro"><div class="cuadro-t"><span class="ref">${d.ref}</span> ${esc((it.analisis && it.analisis.habilidad) || d.titulo)}</div>
      ${pr.length ? `<ol>${pr.map((p) => `<li><div>${esc(p.enunciado)}</div><div class="resp"></div>${opciones.soluciones && p.solucion ? `<div class="sol">Solución: ${esc(p.solucion)}</div>` : ''}</li>`).join('')}</ol>`
        : `<div class="enunciado">${it.enunciado || esc(d.titulo)}</div><div class="resp"></div>`}</div>`;
  };
  const caras = flojos.length > 4 ? [flojos.slice(0, Math.ceil(flojos.length / 2)), flojos.slice(Math.ceil(flojos.length / 2))] : [flojos];
  return caras.map((c, i) => `<div class="pagina hoja"><div class="fit-in">
    ${cabeceraAlumno(ex, a, caras.length > 1 ? `Hoja de práctica (${i + 1}/2)` : 'Hoja de práctica')}
    ${i === 0 ? '<p class="intro">Haz estos ejercicios en esta hoja y deja escritas las operaciones.</p>' : ''}
    ${c.map(cuadro).join('')}</div></div>`).join('');
}

// Cada cara de la hoja de práctica se achica hasta que cabe en un folio.
const ALTO_CARA_MM = 266;
function ajustar() {
  const sonda = document.createElement('div');
  sonda.style.cssText = 'position:absolute;visibility:hidden;height:100mm;width:1px';
  document.body.appendChild(sonda);
  const pxMm = sonda.offsetHeight / 100;
  sonda.remove();
  if (!pxMm) return;
  const limite = ALTO_CARA_MM * pxMm;
  for (const cara of vista.querySelectorAll('.informe .pagina.hoja')) {
    const cont = cara.querySelector('.fit-in');
    if (!cont) continue;
    const ancho = (z) => { cont.style.zoom = z; cont.style.width = `${182 / z}mm`; };
    for (let z = 1; z >= 0.55; z -= 0.025) {
      ancho(z);
      if (cont.getBoundingClientRect().height <= limite) break;
    }
  }
}

function informe(ex, an, a, soloActividades) {
  const itemPorId = new Map(ex.items.map((i) => [i.id, i]));
  const flojos = a.porItem.filter((d) => d.pct != null && d.pct <= FLOJO_MAX).sort((x, y) => x.ref.localeCompare(y.ref, 'es', { numeric: true }));
  const repasar = a.porCriterio.filter((c) => c.estado !== 'bien' && c.repaso).sort((x, y) => x.pct - y.pct);
  const t = a.texto;
  const linea = (titulo, lst) => (lst.length ? `<div><b>${titulo}</b> ${lst.map((c) => esc(c.codigo + (c.descripcion ? ' (' + c.descripcion + ')' : ''))).join(' · ')}</div>` : '');

  const p1 = `<div class="pagina compacto">
    ${cabeceraAlumno(ex, a, 'Informe de seguimiento')}
    <div class="resumen-v">${linea('Puntos fuertes:', t.fuertes)}${linea('Por afianzar:', t.mejorar)}${linea('A reforzar:', t.reforzar)}</div>
    <h3>Tu nota en cada criterio</h3>
    <table class="criterios"><thead><tr><th>Criterio</th><th></th><th class="num">Tu nota</th><th class="num">Media de la clase</th><th></th></tr></thead><tbody>
      ${a.porCriterio.map((c) => `<tr><td><strong>${esc(c.codigo)}</strong><div class="desc">${esc(c.descripcion)}</div></td>
        <td class="col-barra">${barra10(nota10(c.exacto), nota10(c.claseExacto))}</td>
        <td class="num"><strong>${fmt(nota10(c.exacto))}</strong></td><td class="num">${fmt(nota10(c.claseExacto))}</td><td>${chipAl(c.pct)}</td></tr>`).join('')}</tbody></table>
    <div class="leyenda">Notas de 0 a 10. La marca <b></b> de la barra indica la media de la clase en ese criterio.</div>
    <h3>Ejercicio a ejercicio</h3>
    <table class="ejercicios"><tbody>${a.porItem.map((d) => filaEjercicio(d, itemPorId.get(d.id))).join('')}</tbody></table>
    ${flojos.length ? `<h3>Ejercicios para mejorar <span class="suave pequeno">(los que han salido con 2 puntos o menos)</span></h3>${flojos.map((d) => tarjetaFallo(d, itemPorId.get(d.id), 2)).join('')}` : '<p>No hay ningún ejercicio con 2 puntos o menos. Buen trabajo.</p>'}
    ${repasar.length ? `<h3>Material para repasar</h3>${repasar.map((c) => `<div class="fallo"><div class="cab"><span class="ref">${esc(c.codigo)}</span><strong>${esc(c.descripcion)}</strong></div><div class="repaso">${enlazar(c.repaso)}</div></div>`).join('')}` : ''}
  </div>`;

  const sel = opciones.hoja || soloActividades ? seleccionHoja(ex, an, a) : [];
  const p2 = sel.length ? hojaPractica(ex, a, sel, itemPorId) : '';
  return `<section class="informe">${soloActividades ? '' : p1}${p2}</section>`;
}

// Hoja del profesor: los mismos ejercicios que reciben los alumnos, con la solución y quién hace cada uno.
async function vistaProfesor(examenId) {
  const [ex, an] = await Promise.all([api('GET', `/examenes/${examenId}`), api('GET', `/examenes/${examenId}/analisis`)]);
  migas([ex.grupo.nombre, `#/g/${ex.grupo.id}`], [ex.nombre, `#/e/${examenId}/informes`], ['Hoja del profesor']);
  const itemPorId = new Map(ex.items.map((i) => [i.id, i]));
  const quien = new Map();
  for (const a of an.alumnos.filter((x) => x.nota != null)) {
    for (const d of seleccionHoja(ex, an, a)) {
      if (!quien.has(d.id)) quien.set(d.id, { d, alumnos: [] });
      quien.get(d.id).alumnos.push(a);
    }
  }
  const filas = [...quien.values()].sort((x, y) => porRef(x.d, y.d));
  vista.innerHTML = `<div class="barra-informe noprint"><a href="#/e/${examenId}/informes">← Volver</a><span class="espacio"></span>
      <button onclick="window.print()">Imprimir / guardar PDF</button></div>
    <section class="informe"><div class="pagina profesor">
      <div class="cabecera"><div><div class="suave pequeno">${esc(ex.nombre)} · ${esc(ex.grupo.nombre)}</div><h2 style="margin:.1rem 0 0">Hoja del profesor</h2></div>
        <div class="titulo-hoja">Ejercicios de práctica con soluciones</div></div>
      ${filas.length ? filas.map(({ d, alumnos }) => {
        const it = itemPorId.get(d.id);
        const pr = (it.analisis && it.analisis.practica) || [];
        return `<div class="cuadro"><div class="cuadro-t"><span class="ref">${d.ref}</span> ${esc((it.analisis && it.analisis.habilidad) || d.titulo)}
          <span class="suave pequeno">· lo hacen ${alumnos.length}: ${alumnos.map((x) => esc(x.num + ' ' + x.iniciales)).join(', ')}</span></div>
          ${pr.length ? `<ol>${pr.map((p) => `<li><div>${esc(p.enunciado)}</div><div class="sol-p">${p.solucion ? 'Solución: ' + esc(p.solucion) : '<span class="suave">Sin solución guardada: vuelve a pasar el análisis por Claude.</span>'}</div></li>`).join('')}</ol>`
            : `<div class="enunciado">${it.enunciado || esc(d.titulo)}</div>`}</div>`;
      }).join('') : '<p class="vacio">Ningún alumno tiene apartados con 2 puntos o menos que tengan ejercicios de práctica.</p>'}
    </div></section>`;
  typeset();
}

// ── Administración de accesos ──────────────────────────────────────────────────
async function vistaAdmin() {
  migas(['Accesos']);
  const us = await api('GET', '/admin/usuarios');
  vista.innerHTML = `<h1>Cuentas autorizadas</h1>
    <p class="suave">Solo estos correos de Google pueden entrar. Cada uno tiene su propia base de datos, que no ve nadie más.</p>
    <div class="tarjeta"><table><tbody>${us.map((u) => `<tr><td>${esc(u.email)}${u.admin ? ' <span class="chip bien">admin</span>' : ''}<div class="suave pequeno">${esc(u.nombre || 'Aún no ha entrado')}</div></td>
      <td>${u.email === yo.email ? '' : `<button class="peligro mini" data-email="${esc(u.email)}">Quitar acceso</button>`}</td></tr>`).join('')}</tbody></table>
      <form id="nuevo-usuario" class="fila" style="margin-top:.8rem"><input type="email" name="email" placeholder="correo@dominio.es" required style="min-width:16rem"><button>Autorizar</button></form></div>`;
  vista.onsubmit = (e) => { e.preventDefault(); hacer(async () => { await api('POST', '/admin/usuarios', { email: e.target.email.value }); ruta(); }); };
  vista.onclick = (e) => {
    const b = e.target.closest('button[data-email]');
    if (!b || !confirm(`¿Quitar el acceso a ${b.dataset.email}? Sus datos se conservan.`)) return;
    hacer(async () => { await api('DELETE', `/admin/usuarios/${encodeURIComponent(b.dataset.email)}`); ruta(); });
  };
}

arrancar();
