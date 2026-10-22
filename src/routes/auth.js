// Rute autentikasi
const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { verifyPassword, createSession, destroySession, getUserByToken, requireAuth } = require('../auth');

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { identifier, password } = req.body || {};
  if (!identifier || !password) {
    return res.status(400).json({ error: 'Username/email dan password wajib diisi.' });
  }
  const user = db.prepare(
    'SELECT * FROM users WHERE (username = ? OR email = ?) AND is_active = 1'
  ).get(identifier.trim(), identifier.trim());
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Username/email atau password salah.' });
  }
  const session = createSession(user.id);
  res.cookie('session_token', session.token, {
    httpOnly: true,
    sameSite: 'lax',
    expires: session.expiresAt,
  });
  res.json({
    user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role, email: user.email },
  });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  destroySession(req.cookies && req.cookies.session_token);
  res.clearCookie('session_token');
  res.json({ ok: true, message: 'Berhasil logout.' });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  const user = getUserByToken(req.cookies && req.cookies.session_token);
  if (!user) return res.status(401).json({ error: 'Belum login.' });
  res.json({ user: { id: user.id, username: user.username, email: user.email, full_name: user.full_name, role: user.role } });
});

// POST /api/auth/change-password (pengguna mana pun yang sudah login)
router.post('/change-password', requireAuth, (req, res) => {
  const { old_password: oldPw, new_password: newPw } = req.body || {};
  if (!oldPw || !newPw) return res.status(400).json({ error: 'Password lama dan baru wajib diisi.' });
  if (String(newPw).length < 6) return res.status(400).json({ error: 'Password baru minimal 6 karakter.' });
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(oldPw, row.password_hash)) {
    return res.status(400).json({ error: 'Password lama salah.' });
  }
  const { hashPassword } = require('../auth');
  db.prepare('UPDATE users SET password_hash = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?')
    .run(hashPassword(newPw), req.user.id);
  res.json({ ok: true, message: 'Password berhasil diubah.' });
});

module.exports = router;
