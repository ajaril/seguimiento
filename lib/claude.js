// Puente con Claude (chat): se exporta un texto con instrucciones + datos agregados de la clase y se importa el JSON de vuelta.
// No sale ningún dato individual: solo enunciados y resultados de la clase por apartado.

const ESQUEMA = `{
  "version": 1,
  "items": [
    {
      "ref": "8a",
      "habilidad": "Descomposición factorial",
      "que_evalua": "Qué comprueba exactamente este apartado (1 frase).",
      "errores_tipicos": ["Error frecuente 1", "Error frecuente 2"],
      "consejo": "Qué debe hacer el alumno para mejorar (1-2 frases, hablándole de tú).",
      "repaso": "Explicación breve del contenido (2-3 frases, sin ejemplos).",
      "ejemplos": [
        { "enunciado": "Ejemplo resuelto 1, con fórmulas entre $...$", "solucion": "Resolución paso a paso, breve, con el resultado" },
        { "enunciado": "Ejemplo resuelto 2", "solucion": "Su resolución" }
      ],
      "practica": [
        { "enunciado": "Ejercicio nuevo parecido, con fórmulas entre $...$", "solucion": "Solución breve" },
        { "enunciado": "Otro ejercicio", "solucion": "Su solución" }
      ]
    }
  ],
  "criterios": [
    { "codigo": "CE 5.2", "descripcion": "Descripción corta del criterio", "repaso": "Material de repaso recomendado para el criterio" }
  ]
}`;

function construirPeticion(ex, grupo, items, claseItems) {
  const porId = new Map(claseItems.map((c) => [c.id, c]));
  const datos = {
    examen: ex.nombre,
    curso: grupo.nombre,
    apartados: items.map((it) => {
      const c = porId.get(it.id) || {};
      return {
        ref: `${it.ejercicio}${it.apartado}`,
        ejercicio: it.ejercicio,
        apartado: it.apartado || null,
        criterio: it.criterio || null,
        puntos_maximos: it.max,
        enunciado_latex_del_ejercicio_completo: it.fuente || it.titulo,
        rubrica_del_profesor: it.rubrica ? JSON.parse(it.rubrica) : null,
        resultados_clase: { porcentaje_medio: c.pct, alumnos_evaluados: c.n, reparto_de_puntuaciones: c.distrib },
      };
    }),
  };
  return `Eres un asistente de un profesor de Matemáticas. Te paso un examen (código LaTeX de cada ejercicio) y cómo le ha ido a la clase en cada apartado. Quiero un análisis por ejercicio/apartado que luego daré a cada alumno para que sepa qué le falla y qué repasar.

Reglas:
- Devuelve UN ÚNICO bloque de código JSON, sin nada de texto fuera de él, con exactamente esta forma:
${ESQUEMA}
- Una entrada en "items" por cada "ref" de los datos, con el mismo "ref" tal cual. Los apartados a/b de un mismo ejercicio comparten enunciado: deduce qué parte cubre cada uno y analízalos por separado.
- Escribe para alumnado de ${grupo.nombre}, en español, claro y breve. "errores_tipicos": 2-4 errores concretos de este tipo de ejercicio, según el reparto de puntuaciones y lo que suele fallar. "practica": 3 ejercicios nuevos y similares, de dificultad creciente, cada uno con "enunciado" (sin la solución) y "solucion" por separado: el alumno recibirá solo los enunciados y los hará sin ver la solución; no repitas aquí los ejemplos.
- Las fórmulas, entre $...$. IMPORTANTE: es JSON, así que cada barra invertida de LaTeX debe ir DOBLE (ejemplo: "$\\\\frac{1}{2}$", "$2\\\\cdot 3$"). Comillas dobles dentro de textos, escapadas.
- "ejemplos": 2-3 ejemplos RESUELTOS que ilustren el error más habitual y cómo evitarlo, con la resolución explicada paso a paso. Deben ser distintos de los de "practica".
- "criterios": una entrada por cada código de criterio distinto (si un apartado trae varios códigos separados por comas, evalúa todos: da una entrada por cada código suelto), con descripción corta y material de repaso recomendado.
- Si un apartado trae "rubrica_del_profesor", es la rúbrica real con la que he corregido (niveles 0-4; el reparto de puntuaciones usa esos mismos niveles). Úsala: deduce "errores_tipicos" de lo que describen los niveles bajos y de los errores de regla que menciona, y el "consejo" de lo que separa un nivel del siguiente. No la copies literalmente.
- No inventes datos que no estén abajo.

DATOS:
${JSON.stringify(datos, null, 1)}`;
}

const MAXTXT = 2000;
const txt = (v, max = MAXTXT) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const lista = (v, n, max) => (Array.isArray(v) ? v.map((x) => txt(x, max)).filter(Boolean).slice(0, n) : []);

// Cada ejercicio de práctica: { enunciado, solucion }. Se acepta también el formato antiguo (texto con el resultado entre paréntesis al final).
function practicas(v) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => {
    if (x && typeof x === 'object') return { enunciado: txt(x.enunciado, 600), solucion: txt(x.solucion, 600) };
    const t = txt(x, 600);
    const m = t.match(/^(.*?)\s*\(\s*([^()]*=[^()]*)\)\s*$/s);
    return m ? { enunciado: m[1].trim(), solucion: m[2].trim() } : { enunciado: t, solucion: '' };
  }).filter((x) => x.enunciado).slice(0, 6);
}

function extraerJson(texto) {
  let t = String(texto || '').trim();
  const m = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (m) t = m[1].trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('No encuentro ningún JSON en lo que has pegado.');
  return t.slice(a, b + 1);
}

// Un "\frac" o "\times" sin duplicar la barra es JSON válido pero con caracteres de control: se detecta y se rechaza.
const CONTROL = /[\f\b\t\r]/;
function hayControl(x) {
  if (typeof x === 'string') return CONTROL.test(x);
  if (Array.isArray(x)) return x.some(hayControl);
  if (x && typeof x === 'object') return Object.values(x).some(hayControl);
  return false;
}

function leerRespuesta(texto) {
  const crudo = extraerJson(texto);
  let obj;
  try { obj = JSON.parse(crudo); } catch {
    // Barras sueltas de LaTeX (\cdot, \sqrt…) sin duplicar: se arreglan las que no son escapes JSON válidos.
    try { obj = JSON.parse(crudo.replace(/\\(?!["\\/bfnrtu])/g, '\\\\')); } catch (e) {
      throw new Error('El JSON no es válido (' + e.message + '). Pídele a Claude que lo devuelva de nuevo con las barras invertidas de LaTeX dobles.');
    }
  }
  if (hayControl(obj)) throw new Error('El JSON tiene fórmulas con una sola barra invertida (\\frac, \\times…) que se han corrompido. Pídele a Claude que duplique todas las barras invertidas de LaTeX.');
  if (!obj || !Array.isArray(obj.items)) throw new Error('Falta la lista "items" en el JSON.');
  const items = obj.items.filter((i) => i && txt(i.ref, 10)).map((i) => ({
    ref: txt(i.ref, 10).toLowerCase(),
    analisis: {
      habilidad: txt(i.habilidad, 200),
      que_evalua: txt(i.que_evalua),
      errores_tipicos: lista(i.errores_tipicos, 6, 400),
      consejo: txt(i.consejo),
      repaso: txt(i.repaso, 4000),
      ejemplos: practicas(i.ejemplos),
      practica: practicas(i.practica),
    },
  }));
  const criterios = (Array.isArray(obj.criterios) ? obj.criterios : []).filter((c) => c && txt(c.codigo, 40))
    .map((c) => ({ codigo: txt(c.codigo, 40), descripcion: txt(c.descripcion, 400), repaso: txt(c.repaso, 4000) }));
  return { items, criterios };
}

// Análisis guardado → forma actual, también si se guardó con el formato anterior (práctica como texto con la solución entre paréntesis).
function normalizarAnalisis(a) {
  if (!a) return null;
  return { ...a, errores_tipicos: Array.isArray(a.errores_tipicos) ? a.errores_tipicos : [], practica: practicas(a.practica), ejemplos: practicas(a.ejemplos) };
}

module.exports = { construirPeticion, leerRespuesta, normalizarAnalisis };
