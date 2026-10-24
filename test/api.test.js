const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'seg-'));
process.env.NODE_ENV = 'test';
const db = require('../lib/db');
const { crearApp } = require('../server');

const MUESTRA = path.join(__dirname, '..', 'muestra');
let base, server, app;
const cookies = {};

async function api(quien, metodo, url, cuerpo, extra = {}) {
  const headers = { ...(cookies[quien] ? { cookie: cookies[quien] } : {}), ...extra };
  let body;
  if (cuerpo instanceof FormData) body = cuerpo;
  else if (cuerpo !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(cuerpo); }
  const r = await fetch(base + url, { method: metodo, headers, body });
  const sc = r.headers.get('set-cookie');
  if (sc) cookies[quien] = sc.split(';')[0];
  let json = null;
  try { json = await r.json(); } catch {}
  return { status: r.status, json };
}
const fichero = (campo, nombre, ruta, extra = {}) => {
  const f = new FormData();
  f.append('archivo', new Blob([fs.readFileSync(ruta)]), nombre);
  for (const [k, v] of Object.entries(extra)) f.append(k, v);
  return f;
};

test.before(async () => {
  db.sembrarAdmin('profe@x.es');
  db.auth.prepare('INSERT INTO autorizados (email) VALUES (?)').run('otro@x.es');
  app = crearApp();
  app.locals.verificarGoogle = async (c) => { if (c === 'malo') throw new Error('x'); return { email: c, email_verified: true, name: c }; };
  await new Promise((ok) => { server = app.listen(0, '127.0.0.1', ok); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

test('acceso: sin sesión, no autorizado y autorizado', async () => {
  assert.equal((await api('a', 'GET', '/api/grupos')).status, 401);
  assert.equal((await api('a', 'POST', '/api/auth/google', { credential: 'malo' })).status, 401);
  assert.equal((await api('a', 'POST', '/api/auth/google', { credential: 'intruso@x.es' })).status, 403);
  assert.equal((await api('a', 'POST', '/api/auth/google', { credential: 'PROFE@x.es' })).status, 200);
  assert.equal((await api('b', 'POST', '/api/auth/google', { credential: 'otro@x.es' })).status, 200);
  assert.deepEqual((await api('a', 'GET', '/api/auth/me')).json.admin, true);
  assert.equal((await api('b', 'GET', '/api/admin/usuarios')).status, 403);
});

test('rechaza escrituras desde otro origen', async () => {
  const r = await api('a', 'POST', '/api/grupos', { nombre: 'X' }, { origin: 'https://malo.example' });
  assert.equal(r.status, 403);
});

let grupo, examen;
test('flujo completo con los archivos de muestra', async () => {
  grupo = (await api('a', 'POST', '/api/grupos', { nombre: '1ºESO A', curso: '2026-27' })).json.id;
  const imp = await api('a', 'POST', `/api/grupos/${grupo}/alumnos/importar`, fichero('archivo', 'l.xlsx', `${MUESTRA}/Iniciales Listado.xlsx`));
  assert.equal(imp.json.importados, 19);

  const ex = await api('a', 'POST', `/api/grupos/${grupo}/examenes`, fichero('archivo', 'Examen U1 Divisibilidad.tex', `${MUESTRA}/Examen U1 Divisibilidad teoria (1).tex`, { fecha: '2026-10-13' }));
  assert.equal(ex.json.apartados, 12);
  examen = ex.json.id;

  const n = await api('a', 'POST', `/api/examenes/${examen}/notas/importar`, fichero('archivo', 'i.xlsx', `${MUESTRA}/idoceo_2627_1ESO_U1Div_1_2010.xlsx`));
  assert.equal(n.json.casados, 19);
  assert.deepEqual(n.json.apartadosCreados, []);
  assert.deepEqual(n.json.sinCasar, []);

  const an = (await api('a', 'GET', `/api/examenes/${examen}/analisis`)).json;
  // Las notas finales deben coincidir con las que calcula Idoceo en la columna B del Excel.
  const esperadas = { DMS: 2.71, DDC: 6.67, GSC: 7.29, JPE: 9.58, LRV: 5.42, LLM: 7.08, LRE: 7.29, MCJ: 1.04, MSMM: 8.75, MDR: 8.54, PBAV: 2.5, PGA: 6.25, PCS: 5.62, PCM: 4.79, PVF: 6.25, RLP: 7.29, 'SÁR': 4.79, SMA: 8.54, VTM: 2.92 };
  for (const al of an.alumnos) assert.ok(Math.abs(al.nota - esperadas[al.iniciales]) < 0.06, `${al.iniciales}: ${al.nota} vs ${esperadas[al.iniciales]}`);
  assert.equal(an.alumnos.length, 19);
  const dms = an.alumnos.find((x) => x.iniciales === 'DMS');
  assert.ok(!/sobre 10/.test(dms.texto.resumen), 'el resumen no menciona la nota global');
  assert.ok(dms.texto.resumen.includes('CE 2.1'));
  assert.ok(dms.debiles.length > 0);
});

test('cada usuario ve solo su base', async () => {
  assert.deepEqual((await api('b', 'GET', '/api/grupos')).json, []);
  assert.equal((await api('b', 'GET', `/api/examenes/${examen}`)).status, 404);
  assert.equal((await api('b', 'GET', `/api/grupos/${grupo}/resumen`)).status, 404);
});

test('edición de notas y validaciones', async () => {
  const e = (await api('a', 'GET', `/api/examenes/${examen}`)).json;
  const it = e.items[0], al = e.alumnos[0];
  assert.equal((await api('a', 'PUT', `/api/examenes/${examen}/notas`, { item_id: it.id, alumno_id: al.id, puntos: 9 })).status, 400);
  assert.equal((await api('a', 'PUT', `/api/examenes/${examen}/notas`, { item_id: it.id, alumno_id: al.id, puntos: '3,5' })).status, 200);
  assert.equal((await api('a', 'GET', `/api/examenes/${examen}`)).json.notas[`${it.id}:${al.id}`], 3.5);
  assert.equal((await api('a', 'PUT', `/api/examenes/${examen}/notas`, { item_id: it.id, alumno_id: al.id, puntos: null })).status, 200);
});

test('resumen del grupo y revocación de acceso', async () => {
  const r = (await api('a', 'GET', `/api/grupos/${grupo}/resumen`)).json;
  assert.equal(r.alumnos.length, 19);
  assert.deepEqual(r.criterios.map((c) => c.codigo), ['CE 2.1', 'CE 3.1', 'CE 5.2']);
  assert.equal((await api('a', 'DELETE', '/api/admin/usuarios/otro%40x.es')).status, 200);
  assert.equal((await api('b', 'GET', '/api/grupos')).status, 401);
});

test('petición a Claude y análisis por apartado', async () => {
  const p = (await api('a', 'GET', `/api/examenes/${examen}/peticion-claude`)).json.texto;
  assert.ok(p.includes('"ref": "8a"') && p.includes('reparto_de_puntuaciones'));
  assert.ok(!p.includes('DMS'), 'no deben salir iniciales de alumnos');
  const bueno = '```json\n' + JSON.stringify({ items: [{ ref: '1', habilidad: 'Potencias', errores_tipicos: ['x'], consejo: 'c', ejemplos: [{ enunciado: 'e1', solucion: 's1' }], practica: [{ enunciado: '$2^3\\cdot 2^2$', solucion: '$2^5$' }, '$3^4\\cdot 3^2$ ($=3^6$)'] }, { ref: '99' }] }) + '\n```';
  const r = await api('a', 'PUT', `/api/examenes/${examen}/analisis-claude`, { texto: 'Aquí tienes:\n' + bueno });
  assert.equal(r.json.guardados, 1);
  assert.deepEqual(r.json.sinCasar, ['99']);
  assert.ok(r.json.faltan.includes('8a'));
  const ex = (await api('a', 'GET', `/api/examenes/${examen}`)).json;
  assert.equal(ex.items[0].analisis.habilidad, 'Potencias');
  assert.deepEqual(ex.items[0].analisis.ejemplos, [{ enunciado: 'e1', solucion: 's1' }]);
  assert.deepEqual(ex.items[0].analisis.practica[1], { enunciado: '$3^4\\cdot 3^2$', solucion: '$=3^6$' });
  assert.equal(ex.items[0].fuente, undefined);
  // barra única de LaTeX en JSON: rechazada con mensaje útil; las no escapables se arreglan
  const malo = '{"items":[{"ref":"1","habilidad":"$\\frac{1}{2}$"}]}';
  assert.equal((await api('a', 'PUT', `/api/examenes/${examen}/analisis-claude`, { texto: malo })).status, 400);
  const arreglable = '{"items":[{"ref":"2","habilidad":"$a\\cdot b$"}]}';
  assert.equal((await api('a', 'PUT', `/api/examenes/${examen}/analisis-claude`, { texto: arreglable })).json.guardados, 1);
  assert.equal((await api('a', 'PUT', `/api/examenes/${examen}/analisis-claude`, { texto: 'nada' })).status, 400);
});

test('rúbrica: importación, edición y petición a Claude', async () => {
  const r = await api('a', 'POST', `/api/examenes/${examen}/rubrica`, fichero('archivo', 'r.csv', `${MUESTRA}/Examen U1 Divisibilidad teoria RUBRICA.csv`));
  assert.equal(r.json.guardadas, 12);
  assert.deepEqual(r.json.sinCasar, []);
  const ex = (await api('a', 'GET', `/api/examenes/${examen}`)).json;
  assert.match(ex.items[0].rubrica[4], /15²/);
  const it = ex.items[1];
  assert.equal((await api('a', 'PUT', `/api/items/${it.id}`, { criterio: it.criterio, titulo: it.titulo, max: it.max, rubrica: { 4: 'Todo bien', 2: 'A medias' } })).status, 200);
  assert.equal((await api('a', 'GET', `/api/examenes/${examen}`)).json.items[1].rubrica[2], 'A medias');
  const p = (await api('a', 'GET', `/api/examenes/${examen}/peticion-claude`)).json.texto;
  assert.ok(p.includes('rubrica_del_profesor') && p.includes('Todo bien'));
  assert.equal((await api('a', 'POST', `/api/examenes/${examen}/rubrica`, fichero('archivo', 'x.csv', `${MUESTRA}/Iniciales Listado.xlsx`))).status, 400);
});

test('los nombres largos de alumnos no se cortan', async () => {
  const largo = 'Martina Manuela Morales Fernández-Pérez';
  const r = await api('a', 'POST', `/api/grupos/${grupo}/alumnos`, { iniciales: largo });
  assert.equal(r.status, 200);
  const g = (await api('a', 'GET', `/api/grupos/${grupo}`)).json;
  assert.equal(g.alumnos.find((x) => x.id === r.json.id).iniciales, largo);
});

test('análisis guardado con el formato antiguo se sirve normalizado', async () => {
  const e = (await api('a', 'GET', `/api/examenes/${examen}`)).json;
  const it = e.items[2];
  db.dbDeUsuario('profe@x.es').prepare('UPDATE items SET analisis = ? WHERE id = ?').run(JSON.stringify({ habilidad: 'x', practica: ['$2^3$ ($=8$)', 'solo enunciado'] }), it.id);
  const r = (await api('a', 'GET', `/api/examenes/${examen}`)).json.items[2].analisis;
  assert.deepEqual(r.practica, [{ enunciado: '$2^3$', solucion: '$=8$' }, { enunciado: 'solo enunciado', solucion: '' }]);
  assert.deepEqual(r.ejemplos, []);
  assert.deepEqual(r.errores_tipicos, []);
});
