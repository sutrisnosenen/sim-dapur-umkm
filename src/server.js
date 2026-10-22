// Server utama Sistem Informasi Manajemen Proyek Pendirian Dapur Produksi UMKM
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const { db } = require('./db');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Sesi API + tangani error JSON agar tidak crash
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// Rute API
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/resources', require('./routes/resources').router);
app.use('/api/analysis', require('./routes/analysis'));

// Fallback 404 API
app.use('/api', (req, res) => {
  res.status(404).json({ error: `Endpoint ${req.method} ${req.originalUrl} tidak ditemukan.` });
});

// Frontend statis (halaman login & aplikasi SPA)
app.use(express.static(path.join(__dirname, '..', 'public')));

// Halaman default
app.get('/', (req, res) => {
  res.redirect('/index.html');
});

// Tangani error agar responsnya JSON, bukan HTML error
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Terjadi kesalahan pada server: ' + (err.message || err) });
});

// ===== Seeding otomatis saat database masih kosong =====
if (db.prepare('SELECT COUNT(*) AS c FROM users').get().c === 0) {
  console.log('Database kosong — menjalankan seeder data awal...');
  require('./seed').run(true);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Aplikasi berjalan di http://localhost:${PORT}`);
  console.log('Akun demo: admin/admin123 ─ manajer/manajer123 ─ anggota/anggota123');
});
