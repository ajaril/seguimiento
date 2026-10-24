const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const db = require('../lib/db');

module.exports = (app) => {
  const router = express.Router();
  const cliente = new OAuth2Client(process.env.GOOGLE_CLIENT_ID || undefined);

  // Sustituible en las pruebas: (credencial) => payload de Google
  app.locals.verificarGoogle = async (credential) => {
    const ticket = await cliente.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID });
    return ticket.getPayload();
  };

  router.get('/config', (req, res) => res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || '' }));

  router.get('/me', (req, res) => {
    const u = db.usuarioDeSesion(req.cookies.seg_sid);
    if (!u) return res.status(401).json({ error: 'No autenticado' });
    res.json({ email: u.email, nombre: u.nombre, admin: !!u.admin });
  });

  router.post('/google', async (req, res) => {
    let p;
    try { p = await app.locals.verificarGoogle(req.body && req.body.credential); } catch { p = null; }
    if (!p || !p.email || p.email_verified === false) return res.status(401).json({ error: 'Google no ha validado tu cuenta. Inténtalo de nuevo.' });
    const email = db.norm(p.email);
    const fila = db.auth.prepare('SELECT email FROM autorizados WHERE email = ?').get(email);
    if (!fila) return res.status(403).json({ error: `El correo ${email} no tiene acceso a esta aplicación.` });
    if (p.name) db.auth.prepare('UPDATE autorizados SET nombre = ? WHERE email = ?').run(p.name, email);
    const { token, dias } = db.crearSesion(email);
    res.cookie('seg_sid', token, {
      httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: dias * 864e5, path: '/',
    });
    res.json({ ok: true });
  });

  router.post('/logout', (req, res) => {
    db.cerrarSesion(req.cookies.seg_sid);
    res.clearCookie('seg_sid', { path: '/' });
    res.json({ ok: true });
  });

  return router;
};
