# Seguimiento — seguimiento.ajarillo.es

Web para seguir el rendimiento de alumnos: grupos con alumnos por iniciales numeradas, exámenes en LaTeX con criterios
por ejercicio/apartado, notas (importadas de Idoceo) y un informe por alumno con lo flojo y qué repasar.

- Node 22 + Express 4 + better-sqlite3 · puerto 3040 · PM2 `seguimiento` · frontend sin framework
- Login: Google Identity Services (mismo GOOGLE_CLIENT_ID que profesorado/tutoria/departamento). Solo entran los correos de
  `data/auth.db` → tabla `autorizados` (se gestionan en /#/admin; ADMIN_EMAIL del .env es admin).
- Datos: `data/auth.db` (accesos, sesiones) + `data/users/<sha256(email)>.db` = una base independiente por usuario.
- `lib/tex.js` trocea `\ejercicio{[CE x.y] …}`: cada etiqueta [CE] = un apartado (a, b…). `lib/excel.js` lee la lista de clase
  (A=nº, B=iniciales) y la exportación de Idoceo (cabeceras «Ejercicio N … Apartado a (MAT 1.5.2)»; casa por iniciales).
- `lib/analisis.js`: % por criterio/ejercicio, comparación con la clase, texto del informe (<50 reforzar, <75 mejorable).
  `null` = sin dato (no cuenta); 0 sí cuenta. Nota = puntos/posibles×10 (coincide con Idoceo).
- Análisis por apartado: la pestaña «Claude» exporta una petición (lib/claude.js, solo datos agregados de la clase) y guarda el JSON devuelto en items.analisis; el informe lo usa en los apartados <75 %.
- Rúbrica (CSV/Excel «Nivel 4…0», `lib/rubrica.js`) en items.rubrica: el informe muestra el nivel del alumno y qué falta para el siguiente; también va en la petición a Claude.
- Tests: `npm test` (usa los archivos de `muestra/`).
- Nginx: `nginx/seguimiento.ajarillo.es.conf` (plantilla; falta DNS, enlazar en sites-enabled y certbot).
