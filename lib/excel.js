const ExcelJS = require('exceljs');

function texto(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((r) => r.text).join('');
    if ('result' in v) return texto(v.result);
    if ('text' in v) return texto(v.text);
    return '';
  }
  return String(v).trim();
}

const numero = (v) => {
  if (v && typeof v === 'object' && 'result' in v) v = v.result;
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

// Para casar iniciales entre ficheros: sin tildes, sin espacios, en mayúsculas.
const claveIniciales = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9ÑñÇç]/g, '').toUpperCase();

async function hoja(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('El Excel no tiene hojas');
  return ws;
}

// Lista de clase: columna A = número, columna B = iniciales. La fila de cabecera se salta sola.
async function leerLista(buffer) {
  const ws = await hoja(buffer);
  const alumnos = [];
  ws.eachRow((row) => {
    const num = numero(row.getCell(1).value);
    const iniciales = texto(row.getCell(2).value);
    if (num != null && Number.isInteger(num) && num > 0 && iniciales) alumnos.push({ num, iniciales });
  });
  return alumnos;
}

// Exportación de Idoceo: cabeceras «Ejercicio N - Ejercicio N - Apartado a (MAT 1.5.2)», una fila por alumno.
async function leerIdoceo(buffer) {
  const ws = await hoja(buffer);
  const cab = ws.getRow(1);
  const columnas = [];
  cab.eachCell((cell, col) => {
    const m = texto(cell.value).match(/^Ejercicio\s+(\d+)\b.*?Apartado\s+(.+?)\s*(?:\(([^)]*)\))?\s*$/i);
    if (!m) return;
    const ap = m[2].trim();
    columnas.push({ col, ejercicio: +m[1], apartado: /^[uú]nico$/i.test(ap) ? '' : ap.toLowerCase(), criterio: (m[3] || '').trim() });
  });
  if (!columnas.length) throw new Error('No encuentro columnas «Ejercicio N … Apartado …» en la primera fila. ¿Es la exportación de Idoceo?');
  const filas = [];
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const iniciales = texto(row.getCell(1).value);
    if (!iniciales) return;
    filas.push({ iniciales, puntos: columnas.map((c) => numero(row.getCell(c.col).value)) });
  });
  return { columnas, filas };
}

// Carpetas personales: columna A = nombre del alumno, columna B = enlace a su carpeta (texto o celda con hipervínculo).
async function leerCarpetas(buffer) {
  const ws = await hoja(buffer);
  const filas = [];
  ws.eachRow((row) => {
    const nombre = texto(row.getCell(1).value);
    const c = row.getCell(2).value;
    const enlace = (c && typeof c === 'object' && c.hyperlink) || (row.getCell(2).hyperlink) || texto(c);
    if (nombre && /^https?:\/\//i.test(String(enlace).trim())) filas.push({ nombre, enlace: String(enlace).trim() });
  });
  return filas;
}

module.exports = { leerCarpetas, leerLista, leerIdoceo, claveIniciales };
