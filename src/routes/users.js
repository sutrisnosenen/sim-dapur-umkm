// Rute manajemen akun pengguna (khusus admin)
const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { hashPassword, requireAuth, requireRole } = require('../auth');

const ROLES = ['admin', 'manager', 'member'];

// GET /api/users — daftar pengguna
router.get('/', requireAuth, requireRole('admin', 'manager'), (req, res) => {
  const rows = db.prepare(
    'SELECT id, username, email, full_name, role, is_active, created_at FROM users ORDER BY full_name'
  ).all();
  res.json(rows);
});

// POST /api/users — buat pengguna baru (admin)
router.post('/', requireAuth, requireRole('admin'), (req, res) => {
  const { username, email, password, full_name: fullName, role } = req.body || {};
  if (!username || !email || !password || !fullName || !role) {
    return res.status(400).json({ error: 'Semua kolom wajib diisi.' });
  }
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Peran tidak valid.' });
  if (String(password).length < 6) return res.status(400).json({ error: 'Password minimal 6 karakter.' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Format email tidak valid.' });
  try {
    const r = db.prepare(
      'INSERT INTO users (username, email, password_hash, full_name, role) VALUES (?, ?, ?, ?, ?)'
    ).run(username.trim(), email.trim(), hashPassword(password), fullName.trim(), role);
    res.status(201).json({ id: r.lastInsertRowid, message: 'Pengguna berhasil dibuat.' });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(400).json({ error: 'Username atau email sudah terdaftar.' });
    }
    throw e;
  }
});

// PUT /api/users/:id — ubah data pengguna (admin)
router.put('/:id', requireAuth, requireRole('admin'), (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
  const { full_name: fullName, email, role, is_active: isActive, password } = req.body || {};
  if (role && !ROLES.includes(role)) return res.status(400).json({ error: 'Peran tidak valid.' });
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Format email tidak valid.' });
  if (password && String(password).length < 6) return res.status(400).json({ error: 'Password minimal 6 karakter.' });

  db.prepare(
    `UPDATE users SET full_name = ?, email = ?, role = ?, is_active = ?,
     password_hash = CASE WHEN ? IS NOT NULL AND ? != '' THEN ? ELSE password_hash END,
     updated_at = datetime('now','localtime') WHERE id = ?`
  ).run(
    fullName ?? user.full_name,
    email ?? user.email,
    role ?? user.role,
    isActive === undefined ? user.is_active : (isActive ? 1 : 0),
    password ?? null,
    password ?? null,
    password ? hashPassword(password) : null,
    req.params.id
  );
  res.json({ ok: true, message: 'Data pengguna berhasil diperbarui. Password direset.' });
});

// POST /api/users/:id/reset-password
router.post('/:id/reset-password', requireAuth, requireRole('admin'), (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
  const { password } = req.body || {};
  if (!password || String(password).length < 6) return res.status(400).json({ error: 'Password minimal 6 karakter.' });
  db.prepare('UPDATE users SET password_hash = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?')
    .run(hashPassword(password), req.params.id);
  res.json({ ok: true, message: 'Password berhasil direset.' });
});

// POST /api/users/:id/activate & deactivate
router.post('/:id/activate', requireAuth, requireRole('admin'), (req, res) => {
  db.prepare('UPDATE users SET is_active = 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true, message: 'Pengguna diaktifkan.' });
});
router.post('/:id/deactivate', requireAuth, requireRole('admin'), (req, res) => {
  if (Number(req.params.id) === req.user.id) {
    return res.status(400).json({ error: 'Tidak bisa menonaktifkan akun sendiri.' });
  }
  db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true, message: 'Pengguna dinonaktifkan.' });
});

module.exports = router;
