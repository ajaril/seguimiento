// Cálculo del análisis de un examen. «null» en una nota significa «sin dato» (no presentado / sin evaluar) y no
// cuenta ni como acierto ni como fallo; un 0 sí cuenta.

const FLOJO = 50;
const MEJORABLE = 75;

const ref = (it) => `${it.ejercicio}${it.apartado}`;
const pct = (o, p) => (p > 0 ? (o / p) * 100 : null);
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const r4 = (x) => (x == null ? null : Math.round(x * 1e4) / 1e4);
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
const estado = (p) => (p == null ? null : p < FLOJO ? 'flojo' : p < MEJORABLE ? 'mejorable' : 'bien');

// Un apartado puede evaluar varios criterios («CE 4.1, CE 5.1»): su resultado cuenta en cada uno de ellos.
const codigosDe = (criterio) => [...new Set(String(criterio || '').split(/[,;]/).map((c) => c.trim()).filter(Boolean))];

function sumar(items, puntosDe) {
  let o = 0, p = 0;
  for (const it of items) {
    const v = puntosDe(it);
    if (v == null) continue;
    o += v; p += it.max;
  }
  return { o, p };
}

function analizar({ items, criterios, alumnos, notas }) {
  const infoCriterio = new Map(criterios.map((c) => [c.codigo, c]));
  const de = (it) => { const c = codigosDe(it.criterio); return c.length ? c : ['Sin criterio']; };
  const codigos = [...new Set(items.flatMap(de))];
  const itemsDe = (cod) => items.filter((i) => de(i).includes(cod));
  const nota = (it, al) => {
    const v = notas.get(`${it.id}:${al.id}`);
    return v === undefined ? null : v;
  };

  // Clase por criterio y por ítem
  const claseCriterios = codigos.map((cod) => {
    let o = 0, p = 0;
    for (const al of alumnos) { const s = sumar(itemsDe(cod), (it) => nota(it, al)); o += s.o; p += s.p; }
    const c = infoCriterio.get(cod) || {};
    return { codigo: cod, descripcion: c.descripcion || '', repaso: c.repaso || '', pct: r1(pct(o, p)), exacto: r4(pct(o, p)), estado: estado(pct(o, p)) };
  });
  const mediaCriterio = new Map(claseCriterios.map((c) => [c.codigo, c.pct]));
  const mediaExacta = new Map(claseCriterios.map((c) => [c.codigo, c.exacto]));

  const claseItems = items.map((it) => {
    let o = 0, p = 0, ceros = 0, n = 0;
    const distrib = {};
    for (const al of alumnos) {
      const v = nota(it, al);
      if (v == null) continue;
      o += v; p += it.max; n++;
      distrib[v] = (distrib[v] || 0) + 1;
      if (v === 0) ceros++;
    }
    return { id: it.id, ref: ref(it), titulo: it.titulo, criterio: it.criterio, max: it.max, pct: r1(pct(o, p)), exacto: r4(pct(o, p)), estado: estado(pct(o, p)), ceros, n, distrib };
  });

  const out = alumnos.map((al) => {
    const t = sumar(items, (it) => nota(it, al));
    const notaFinal = t.p > 0 ? (t.o / t.p) * 10 : null;

    const porCriterio = codigos.map((cod) => {
      const s = sumar(itemsDe(cod), (it) => nota(it, al));
      const c = infoCriterio.get(cod) || {};
      const p = pct(s.o, s.p);
      return { codigo: cod, descripcion: c.descripcion || '', repaso: c.repaso || '', pct: r1(p), exacto: r4(p), clase: mediaCriterio.get(cod), claseExacto: mediaExacta.get(cod), estado: estado(p), items: itemsDe(cod).map(ref) };
    }).filter((c) => c.pct != null);

    const porItem = items.map((it) => {
      const v = nota(it, al);
      return { id: it.id, ref: ref(it), titulo: it.titulo, criterio: it.criterio, puntos: v, max: it.max, pct: v == null ? null : r1(pct(v, it.max)) };
    });
    const debiles = porItem.filter((x) => x.pct != null && x.pct < FLOJO).sort((a, b) => a.pct - b.pct);

    return {
      id: al.id, num: al.num, iniciales: al.iniciales,
      nota: r2(notaFinal), obtenido: t.o, posible: t.p,
      porCriterio, porItem, debiles,
      texto: redactar(notaFinal, porCriterio, debiles),
    };
  });

  const notas10 = out.map((a) => a.nota).filter((n) => n != null);
  const media = notas10.length ? r2(notas10.reduce((a, b) => a + b, 0) / notas10.length) : null;
  return {
    clase: { media, aprobados: notas10.filter((n) => n >= 5).length, presentados: notas10.length, criterios: claseCriterios, items: claseItems },
    alumnos: out,
  };
}

const lista = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`);
const etiqueta = (c) => (c.descripcion ? `${c.codigo} (${c.descripcion})` : c.codigo);

function redactar(nota, criterios, debiles) {
  if (nota == null) return { resumen: 'No hay notas registradas para este examen.', fuertes: [], reforzar: [], mejorar: [] };
  const fuertes = criterios.filter((c) => c.estado === 'bien').sort((a, b) => b.pct - a.pct);
  const reforzar = criterios.filter((c) => c.estado === 'flojo').sort((a, b) => a.pct - b.pct);
  const mejorar = criterios.filter((c) => c.estado === 'mejorable').sort((a, b) => a.pct - b.pct);

  const partes = [];
  if (fuertes.length) partes.push(`Lo mejor te ha salido en ${lista(fuertes.map(etiqueta))}.`);
  if (reforzar.length) partes.push(`Lo que más necesitas reforzar es ${lista(reforzar.map(etiqueta))}.`);
  if (mejorar.length) partes.push(`Tienes base pero falta afianzar ${lista(mejorar.map(etiqueta))}.`);
  if (!reforzar.length && !mejorar.length) partes.push('No hay ningún bloque flojo: sigue con este ritmo.');
  return { resumen: partes.join(' '), fuertes, reforzar, mejorar };
}

module.exports = { analizar, codigosDe, ref, FLOJO, MEJORABLE };
