const ExcelJS = require('exceljs');

// CSV con comillas, comas y saltos de línea dentro de las celdas (formato típico de Excel/Google Sheets).
function parsearCsv(t, sepFijo) {
  t = t.replace(/^﻿/, '');
  const sep = sepFijo || ((t.split('\n')[0].match(/;/g) || []).length > (t.split('\n')[0].match(/,/g) || []).length ? ';' : ',');
  const filas = [];
  let fila = [], celda = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { celda += '"'; i++; } else q = false; } else celda += c;
    } else if (c === '"') q = true;
    else if (c === sep) { fila.push(celda); celda = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      fila.push(celda); celda = '';
      if (fila.some((x) => x.trim())) filas.push(fila);
      fila = [];
    } else celda += c;
  }
  fila.push(celda);
  if (fila.some((x) => x.trim())) filas.push(fila);
  return filas;
}

async function filasDeExcel(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  const filas = [];
  ws.eachRow((row) => {
    const v = [];
    for (let c = 1; c <= row.cellCount; c++) { const x = row.getCell(c).value; v.push(x == null ? '' : typeof x === 'object' ? (x.richText ? x.richText.map((r) => r.text).join('') : String(x.result ?? x.text ?? '')) : String(x)); }
    filas.push(v);
  });
  return filas;
}

// Devuelve [{ ejercicio, apartado, niveles: { 0: '…', …, 4: '…' } }]
async function leerRubrica(buffer, nombre) {
  let filas;
  if (/\.xlsx$/i.test(nombre)) filas = await filasDeExcel(buffer);
  else {
    const texto = buffer.toString('utf8');
    filas = parsearCsv(texto);
    if (filas[0].filter((h) => /^\s*Nivel\s+\d/i.test(h)).length < 2 && /Nivel\s+4/i.test(texto)) {
      // Cada línea es una celda con un CSV dentro: se desenvuelve y se lee otra vez.
      const interior = texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim()).map((l) => {
        const celdas = parsearCsv(l, '\t')[0] || [];
        while (celdas.length && !celdas[celdas.length - 1].trim()) celdas.pop();
        return celdas.join(',');
      }).join('\n');
      filas = parsearCsv(interior, ',');
    }
  }
  if (filas.length < 2) throw new Error('La rúbrica está vacía.');
  const cols = filas[0].map((h) => { const m = String(h).match(/Nivel\s+(\d+)/i); return m ? +m[1] : null; });
  if (!cols.some((c) => c != null)) throw new Error('No encuentro columnas «Nivel 4», «Nivel 3»… en la primera fila.');
  const salida = [];
  for (const f of filas.slice(1)) {
    const m = String(f[0] || '').match(/Ejercicio\s+(\d+)\b(?:.*?Apartado\s+([^\s(]+))?/i);
    if (!m) continue;
    const ap = (m[2] || '').toLowerCase();
    const niveles = {};
    cols.forEach((n, k) => { if (n != null && f[k] && f[k].trim()) niveles[n] = f[k].trim().slice(0, 600); });
    salida.push({ ejercicio: +m[1], apartado: /^[uú]nico$/.test(ap) ? '' : ap, niveles });
  }
  if (!salida.length) throw new Error('No he reconocido ninguna fila «Ejercicio N … Apartado …».');
  return salida;
}

module.exports = { leerRubrica };
