// Autentikasi: hashing password (scrypt), sesi token di cookie httpOnly, middleware peran.
const crypto = require('crypto');
const { db, now } = require('./db');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  try {
    const [salt, hash] = stored.split(':');
    const check = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
  } catch {
    return false;
  }
}

const SESSION_DAYS = 7;

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .run(token, userId, `${expires.getFullYear()}-${p(expires.getMonth() + 1)}-${p(expires.getDate())} ${p(expires.getHours())}:${p(expires.getMinutes())}:${p(expires.getSeconds())}`);
  return { token, expiresAt: expires };
}

function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function getUserByToken(token) {
  if (!token) return null;
  const row = db.prepare(
    `SELECT s.token, s.expires_at, u.id, u.username, u.email, u.full_name, u.role, u.is_active
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`
  ).get(token);
  if (!row) return null;
  if (row.expires_at < now()) {
    destroySession(token);
    return null;
  }
  if (!row.is_active) return null;
  return row;
}

// Middleware: wajib login
function requireAuth(req, res, next) {
  const user = getUserByToken(req.cookies && req.cookies.session_token);
  if (!user) return res.status(401).json({ error: 'Anda belum login atau sesi sudah berakhir.' });
  req.user = user;
  next();
}

// Middleware: wajib peran tertentu
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Anda belum login.' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Anda tidak memiliki izin untuk aksi ini.' });
    }
    next();
  };
}

// Cek izin akses proyek:
// - admin: semua proyek
// - manager: proyek yang dia yang manajernya
// - member: proyek tempat dia terdaftar di project_members
function canAccessProject(user, project) {
  if (!project) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'manager') return project.manager_id === user.id;
  if (user.role === 'member') {
    return !!db.prepare('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?').get(project.id, user.id);
  }
  return false;
}

// Memberi informasi kapabilitas berdasarkan peran
function canManageProject(user, project) {
  if (!project) return false;
  return user.role === 'admin' || (user.role === 'manager' && project.manager_id === user.id);
}

module.exports = { hashPassword, verifyPassword, createSession, destroySession, getUserByToken, requireAuth, requireRole, canAccessProject, canManageProject };
