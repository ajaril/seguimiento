require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const db = require('./lib/db');

function crearApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    });
    next();
  });

  // Defensa añadida a SameSite=Lax: una petición que modifica datos solo vale si viene de esta misma web.
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origen = req.get('origin');
    if (origen && new URL(origen).host !== req.get('host')) return res.status(403).json({ error: 'Origen no permitido' });
    next();
  });

  app.use('/api/auth', require('./routes/auth')(app));

  // Todo lo demás de la API exige sesión de un correo autorizado.
  app.use('/api', (req, res, next) => {
    const u = db.usuarioDeSesion(req.cookies.seg_sid);
    if (!u) return res.status(401).json({ error: 'No autenticado' });
    req.user = u;
    req.db = db.dbDeUsuario(u.email);
    next();
  });
  app.use('/api/admin', require('./routes/admin'));
  app.use('/api', require('./routes/api'));

  app.use(express.static(path.join(__dirname, 'public')));
  app.use((err, req, res, next) => {
    if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Archivo demasiado grande (máx. 5 MB)' });
    if (err && err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Error interno' });
  });
  return app;
}

if (require.main === module) {
  db.sembrarAdmin(process.env.ADMIN_EMAIL);
  const port = process.env.PORT || 3040;
  crearApp().listen(port, '127.0.0.1', () => console.log(`seguimiento escuchando en :${port}`));
}

module.exports = { crearApp };
