const express = require('express');
const multer = require('multer');
const { parsearExamen } = require('../lib/tex');
const { leerLista, leerIdoceo, claveIniciales } = require('../lib/excel');
const { analizar, codigosDe } = require('../lib/analisis');
const { leerRubrica } = require('../lib/rubrica');
const archiver = require('archiver');
const { imprimir } = require('../lib/pdf');
const { construirPeticion, leerRespuesta, normalizarAnalisis } = require('../lib/claude');

const router = express.Router();
const subir = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const archivo = subir.single('archivo');

const nombreArchivo = (f) => cadena(Buffer.from(f.originalname, 'latin1').toString('utf8'), 200);
const fallo = (status, message) => Object.assign(new Error(message), { status });
const entero = (v) => { const n = Number(v); return Number.isInteger(n) ? n : null; };
const cadena = (v, max = 300) => String(v == null ? '' : v).trim().slice(0, max);
// Los controladores async de Express 4 no propagan sus errores solos.
const a = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function decodificar(buf) {
  const utf8 = buf.toString('utf8');
  return utf8.includes('�') ? buf.toString('latin1') : utf8;
}

// Carga de la base del usuario; al ser una base por usuario, un id ajeno simplemente no existe.
const cargar = (tabla) => (req, res, next) => {
  const fila = req.db.prepare(`SELECT * FROM ${tabla} WHERE id = ?`).get(entero(req.params.id));
  if (!fila) return next(fallo(404, 'No encontrado'));
  req.fila = fila;
  next();
};

// ── Grupos ─────────────────────────────────────────────────────────────────────
router.get('/grupos', (req, res) => {
  res.json(req.db.prepare(`SELECT g.*,
      (SELECT COUNT(*) FROM alumnos WHERE grupo_id = g.id) AS alumnos,
      (SELECT COUNT(*) FROM examenes WHERE grupo_id = g.id) AS examenes
    FROM grupos g ORDER BY g.curso DESC, g.nombre`).all());
});

router.post('/grupos', (req, res) => {
  const nombre = cadena(req.body.nombre, 80);
  if (!nombre) throw fallo(400, 'Falta el nombre del grupo');
  const r = req.db.prepare('INSERT INTO grupos (nombre, curso) VALUES (?, ?)').run(nombre, cadena(req.body.curso, 20));
  res.json({ id: r.lastInsertRowid });
});

router.put('/grupos/:id', cargar('grupos'), (req, res) => {
  req.db.prepare('UPDATE grupos SET nombre = ?, curso = ? WHERE id = ?')
    .run(cadena(req.body.nombre, 80) || req.fila.nombre, cadena(req.body.curso, 20), req.fila.id);
  res.json({ ok: true });
});

router.delete('/grupos/:id', cargar('grupos'), (req, res) => {
  req.db.prepare('DELETE FROM grupos WHERE id = ?').run(req.fila.id);
  res.json({ ok: true });
});

router.get('/grupos/:id', cargar('grupos'), (req, res) => {
  const g = req.fila;
  res.json({
    ...g,
    alumnos: req.db.prepare('SELECT id, num, iniciales FROM alumnos WHERE grupo_id = ? ORDER BY num').all(g.id),
    examenes: req.db.prepare('SELECT id, nombre, fecha FROM examenes WHERE grupo_id = ? ORDER BY fecha, id').all(g.id),
  });
});

// ── Alumnos ────────────────────────────────────────────────────────────────────
router.post('/grupos/:id/alumnos/importar', cargar('grupos'), archivo, a(async (req, res) => {
  if (!req.file) throw fallo(400, 'Falta el archivo Excel');
  let lista;
  try { lista = await leerLista(req.file.buffer); } catch { throw fallo(400, 'No he podido leer ese Excel'); }
  if (!lista.length) throw fallo(400, 'No encuentro alumnos: espero el número en la columna A y las iniciales en la B.');
  const ins = req.db.prepare(`INSERT INTO alumnos (grupo_id, num, iniciales) VALUES (?, ?, ?)
                              ON CONFLICT(grupo_id, num) DO UPDATE SET iniciales = excluded.iniciales`);
  req.db.transaction(() => lista.forEach((x) => ins.run(req.fila.id, x.num, cadena(x.iniciales, 80))))();
  res.json({ importados: lista.length });
}));

router.post('/grupos/:id/alumnos', cargar('grupos'), (req, res) => {
  const iniciales = cadena(req.body.iniciales, 80);
  if (!iniciales) throw fallo(400, 'Faltan las iniciales');
  const num = entero(req.body.num) ?? (req.db.prepare('SELECT COALESCE(MAX(num), 0) + 1 AS n FROM alumnos WHERE grupo_id = ?').get(req.fila.id).n);
  try {
    const r = req.db.prepare('INSERT INTO alumnos (grupo_id, num, iniciales) VALUES (?, ?, ?)').run(req.fila.id, num, iniciales);
    res.json({ id: r.lastInsertRowid });
  } catch { throw fallo(409, `Ya existe el alumno nº ${num}`); }
});

router.put('/alumnos/:id', cargar('alumnos'), (req, res) => {
  const iniciales = cadena(req.body.iniciales, 80);
  const num = entero(req.body.num) ?? req.fila.num;
  if (!iniciales) throw fallo(400, 'Faltan las iniciales');
  try { req.db.prepare('UPDATE alumnos SET num = ?, iniciales = ? WHERE id = ?').run(num, iniciales, req.fila.id); } catch { throw fallo(409, `Ya existe el alumno nº ${num}`); }
  res.json({ ok: true });
});

router.delete('/alumnos/:id', cargar('alumnos'), (req, res) => {
  req.db.prepare('DELETE FROM alumnos WHERE id = ?').run(req.fila.id);
  res.json({ ok: true });
});

// ── Exámenes ───────────────────────────────────────────────────────────────────
// Crea o actualiza los apartados a partir del .tex sin perder notas de los que ya existían.
function aplicarTex(db, examenId, tex) {
  const nuevos = parsearExamen(tex);
  const buscar = db.prepare('SELECT id FROM items WHERE examen_id = ? AND ejercicio = ? AND apartado = ?');
  const ins = db.prepare(`INSERT INTO items (examen_id, ejercicio, apartado, titulo, enunciado, fuente, criterio, max)
                          VALUES (@examen_id, @ejercicio, @apartado, @titulo, @enunciado, @fuente, @criterio, @max)`);
  const act = db.prepare('UPDATE items SET titulo = @titulo, enunciado = @enunciado, fuente = @fuente, criterio = @criterio WHERE id = @id');
  const baja = db.prepare(`DELETE FROM items WHERE examen_id = ? AND id NOT IN (SELECT item_id FROM notas WHERE puntos IS NOT NULL)
                           AND ejercicio = ? AND apartado = ?`);
  db.transaction(() => {
    const vivos = new Set();
    for (const it of nuevos) {
      vivos.add(`${it.ejercicio}|${it.apartado}`);
      const ya = buscar.get(examenId, it.ejercicio, it.apartado);
      if (ya) act.run({ ...it, id: ya.id });
      else ins.run({ ...it, examen_id: examenId });
    }
    for (const v of db.prepare('SELECT ejercicio, apartado FROM items WHERE examen_id = ?').all(examenId)) {
      if (!vivos.has(`${v.ejercicio}|${v.apartado}`)) baja.run(examenId, v.ejercicio, v.apartado);
    }
    asegurarCriterios(db, examenId);
  })();
  return nuevos.length;
}

// Cada código de criterio usado tiene su ficha. La descripción y el material se heredan del último examen con el mismo código.
function asegurarCriterios(db, examenId) {
  const codigos = db.prepare("SELECT DISTINCT criterio FROM items WHERE examen_id = ? AND criterio != ''").all(examenId);
  const previo = db.prepare(`SELECT descripcion, repaso FROM criterios WHERE codigo = ? AND examen_id != ?
                             AND (descripcion != '' OR repaso != '') ORDER BY examen_id DESC LIMIT 1`);
  const ins = db.prepare('INSERT OR IGNORE INTO criterios (examen_id, codigo, descripcion, repaso) VALUES (?, ?, ?, ?)');
  // Una ficha por cada código suelto; se retiran las fichas vacías que se crearon con varios códigos juntos.
  db.prepare("DELETE FROM criterios WHERE examen_id = ? AND (codigo LIKE '%,%' OR codigo LIKE '%;%') AND descripcion = '' AND repaso = ''").run(examenId);
  for (const cod of new Set(codigos.flatMap(({ criterio }) => codigosDe(criterio)))) {
    const p = previo.get(cod, examenId) || { descripcion: '', repaso: '' };
    ins.run(examenId, cod, p.descripcion, p.repaso);
  }
}

router.post('/grupos/:id/examenes', cargar('grupos'), archivo, a(async (req, res) => {
  const tex = req.file ? decodificar(req.file.buffer) : null;
  const nombre = cadena(req.body.nombre, 120) || (req.file ? nombreArchivo(req.file).replace(/\.tex$/i, '') : '');
  if (!nombre) throw fallo(400, 'Falta el nombre del examen');
  const ex = req.db.transaction(() => {
    const r = req.db.prepare('INSERT INTO examenes (grupo_id, nombre, fecha, tex, archivo) VALUES (?, ?, ?, ?, ?)')
      .run(req.fila.id, nombre, cadena(req.body.fecha, 10), tex, req.file ? nombreArchivo(req.file) : null);
    const id = Number(r.lastInsertRowid);
    return { id, apartados: tex ? aplicarTex(req.db, id, tex) : 0 };
  })();
  res.json(ex);
}));

router.post('/examenes/:id/tex', cargar('examenes'), archivo, (req, res) => {
  if (!req.file) throw fallo(400, 'Falta el archivo .tex');
  const tex = decodificar(req.file.buffer);
  req.db.prepare('UPDATE examenes SET tex = ?, archivo = ? WHERE id = ?')
    .run(tex, nombreArchivo(req.file), req.fila.id);
  res.json({ apartados: aplicarTex(req.db, req.fila.id, tex) });
});

router.put('/examenes/:id', cargar('examenes'), (req, res) => {
  req.db.prepare('UPDATE examenes SET nombre = ?, fecha = ? WHERE id = ?')
    .run(cadena(req.body.nombre, 120) || req.fila.nombre, cadena(req.body.fecha, 10), req.fila.id);
  res.json({ ok: true });
});

router.delete('/examenes/:id', cargar('examenes'), (req, res) => {
  req.db.prepare('DELETE FROM examenes WHERE id = ?').run(req.fila.id);
  res.json({ ok: true });
});

function datosExamen(db, ex) {
  const items = db.prepare('SELECT * FROM items WHERE examen_id = ? ORDER BY ejercicio, apartado').all(ex.id);
  const criterios = db.prepare('SELECT codigo, descripcion, repaso FROM criterios WHERE examen_id = ? ORDER BY codigo').all(ex.id);
  const alumnos = db.prepare('SELECT id, num, iniciales FROM alumnos WHERE grupo_id = ? ORDER BY num').all(ex.grupo_id);
  const notas = new Map(db.prepare(`SELECT n.item_id, n.alumno_id, n.puntos FROM notas n JOIN items i ON i.id = n.item_id
                                    WHERE i.examen_id = ? AND n.puntos IS NOT NULL`).all(ex.id).map((n) => [`${n.item_id}:${n.alumno_id}`, n.puntos]));
  return { items, criterios, alumnos, notas };
}

router.get('/examenes/:id', cargar('examenes'), (req, res) => {
  const { tex, ...ex } = req.fila;
  const d = datosExamen(req.db, req.fila);
  const grupo = req.db.prepare('SELECT id, nombre, curso FROM grupos WHERE id = ?').get(ex.grupo_id);
  const items = d.items.map(({ fuente, analisis, rubrica, ...i }) => ({ ...i, analisis: analisis ? normalizarAnalisis(JSON.parse(analisis)) : null, rubrica: rubrica ? JSON.parse(rubrica) : null }));
  res.json({ ...ex, tieneTex: !!tex, grupo, items, criterios: d.criterios, alumnos: d.alumnos, notas: Object.fromEntries(d.notas) });
});

router.get('/examenes/:id/analisis', cargar('examenes'), (req, res) => {
  const d = datosExamen(req.db, req.fila);
  res.json({ examen: { id: req.fila.id, nombre: req.fila.nombre, fecha: req.fila.fecha }, ...analizar(d) });
});

// ZIP con el informe de cada alumno en PDF (sin la hoja de práctica): «<examen> - <alumno>.pdf».
const limpio = (t) => String(t).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim();
router.get('/examenes/:id/informes.zip', cargar('examenes'), a(async (req, res) => {
  const alumnos = analizar(datosExamen(req.db, req.fila)).alumnos.filter((x) => x.nota != null);
  if (!alumnos.length) throw fallo(400, 'No hay alumnos con notas.');
  const usados = new Set();
  const nombres = alumnos.map((x) => {
    let n = `${limpio(req.fila.nombre)} - ${limpio(x.iniciales)}`;
    if (usados.has(n)) n += ` (${x.num})`;
    usados.add(n);
    return n + '.pdf';
  });
  const base = `http://127.0.0.1:${process.env.PORT || 3040}`;
  const urls = alumnos.map((x) => `/#/e/${req.fila.id}/informe/${x.id}?pdf=1`);
  let cerrado = false;
  res.on('close', () => { cerrado = true; });
  res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(limpio(req.fila.nombre) + ' - informes.zip')}` });
  const zip = archiver('zip', { zlib: { level: 1 } });
  zip.on('error', (e) => { console.error(e); res.destroy(); });
  zip.pipe(res);
  try {
    await imprimir(urls, req.cookies.seg_sid, base, (i, buf) => { zip.append(buf, { name: nombres[i] }); }, () => cerrado);
    await zip.finalize();
  } catch (e) {
    console.error('informes.zip:', e.message);
    if (!res.headersSent) throw fallo(500, e.message);
    res.destroy();
  }
}));

// Rúbrica (CSV o Excel con columnas «Nivel 4 … Nivel 0» y una fila por «Ejercicio N … Apartado x»).
router.post('/examenes/:id/rubrica', cargar('examenes'), archivo, a(async (req, res) => {
  if (!req.file) throw fallo(400, 'Falta el archivo de la rúbrica');
  let filas;
  try { filas = await leerRubrica(req.file.buffer, req.file.originalname); } catch (e) { throw fallo(400, e.message); }
  const buscar = req.db.prepare('SELECT id FROM items WHERE examen_id = ? AND ejercicio = ? AND apartado = ?');
  const act = req.db.prepare('UPDATE items SET rubrica = ? WHERE id = ?');
  const sinCasar = [];
  let guardadas = 0;
  req.db.transaction(() => {
    for (const f of filas) {
      const it = buscar.get(req.fila.id, f.ejercicio, f.apartado);
      if (!it) { sinCasar.push(`${f.ejercicio}${f.apartado}`); continue; }
      act.run(Object.keys(f.niveles).length ? JSON.stringify(f.niveles) : null, it.id);
      guardadas++;
    }
  })();
  res.json({ guardadas, sinCasar });
}));

// ── Análisis por apartado con Claude (se copia una petición y se pega la respuesta) ──
router.get('/examenes/:id/peticion-claude', cargar('examenes'), (req, res) => {
  const d = datosExamen(req.db, req.fila);
  if (!d.items.length) throw fallo(400, 'El examen no tiene apartados todavía.');
  const grupo = req.db.prepare('SELECT nombre FROM grupos WHERE id = ?').get(req.fila.grupo_id);
  const { clase } = analizar(d);
  res.json({ texto: construirPeticion(req.fila, grupo, d.items, clase.items) });
});

router.put('/examenes/:id/analisis-claude', cargar('examenes'), (req, res) => {
  let r;
  try { r = leerRespuesta(req.body.texto); } catch (e) { throw fallo(400, e.message); }
  const items = req.db.prepare('SELECT id, ejercicio, apartado FROM items WHERE examen_id = ?').all(req.fila.id);
  const porRef = new Map(items.map((i) => [`${i.ejercicio}${i.apartado}`.toLowerCase(), i.id]));
  const act = req.db.prepare('UPDATE items SET analisis = ? WHERE id = ?');
  const sinCasar = [];
  let guardados = 0;
  req.db.transaction(() => {
    for (const it of r.items) {
      const id = porRef.get(it.ref);
      if (!id) { sinCasar.push(it.ref); continue; }
      act.run(JSON.stringify(it.analisis), id);
      guardados++;
    }
    // Las fichas de criterio solo se rellenan si estaban vacías: nunca se pisa lo que escribió el profesor.
    const crit = req.db.prepare(`UPDATE criterios SET descripcion = CASE WHEN descripcion = '' THEN ? ELSE descripcion END,
                                 repaso = CASE WHEN repaso = '' THEN ? ELSE repaso END WHERE examen_id = ? AND codigo = ?`);
    for (const c of r.criterios) crit.run(c.descripcion, c.repaso, req.fila.id, c.codigo);
  })();
  const faltan = [...porRef.keys()].filter((k) => !r.items.some((i) => i.ref === k));
  res.json({ guardados, sinCasar, faltan });
});

router.delete('/examenes/:id/analisis-claude', cargar('examenes'), (req, res) => {
  req.db.prepare('UPDATE items SET analisis = NULL WHERE examen_id = ?').run(req.fila.id);
  res.json({ ok: true });
});

// ── Apartados y criterios ──────────────────────────────────────────────────────
router.post('/examenes/:id/items', cargar('examenes'), (req, res) => {
  const ejercicio = entero(req.body.ejercicio);
  if (!ejercicio || ejercicio < 1) throw fallo(400, 'Número de ejercicio no válido');
  try {
    const r = req.db.prepare('INSERT INTO items (examen_id, ejercicio, apartado, titulo, criterio, max) VALUES (?, ?, ?, ?, ?, ?)')
      .run(req.fila.id, ejercicio, cadena(req.body.apartado, 3).toLowerCase(), cadena(req.body.titulo), cadena(req.body.criterio, 80), Number(req.body.max) > 0 ? Number(req.body.max) : 4);
    asegurarCriterios(req.db, req.fila.id);
    res.json({ id: r.lastInsertRowid });
  } catch { throw fallo(409, 'Ese ejercicio/apartado ya existe'); }
});

router.put('/items/:id', cargar('items'), (req, res) => {
  const max = Number(req.body.max);
  req.db.prepare('UPDATE items SET criterio = ?, titulo = ?, max = ? WHERE id = ?')
    .run(cadena(req.body.criterio, 80), cadena(req.body.titulo), max > 0 ? max : req.fila.max, req.fila.id);
  if (req.body.rubrica && typeof req.body.rubrica === 'object') {
    const niveles = {};
    for (let n = 0; n <= 4; n++) { const t = cadena(req.body.rubrica[n], 600); if (t) niveles[n] = t; }
    req.db.prepare('UPDATE items SET rubrica = ? WHERE id = ?').run(Object.keys(niveles).length ? JSON.stringify(niveles) : null, req.fila.id);
  }
  asegurarCriterios(req.db, req.fila.examen_id);
  res.json({ ok: true });
});

router.delete('/items/:id', cargar('items'), (req, res) => {
  req.db.prepare('DELETE FROM items WHERE id = ?').run(req.fila.id);
  res.json({ ok: true });
});

router.put('/examenes/:id/criterios', cargar('examenes'), (req, res) => {
  const codigo = cadena(req.body.codigo, 40);
  if (!codigo) throw fallo(400, 'Falta el código del criterio');
  req.db.prepare(`INSERT INTO criterios (examen_id, codigo, descripcion, repaso) VALUES (?, ?, ?, ?)
                  ON CONFLICT(examen_id, codigo) DO UPDATE SET descripcion = excluded.descripcion, repaso = excluded.repaso`)
    .run(req.fila.id, codigo, cadena(req.body.descripcion, 400), cadena(req.body.repaso, 4000));
  res.json({ ok: true });
});

// ── Notas ──────────────────────────────────────────────────────────────────────
router.put('/examenes/:id/notas', cargar('examenes'), (req, res) => {
  const item = req.db.prepare('SELECT id, max FROM items WHERE id = ? AND examen_id = ?').get(entero(req.body.item_id), req.fila.id);
  const alumno = req.db.prepare('SELECT id FROM alumnos WHERE id = ? AND grupo_id = ?').get(entero(req.body.alumno_id), req.fila.grupo_id);
  if (!item || !alumno) throw fallo(404, 'Apartado o alumno no encontrado');
  const bruto = req.body.puntos;
  const puntos = bruto === null || bruto === '' || bruto === undefined ? null : Number(String(bruto).replace(',', '.'));
  if (puntos !== null && (!Number.isFinite(puntos) || puntos < 0 || puntos > item.max)) throw fallo(400, `La nota debe estar entre 0 y ${item.max}`);
  req.db.prepare(`INSERT INTO notas (item_id, alumno_id, puntos) VALUES (?, ?, ?)
                  ON CONFLICT(item_id, alumno_id) DO UPDATE SET puntos = excluded.puntos`).run(item.id, alumno.id, puntos);
  res.json({ ok: true });
});

// Exportación de Idoceo: una columna por apartado, una fila por alumno (casado por iniciales).
router.post('/examenes/:id/notas/importar', cargar('examenes'), archivo, a(async (req, res) => {
  if (!req.file) throw fallo(400, 'Falta el Excel de Idoceo');
  let xl;
  try { xl = await leerIdoceo(req.file.buffer); } catch (e) { throw fallo(400, e.message || 'No he podido leer ese Excel'); }
  const db = req.db;
  const ex = req.fila;

  const resultado = db.transaction(() => {
    const items = db.prepare('SELECT * FROM items WHERE examen_id = ?').all(ex.id);
    const porClave = new Map(items.map((i) => [`${i.ejercicio}|${i.apartado}`, i]));
    const creados = [];
    const altera = db.prepare('UPDATE items SET criterio_alt = ? WHERE id = ?');

    const cols = xl.columnas.map((c) => {
      let it = porClave.get(`${c.ejercicio}|${c.apartado}`);
      if (!it) {
        const maxVisto = Math.max(4, ...xl.filas.map((f) => f.puntos[xl.columnas.indexOf(c)] ?? 0));
        const r = db.prepare('INSERT INTO items (examen_id, ejercicio, apartado, criterio, criterio_alt, max) VALUES (?, ?, ?, ?, ?, ?)')
          .run(ex.id, c.ejercicio, c.apartado, c.criterio, c.criterio, maxVisto);
        it = { id: Number(r.lastInsertRowid), max: maxVisto };
        porClave.set(`${c.ejercicio}|${c.apartado}`, it);
        creados.push(`${c.ejercicio}${c.apartado}`);
      } else {
        altera.run(c.criterio, it.id);
      }
      return it;
    });
    asegurarCriterios(db, ex.id);

    const alumnos = db.prepare('SELECT id, iniciales FROM alumnos WHERE grupo_id = ?').all(ex.grupo_id);
    const porIni = new Map();
    for (const al of alumnos) {
      const k = claveIniciales(al.iniciales);
      porIni.set(k, porIni.has(k) ? null : al.id); // null = iniciales repetidas en el grupo
    }
    const put = db.prepare(`INSERT INTO notas (item_id, alumno_id, puntos) VALUES (?, ?, ?)
                            ON CONFLICT(item_id, alumno_id) DO UPDATE SET puntos = excluded.puntos`);
    const sinCasar = [], repetidas = [], fueraDeRango = [];
    let casados = 0;
    for (const f of xl.filas) {
      const id = porIni.get(claveIniciales(f.iniciales));
      if (id === undefined) { sinCasar.push(f.iniciales); continue; }
      if (id === null) { repetidas.push(f.iniciales); continue; }
      casados++;
      f.puntos.forEach((p, k) => {
        if (p != null && p > cols[k].max) { fueraDeRango.push(`${f.iniciales} (${xl.columnas[k].ejercicio}${xl.columnas[k].apartado})`); return; }
        put.run(cols[k].id, id, p);
      });
    }
    return { casados, apartadosCreados: creados, sinCasar, repetidas, fueraDeRango };
  })();
  res.json(resultado);
}));

// ── Resumen del grupo: criterios acumulados de todos sus exámenes ──────────────
router.get('/grupos/:id/resumen', cargar('grupos'), (req, res) => {
  const g = req.fila;
  const alumnos = req.db.prepare('SELECT id, num, iniciales FROM alumnos WHERE grupo_id = ? ORDER BY num').all(g.id);
  const filas = req.db.prepare(`SELECT i.criterio, i.max, n.alumno_id, n.puntos, e.nombre AS examen, e.id AS examen_id
      FROM items i JOIN examenes e ON e.id = i.examen_id
      JOIN notas n ON n.item_id = i.id AND n.puntos IS NOT NULL
      WHERE e.grupo_id = ? AND i.criterio != ''`).all(g.id);
  const desc = new Map();
  for (const c of req.db.prepare(`SELECT c.codigo, c.descripcion FROM criterios c JOIN examenes e ON e.id = c.examen_id
                                  WHERE e.grupo_id = ? AND c.descripcion != '' ORDER BY e.id`).all(g.id)) desc.set(c.codigo, c.descripcion);

  const acum = new Map(); // criterio -> alumno -> {o, p}
  for (const f of filas) {
    for (const cod of codigosDe(f.criterio)) {
      const porAlumno = acum.get(cod) || new Map();
      const t = porAlumno.get(f.alumno_id) || { o: 0, p: 0 };
      t.o += f.puntos; t.p += f.max;
      porAlumno.set(f.alumno_id, t);
      acum.set(cod, porAlumno);
    }
  }
  const criterios = [...acum.keys()].sort().map((codigo) => ({ codigo, descripcion: desc.get(codigo) || '' }));
  const celdas = {};
  for (const [codigo, porAlumno] of acum) {
    for (const [alId, t] of porAlumno) (celdas[alId] ||= {})[codigo] = Math.round((t.o / t.p) * 1e6) / 1e4;
  }
  res.json({ alumnos, criterios, celdas, examenes: req.db.prepare('SELECT COUNT(*) AS n FROM examenes WHERE grupo_id = ?').get(g.id).n });
});

module.exports = router;
