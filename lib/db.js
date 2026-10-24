const Database = require('better-sqlite3');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const USERS = path.join(DATA, 'users');
fs.mkdirSync(USERS, { recursive: true });

function abrir(file) {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

// ── Base de acceso: correos autorizados y sesiones ─────────────────────────────
const auth = abrir(path.join(DATA, 'auth.db'));
auth.exec(`
CREATE TABLE IF NOT EXISTS autorizados (
  email TEXT PRIMARY KEY,
  nombre TEXT,
  admin INTEGER NOT NULL DEFAULT 0,
  creado TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sesiones (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expira INTEGER NOT NULL
);`);

const norm = (e) => String(e || '').trim().toLowerCase();

function sembrarAdmin(email) {
  email = norm(email);
  if (!email) return;
  auth.prepare(`INSERT INTO autorizados (email, admin) VALUES (?, 1)
                ON CONFLICT(email) DO UPDATE SET admin = 1`).run(email);
}

const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');

function crearSesion(email) {
  const token = crypto.randomBytes(32).toString('hex');
  const dias = 30;
  auth.prepare('DELETE FROM sesiones WHERE expira < ?').run(Date.now());
  auth.prepare('INSERT INTO sesiones (token, email, expira) VALUES (?, ?, ?)')
    .run(hash(token), email, Date.now() + dias * 864e5);
  return { token, dias };
}

function usuarioDeSesion(token) {
  if (!token) return null;
  const s = auth.prepare('SELECT email, expira FROM sesiones WHERE token = ?').get(hash(token));
  if (!s || s.expira < Date.now()) return null;
  // Se re-comprueba la autorización en cada petición: quitar un correo corta el acceso al instante.
  return auth.prepare('SELECT email, nombre, admin FROM autorizados WHERE email = ?').get(s.email) || null;
}

function cerrarSesion(token) {
  if (token) auth.prepare('DELETE FROM sesiones WHERE token = ?').run(hash(token));
}

// ── Base de cada usuario ───────────────────────────────────────────────────────
const ESQUEMA = `
CREATE TABLE IF NOT EXISTS grupos (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  curso TEXT NOT NULL DEFAULT '',
  creado TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS alumnos (
  id INTEGER PRIMARY KEY,
  grupo_id INTEGER NOT NULL REFERENCES grupos(id) ON DELETE CASCADE,
  num INTEGER NOT NULL,
  iniciales TEXT NOT NULL,
  UNIQUE (grupo_id, num)
);
CREATE TABLE IF NOT EXISTS examenes (
  id INTEGER PRIMARY KEY,
  grupo_id INTEGER NOT NULL REFERENCES grupos(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  fecha TEXT NOT NULL DEFAULT '',
  tex TEXT,
  archivo TEXT,
  creado TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY,
  examen_id INTEGER NOT NULL REFERENCES examenes(id) ON DELETE CASCADE,
  ejercicio INTEGER NOT NULL,
  apartado TEXT NOT NULL DEFAULT '',
  titulo TEXT NOT NULL DEFAULT '',
  enunciado TEXT NOT NULL DEFAULT '',
  fuente TEXT NOT NULL DEFAULT '',
  analisis TEXT,
  rubrica TEXT,
  criterio TEXT NOT NULL DEFAULT '',
  criterio_alt TEXT NOT NULL DEFAULT '',
  max REAL NOT NULL DEFAULT 4,
  UNIQUE (examen_id, ejercicio, apartado)
);
CREATE TABLE IF NOT EXISTS criterios (
  examen_id INTEGER NOT NULL REFERENCES examenes(id) ON DELETE CASCADE,
  codigo TEXT NOT NULL,
  descripcion TEXT NOT NULL DEFAULT '',
  repaso TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (examen_id, codigo)
);
CREATE TABLE IF NOT EXISTS notas (
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  alumno_id INTEGER NOT NULL REFERENCES alumnos(id) ON DELETE CASCADE,
  puntos REAL,
  PRIMARY KEY (item_id, alumno_id)
);`;

const abiertas = new Map();

// El nombre del archivo sale de un hash del correo: nunca de texto del usuario.
function dbDeUsuario(email) {
  email = norm(email);
  let db = abiertas.get(email);
  if (!db) {
    db = abrir(path.join(USERS, hash(email).slice(0, 32) + '.db'));
    db.exec(ESQUEMA);
    // Bases creadas antes de añadir estas columnas.
    const cols = db.prepare('PRAGMA table_info(items)').all().map((c) => c.name);
    if (!cols.includes('fuente')) db.exec("ALTER TABLE items ADD COLUMN fuente TEXT NOT NULL DEFAULT ''");
    if (!cols.includes('rubrica')) db.exec('ALTER TABLE items ADD COLUMN rubrica TEXT');
    if (!cols.includes('analisis')) db.exec('ALTER TABLE items ADD COLUMN analisis TEXT');
    const colsAl = db.prepare('PRAGMA table_info(alumnos)').all().map((c) => c.name);
    if (!colsAl.includes('carpeta')) db.exec("ALTER TABLE alumnos ADD COLUMN carpeta TEXT NOT NULL DEFAULT ''");
    abiertas.set(email, db);
  }
  return db;
}

module.exports = { auth, norm, sembrarAdmin, crearSesion, usuarioDeSesion, cerrarSesion, dbDeUsuario };
