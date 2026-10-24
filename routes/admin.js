const express = require('express');
const db = require('../lib/db');

const router = express.Router();

router.use((req, res, next) => (req.user.admin ? next() : res.status(403).json({ error: 'Solo administración' })));

router.get('/usuarios', (req, res) => {
  res.json(db.auth.prepare('SELECT email, nombre, admin, creado FROM autorizados ORDER BY admin DESC, email').all());
});

router.post('/usuarios', (req, res) => {
  const email = db.norm(req.body.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Correo no válido' });
  db.auth.prepare('INSERT OR IGNORE INTO autorizados (email) VALUES (?)').run(email);
  res.json({ ok: true });
});

router.delete('/usuarios/:email', (req, res) => {
  const email = db.norm(req.params.email);
  if (email === req.user.email) return res.status(400).json({ error: 'No puedes quitarte el acceso a ti mismo' });
  db.auth.prepare('DELETE FROM autorizados WHERE email = ?').run(email);
  db.auth.prepare('DELETE FROM sesiones WHERE email = ?').run(email);
  res.json({ ok: true });
});

module.exports = router;
