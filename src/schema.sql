-- Skema database Sistem Informasi Manajemen Proyek Pendirian Dapur Produksi UMKM
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','manager','member')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  organization TEXT NOT NULL,
  description TEXT DEFAULT '',
  location TEXT DEFAULT '',
  start_date TEXT NOT NULL,
  target_end_date TEXT NOT NULL,
  actual_end_date TEXT,
  manager_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'Perencanaan' CHECK (status IN ('Perencanaan','Berjalan','Ditunda','Selesai','Dibatalkan')),
  progress REAL NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Keanggotaan proyek untuk kontrol akses (anggota hanya melihat proyek yang diikutinya)
CREATE TABLE IF NOT EXISTS project_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_label TEXT DEFAULT '',
  UNIQUE(project_id, user_id)
);

CREATE TABLE IF NOT EXISTS work_calendars (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  workdays TEXT NOT NULL DEFAULT '1,2,3,4,5', -- hari kerja ISO: 1=Senin..7=Minggu
  work_start_time TEXT DEFAULT '08:00',
  work_end_time TEXT DEFAULT '17:00',
  hours_per_day REAL NOT NULL DEFAULT 8,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS calendar_holidays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'khusus' CHECK (type IN ('nasional','khusus')),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(project_id, date, name)
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  planned_start TEXT,               -- tanggal mulai yang diinput pengguna (anchor)
  start_date TEXT,                  -- tanggal mulai hasil kalkulasi
  duration INTEGER NOT NULL DEFAULT 1, -- durasi dalam HARI KERJA
  end_date TEXT,                    -- tanggal selesai hasil kalkulasi
  priority TEXT NOT NULL DEFAULT 'Sedang' CHECK (priority IN ('Rendah','Sedang','Tinggi','Mendesak')),
  status TEXT NOT NULL DEFAULT 'Belum Dimulai' CHECK (status IN ('Belum Dimulai','Berjalan','Terhambat','Selesai','Dibatalkan')),
  progress REAL NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  sort_order INTEGER NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS task_dependencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  predecessor_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  successor_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'FS' CHECK (type IN ('FS','SS')),
  lag INTEGER NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(successor_id, predecessor_id)
);

CREATE TABLE IF NOT EXISTS resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, -- tautan opsional ke akun login
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  rate REAL NOT NULL DEFAULT 0,
  rate_unit TEXT NOT NULL DEFAULT 'hari' CHECK (rate_unit IN ('hari','bulan')),
  is_active INTEGER NOT NULL DEFAULT 1,
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS resource_unavailability (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  resource_id INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  reason TEXT NOT NULL,
  approval_status TEXT NOT NULL DEFAULT 'Disetujui' CHECK (approval_status IN ('Menunggu','Disetujui','Ditolak')),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS resource_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  resource_id INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  role_on_task TEXT DEFAULT '',
  allocation REAL NOT NULL DEFAULT 100 CHECK (allocation > 0 AND allocation <= 100),
  start_date TEXT,
  end_date TEXT,
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Riwayat perubahan progres tugas (fitur tambahan dan audit sederhana)
CREATE TABLE IF NOT EXISTS task_progress_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  progress REAL NOT NULL,
  status TEXT NOT NULL,
  changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_projects_manager ON projects (manager_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks (project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks (parent_task_id);
CREATE INDEX IF NOT EXISTS idx_deps_project ON task_dependencies (project_id);
CREATE INDEX IF NOT EXISTS idx_assign_task ON resource_assignments (task_id);
CREATE INDEX IF NOT EXISTS idx_assign_resource ON resource_assignments (resource_id);
