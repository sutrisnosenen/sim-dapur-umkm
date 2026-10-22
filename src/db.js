const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// File database terletak di folder data/ pada root proyek
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'sim-proyek-dapur-umkm.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Terapkan skema (idempoten)
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// Helper pembaruan kolom updated_at
const now = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

function touch(table, id) {
  db.prepare(`UPDATE ${table} SET updated_at = ? WHERE id = ?`).run(now(), id);
}

module.exports = { db, DB_PATH, now, touch };
