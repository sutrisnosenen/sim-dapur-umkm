// Rute proyek: CRUD proyek, keanggotaan, kalender kerja, hari libur, tugas, dependensi.
const express = require('express');
const router = express.Router();
const { db, now, touch } = require('../db');
const { requireAuth, requireRole, canAccessProject, canManageProject } = require('../auth');
const { createsCycle, rescheduleProject } = require('../scheduler');
const { makeCalendar, loadCalendarData, isYmd } = require('../calendar');

// semua rute proyek memerlukan login
router.use(requireAuth);

const STATUSES = ['Perencanaan', 'Berjalan', 'Ditunda', 'Selesai', 'Dibatalkan'];
const PRIORITIES = ['Rendah', 'Sedang', 'Tinggi', 'Mendesak'];
const TASK_STATUSES = ['Belum Dimulai', 'Berjalan', 'Terhambat', 'Selesai', 'Dibatalkan'];

// ===== Helper =====
function getProjectOr404(req, res) {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Proyek tidak ditemukan.' });
    return null;
  }
  if (!canAccessProject(req.user, project)) {
    res.status(403).json({ error: 'Anda tidak punya akses ke proyek ini.' });
    return null;
  }
  return project;
}

function ensureCalendar(projectId) {
  const cal = db.prepare('SELECT 1 FROM work_calendars WHERE project_id = ?').get(projectId);
  if (!cal) {
    db.prepare('INSERT INTO work_calendars (project_id) VALUES (?)').run(projectId);
  }
}

// fungsi dependensiProjectOk didefinisikan lebih lanjut di bagian rute dependensi


// Middleware proyek untuk semua sub-route (juga menangani path persis /:projectId)
router.use('/:projectId', (req, res, next) => {
  const project = getProjectOr404(req, res);
  if (!project) return;
  req.project = project;
  next();
});

// ===== GET /api/projects — daftar proyek sesuai izin =====
router.get('/', requireAuth, (req, res) => {
  let rows;
  if (req.user.role === 'admin') {
    rows = db.prepare(`SELECT p.*, u.full_name AS manager_name FROM projects p JOIN users u ON u.id = p.manager_id ORDER BY p.id DESC`).all();
  } else if (req.user.role === 'manager') {
    rows = db.prepare(`SELECT p.*, u.full_name AS manager_name FROM projects p JOIN users u ON u.id = p.manager_id WHERE p.manager_id = ? ORDER BY p.id DESC`).all(req.user.id);
  } else {
    rows = db.prepare(`
      SELECT p.*, u.full_name AS manager_name FROM projects p JOIN users u ON u.id = p.manager_id
      WHERE p.id IN (SELECT project_id FROM project_members WHERE user_id = ?) ORDER BY p.id DESC
    `).all(req.user.id);
  }
  // filter query sederhana
  const { q, status } = req.query;
  if (status) rows = rows.filter((r) => r.status === status);
  if (q) rows = rows.filter((r) => (r.name + ' ' + r.organization).toLowerCase().includes(String(q).toLowerCase()));
  res.json(rows);
});

// ===== POST /api/projects — buat proyek =====
router.post('/', requireAuth, requireRole('admin', 'manager'), (req, res) => {
  const {
    name, organization, description, location,
    start_date: startDate, target_end_date: targetEnd, manager_id: managerId,
  } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Nama proyek wajib diisi.' });
  if (!organization || !String(organization).trim()) return res.status(400).json({ error: 'Organisasi wajib diisi.' });
  if (!startDate || !targetEnd) return res.status(400).json({ error: 'Tanggal mulai dan target selesai wajib diisi.' });
  if (!isYmd(startDate) || !isYmd(targetEnd)) return res.status(400).json({ error: 'Tanggal mulai/target selesai tidak valid (format YYYY-MM-DD dgn tanggal nyata).' });
  if (new Date(targetEnd) < new Date(startDate)) {
    return res.status(400).json({ error: 'Target tanggal selesai tidak boleh lebih awal dari tanggal mulai.' });
  }
  const manager = Number(managerId || req.user.id);
  const mUser = db.prepare('SELECT * FROM users WHERE id = ?').get(manager);
  if (!mUser) return res.status(400).json({ error: 'Manajer proyek harus merupakan pengguna yang valid.' });
  if (req.user.role === 'manager' && manager !== req.user.id) {
    return res.status(403).json({ error: 'Manajer proyek hanya dapat membuat proyek atas namanya sendiri.' });
  }
  const r = db.prepare(
    `INSERT INTO projects (name, organization, description, location, start_date, target_end_date, manager_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'Perencanaan')`
  ).run(name.trim(), organization.trim(), description || '', location || '', startDate, targetEnd, manager);
  const projectId = r.lastInsertRowid;
  ensureCalendar(projectId);
  res.status(201).json({ id: projectId, message: 'Proyek berhasil dibuat.' });
});

// ===== GET /api/projects/:id =====
router.get('/:projectId', requireAuth, (req, res) => {
  const p = req.project;
  const manager = db.prepare('SELECT full_name FROM users WHERE id = ?').get(p.manager_id);
  const members = db.prepare(
    `SELECT pm.id, pm.user_id, u.full_name, u.username, u.role, pm.role_label
     FROM project_members pm JOIN users u ON u.id = pm.user_id WHERE pm.project_id = ?`
  ).all(p.id);
  const calendar = db.prepare('SELECT * FROM work_calendars WHERE project_id = ?').get(p.id) || null;
  const managerId = p.manager_id;
  res.json({
    ...p,
    manager_name: manager ? manager.full_name : '-',
    members,
    calendar,
    can_manage: canManageProject(req.user, p),
    can_view: true,
    manager_id: managerId,
  });
});

// ===== PUT /api/projects/:projectKd =====
router.put('/:projectId', requireAuth, (req, res) => {
  if (!canManageProject(req.user, req.project)) {
    return res.status(403).json({ error: 'Hanya admin atau manajer proyek ini yang dapat mengubah proyek.' });
  }
  const p = req.project;
  const b = req.body || {};
  const startDate = b.start_date ?? p.start_date;
  const targetEnd = b.target_end_date ?? p.target_end_date;
  if (!isYmd(startDate) || !isYmd(targetEnd)) return res.status(400).json({ error: 'Tanggal mulai/target selesai tidak valid.' });
  if (new Date(targetEnd) < new Date(startDate)) {
    return res.status(400).json({ error: 'Target tanggal selesai tidak boleh lebih awal dari tanggal mulai.' });
  }
  if (b.status && !STATUSES.includes(b.status)) return res.status(400).json({ error: 'Status proyek tidak valid.' });
  if (b.manager_id !== undefined) {
    const mUser = db.prepare('SELECT * FROM users WHERE id = ?').get(b.manager_id);
    if (!mUser) return res.status(400).json({ error: 'Manajer proyek harus merupakan pengguna yang valid.' });
  }
  db.prepare(
    `UPDATE projects SET name = ?, organization = ?, description = ?, location = ?,
     start_date = ?, target_end_date = ?, actual_end_date = ?, manager_id = ?, status = ?,
     updated_at = datetime('now','localtime') WHERE id = ?`
  ).run(
    b.name ?? p.name,
    b.organization ?? p.organization,
    b.description ?? p.description,
    b.location ?? p.location,
    startDate,
    targetEnd,
    b.actual_end_date ?? p.actual_end_date,
    b.manager_id ?? p.manager_id,
    b.status ?? p.status,
    p.id
  );
  touch('projects', p.id);
  rescheduleProject(db, p.id);
  res.json({ ok: true, message: 'Proyek berhasil diperbarui.' });
});

// ===== DELETE /api/projects/:projectId — hapus proyek (dengan konfirmasi di UI) =====
router.delete('/:projectId', requireAuth, (req, res) => {
  if (!canManageProject(req.user, req.project)) {
    return res.status(403).json({ error: 'Hanya admin atau manajer proyek ini yang dapat menghapus proyek.' });
  }
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.project.id);
  res.json({ ok: true, message: 'Proyek beserta seluruh data terkait dihapus.' });
});

// ===== Keanggotaan proyek =====
router.post('/:projectId/members', requireAuth, (req, res) => {
  if (!canManageProject(req.user, req.project)) return res.status(403).json({ error: 'Tidak punya izin. Hanya admin atau manajer proyek ini.' });
  const { user_id: userId, role_label: roleLabel } = req.body || {};
  if (!userId || !Number.isFinite(Number(userId))) return res.status(400).json({ error: 'Pengguna wajib dipilih.' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(400).json({ error: 'Pengguna tidak ditemukan.' });
  const label = String(roleLabel || '').trim() || user.role;
  db.prepare('INSERT OR IGNORE INTO project_members (project_id, user_id, role_label) VALUES (?, ?, ?)')
    .run(req.project.id, userId, label);

  // Tautkan akun ke resource (tabel resource_assignments memakai resource_id),
  // agar anggota akun langsung bisa dipilih pada panel Penugasan Anggota tugas.
  let resource = db.prepare('SELECT * FROM resources WHERE user_id = ?').get(userId);
  if (!resource) {
    const r = db.prepare(
      `INSERT INTO resources (user_id, name, role, rate, rate_unit, is_active, notes)
       VALUES (?, ?, ?, 0, 'hari', 1, ?)`
    ).run(userId, user.full_name || user.username, label, 'Dibuat otomatis saat ditambahkan ke proyek.');
    resource = db.prepare('SELECT * FROM resources WHERE id = ?').get(r.lastInsertRowid);
  }
  res.status(201).json({ ok: true, resource_id: resource.id, message: 'Anggota ditambahkan ke proyek.' });
});
router.delete('/:projectId/members/:userId', requireAuth, (req, res) => {
  if (!canManageProject(req.user, req.project)) return res.status(403).json({ error: 'Tidak punya izin.' });
  db.prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?').run(req.project.id, req.params.userId);
  res.json({ ok: true, message: 'Anggota dikeluarkan dari proyek.' });
});

// ===== Kalender kerja =====
router.get('/:projectId/calendar', requireAuth, (req, res) => {
  ensureCalendar(req.project.id);
  const cal = db.prepare('SELECT * FROM work_calendars WHERE project_id = ?').get(req.project.id);
  const holidays = db.prepare('SELECT * FROM calendar_holidays WHERE project_id = ? ORDER BY date').all(req.project.id);
  const calFn = makeCalendar(loadCalendarData(db, req.project.id));
  res.json({ calendar: cal, holidays, workdays: calFn.workdays, holidays_set: [...calFn.holidays] });
});

router.put('/:projectId/calendar', requireAuth, (req, res) => {
  if (!canManageProject(req.user, req.project)) return res.status(403).json({ error: 'Tidak punya izin.' });
  ensureCalendar(req.project.id);
  const cal = db.prepare('SELECT * FROM work_calendars WHERE project_id = ?').get(req.project.id);
  const b = req.body || {};
  let workdays = cal.workdays;
  if (b.workdays !== undefined) {
    const list = String(b.workdays).split(',').map((x) => parseInt(x, 10)).filter((n) => n >= 1 && n <= 7);
    if (!list.length) return res.status(400).json({ error: 'Minimal satu hari kerja harus dipilih.' });
    workdays = list.join(',');
  }
  db.prepare(`UPDATE work_calendars SET workdays = ?, work_start_time = ?, work_end_time = ?, hours_per_day = ?, updated_at = datetime('now','localtime') WHERE project_id = ?`)
    .run(
      workdays,
      b.work_start_time ?? cal.work_start_time,
      b.work_end_time ?? cal.work_end_time,
      b.hours_per_day ?? cal.hours_per_day,
      req.project.id
    );
  rescheduleProject(db, req.project.id);
  res.json({ ok: true, message: 'Calendar kerja diperbarui dan jadwal dihitung ulang.' });
});

// Tambah hari libur
router.post('/:projectId/calendar/holidays', requireAuth, (req, res) => {
  if (!canManageProject(req.user, req.project)) return res.status(403).json({ error: 'Tidak punya izin.' });
  const { date, name, type } = req.body || {};
  if (!date || !name) return res.status(400).json({ error: 'Tanggal dan nama libur wajib diisi.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Tanggal harus dengan format YYYY-MM-DD.' });
  if (type && !['nasional', 'khusus'].includes(type)) return res.status(400).json({ error: 'Tipe libur tidak valid.' });
  const exists = db.prepare('SELECT 1 FROM calendar_holidays WHERE project_id = ? AND date = ? AND name = ?')
    .get(req.project.id, date, name);
  if (exists) return res.status(400).json({ error: 'Hari libur dengan tanggal dan nama yang sama sudah ada.' });
  db.prepare('INSERT INTO calendar_holidays (project_id, date, name, type) VALUES (?, ?, ?, ?)')
    .run(req.project.id, date, name, type || 'khusus');
  rescheduleProject(db, req.project.id);
  res.status(201).json({ ok: true, message: 'Hari libur ditambahkan dan jadwal dihitung ulang.' });
});

// Ubah hari libur
router.put('/:projectId/calendar/holidays/:holidayId', requireAuth, (req, res) => {
  if (!canManageProject(req.user, req.project)) return res.status(403).json({ error: 'Tidak punya izin.' });
  const hol = db.prepare('SELECT * FROM calendar_holidays WHERE id = ? AND project_id = ?')
    .get(req.params.holidayId, req.project.id);
  if (!hol) return res.status(404).json({ error: 'Hari libur tidak ditemukan.' });
  const { date, name } = req.body || {};
  db.prepare('UPDATE calendar_holidays SET date = ?, name = ? WHERE id = ?')
    .run(date ?? hol.date, name ?? hol.name, hol.id);
  rescheduleProject(db, req.project.id);
  res.json({ ok: true, message: 'Hari libur diperbarui.' });
});

// Hapus hari libur
router.delete('/:projectId/calendar/holidays/:holidayId', requireAuth, (req, res) => {
  if (!canManageProject(req.user, req.project)) return res.status(403).json({ error: 'Tidak punya izin.' });
  db.prepare('DELETE FROM calendar_holidays WHERE id = ? AND project_id = ?').run(req.params.holidayId, req.project.id);
  rescheduleProject(db, req.project.id);
  res.json({ ok: true, message: 'Hari libur dihapus.' });
});

// ===== Tugas =====
router.get('/:projectId/tasks', requireAuth, (req, res) => {
  const tasks = db.prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY sort_order, id').all(req.project.id);
  const assignData = db.prepare(
    `SELECT ra.*, r.name AS resource_name, r.role AS resource_role, r.is_active AS resource_active
     FROM resource_assignments ra JOIN resources r ON r.id = ra.resource_id
     JOIN tasks t ON t.id = ra.task_id WHERE t.project_id = ?`
  ).all(req.project.id);
  const deps = db.prepare(
    `SELECT td.*, tp.name AS predecessor_name, ts.name AS successor_name
     FROM task_dependencies td JOIN tasks tp ON tp.id = td.predecessor_id JOIN tasks ts ON ts.id = td.successor_id
     WHERE td.project_id = ?`
  ).all(req.project.id);
  const byTask = new Map();
  void byTask;
  const assignmentsByTask = {};
  for (const a of assignData) {
    (assignmentsByTask[a.task_id] = assignmentsByTask[a.task_id] || []).push(a);
  }
  res.json({ tasks, dependencies: deps, assignments: assignmentsByTask });
});

// Buat tugas
router.post('/:projectId/tasks', requireAuth, (req, res) => {
  if (!canManageProject(req.user, req.project)) {
    return res.status(403).json({ error: 'Hanya admin atau manajer proyek ini yang dapat membuat tugas.' });
  }
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'Nama tugas wajib diisi.' });
  const parent = b.parent_task_id ? db.prepare('SELECT * FROM tasks WHERE id = ? AND project_id = ?')
    .get(b.parent_task_id, req.project.id) : null;
  if (b.parent_task_id && !parent) return res.status(400).json({ error: 'Tugas induk tidak valid (harus dari proyek yang sama).' });
  const duration = parseInt(b.duration ?? 1, 10);
  if (!Number.isInteger(duration) || duration < 1 || duration > 3650) return res.status(400).json({ error: 'Durasi harus angka positif 1-3650 (hari kerja).' });
  const priority = b.priority ?? 'Sedang';
  if (!PRIORITIES.includes(priority)) return res.status(400).json({ error: 'Prioritas tidak valid.' });
  const status = b.status ?? 'Belum Dimulai';
  if (!TASK_STATUSES.includes(status)) return res.status(400).json({ error: 'Status tugas tidak valid.' });
  const progress = Math.min(100, Math.max(0, Number(b.progress ?? 0)));
  if (!Number.isFinite(progress)) return res.status(400).json({ error: 'Persentase progres harus antara 0 dan 100.' });
  const plannedStart = b.planned_start ?? req.project.start_date;
  if (!isYmd(plannedStart)) return res.status(400).json({ error: 'Tanggal mulai tugas tidak valid (format YYYY-MM-DD dgn tanggal nyata).' });

  const r = db.prepare(
    `INSERT INTO tasks (project_id, parent_task_id, name, description, planned_start, duration, priority, status, progress, sort_order, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    req.project.id, parent ? parent.id : null, b.name.trim(), b.description || '',
    plannedStart, duration, priority, status, progress,
    b.sort_order ?? 0, b.notes || ''
  );
  if (parent) {
    // tugas induk jadwalnya otomatis dari anak-anaknya
    db.prepare('UPDATE tasks SET planned_start = COALESCE(planned_start, ?) WHERE id = ?')
      .run(req.project.start_date, parent.id);
  }
  const resched = rescheduleProject(db, req.project.id);
  const created = db.prepare('SELECT * FROM tasks WHERE id = ?').get(r.lastInsertRowid);
  res.status(201).json({ task: created, conflict: resched.info.get(created.id).conflict, message: 'Tugas berhasil dibuat.' });
});

// Ubah tugas
router.put('/:projectId/tasks/:taskId', requireAuth, (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND project_id = ?')
    .get(req.params.taskId, req.project.id);
  if (!task) return res.status(404).json({ error: 'Tugas tidak ditemukan.' });

  const b = req.body || {};
  const isManager = canManageProject(req.user, req.project);
  // Anggota tim hanya boleh memperbarui progres/status tugas yang ditugaskan kepadanya
  if (!isManager) {
    if (req.user.role !== 'member') return res.status(403).json({ error: 'Tidak punya izin.' });
    const allowed = db.prepare(
      `SELECT 1 FROM resource_assignments ra JOIN resources r ON r.id = ra.resource_id
       WHERE ra.task_id = ? AND r.user_id = ?`
    ).get(task.id, req.user.id);
    if (!allowed) return res.status(403).json({ error: 'Anda tidak dapat memperbarui tugas yang tidak ditugaskan ke Anda.' });
    const restrictedKeys = Object.keys(b).filter((k) => !['progress', 'status'].includes(k));
    if (restrictedKeys.length) {
      return res.status(403).json({ error: 'Anggota hanya boleh memperbarui progres dan status tugas.' });
    }
  }

  if (b.name !== undefined && !String(b.name).trim()) return res.status(400).json({ error: 'Nama tugas tidak boleh kosong.' });
  if (b.duration !== undefined) {
    const dur = parseInt(b.duration, 10);
    if (!Number.isInteger(dur) || dur < 1 || dur > 3650) return res.status(400).json({ error: 'Durasi harus angka positif 1-3650 (hari kerja).' });
  }
  if (b.planned_start !== undefined && b.planned_start !== null && !isYmd(b.planned_start)) {
    return res.status(400).json({ error: 'Tanggal mulai tugas tidak valid (format YYYY-MM-DD dgn tanggal nyata).' });
  }
  if (b.priority && !PRIORITIES.includes(b.priority)) return res.status(400).json({ error: 'Prioritas tidak valid.' });
  if (b.status && !TASK_STATUSES.includes(b.status)) return res.status(400).json({ error: 'Status tugas tidak valid.' });
  if (b.progress !== undefined) {
    const prog = Number(b.progress);
    if (!Number.isFinite(prog) || prog < 0 || prog > 100) return res.status(400).json({ error: 'Persentase progres harus antara 0 dan 100.' });
    // aturan konsistensi: progres 100% berarti status selesai
    if (Number(prog) === 100 && b.status !== undefined && b.status !== 'Selesai') {
      return res.status(400).json({ error: 'Progres 100% hanya boleh bersama status "Selesai".' });
    }
  }

  // tugas induk: durasi/planned_start dikendalikan anak-anak
  const hasChildren = !!db.prepare('SELECT 1 FROM tasks WHERE parent_task_id = ?').get(task.id);
  const setCols = [];
  const setVals = [];
  const allowedKeys = ['name', 'description', 'planned_start', 'duration', 'priority', 'status', 'progress', 'sort_order', 'notes'];
  for (const k of allowedKeys) {
    if (b[k] !== undefined && !(hasChildren && (k === 'duration' || k === 'planned_start'))) {
      setCols.push(`${k} = ?`);
      setVals.push(b[k]);
    }
  }
  if (setCols.length) {
    db.prepare(`UPDATE tasks SET ${setCols.join(', ')}, updated_at = datetime('now','localtime') WHERE id = ?`)
      .run(...setVals, task.id);
    if (b.progress !== undefined || b.status !== undefined) {
      db.prepare('INSERT INTO task_progress_history (task_id, progress, status, changed_by) VALUES (?, ?, ?, ?)')
        .run(task.id, b.progress ?? task.progress, b.status ?? task.status, req.user.id);
    }
  }
  const resched = rescheduleProject(db, req.project.id);
  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id);
  res.json({ task: updated, conflict: resched.info.get(task.id).conflict, message: 'Tugas berhasil diperbarui.' });
});

// Hapus tugas — dependensi yang terkait juga dihapus (tidak ada data yatim)
router.delete('/:projectId/tasks/:taskId', requireAuth, (req, res) => {
  if (!canManageProject(req.user, req.project)) return res.status(403).json({ error: 'Tidak punya izin.' });
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND project_id = ?').get(req.params.taskId, req.project.id);
  if (!task) return res.status(404).json({ error: 'Tugas tidak ditemukan.' });
  db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
  // hapus juga dependensi yang melekat (FK cascade sudah menangani, tapi eksplisit untuk jelas)
  db.prepare('DELETE FROM task_dependencies WHERE predecessor_id = ? OR successor_id = ?').run(task.id, task.id);
  rescheduleProject(db, req.project.id);
  res.json({ ok: true, message: 'Tugas berhasil dihapus.' });
});

// Reorder tugas
router.post('/:projectId/tasks/reorder', requireAuth, (req, res) => {
  if (!canManageProject(req.user, req.project)) return res.status(403).json({ error: 'Tidak punya izin.' });
  const { order } = req.body || {}; // [taskId,...]
  if (!Array.isArray(order)) return res.status(400).json({ error: 'Data urutan tidak valid.' });
  const stmt = db.prepare('UPDATE tasks SET sort_order = ? WHERE id = ? AND project_id = ?');
  const tx = db.transaction(() => {
    order.forEach((id, i) => stmt.run(i, id, req.project.id));
  });
  tx();
  rescheduleProject(db, req.project.id);
  res.json({ ok: true, message: 'Urutan tugas diperbarui.' });
});

// ===== Dependensi =====
router.get('/:projectId/dependencies', requireAuth, (req, res) => {
  const deps = db.prepare(
    `SELECT td.*, tp.name AS predecessor_name, ts.name AS successor_name
     FROM task_dependencies td JOIN tasks tp ON tp.id = td.predecessor_id JOIN tasks ts ON ts.id = td.successor_id
     WHERE td.project_id = ? ORDER BY td.id`
  ).all(req.project.id);
  res.json(deps);
});

router.post('/:projectId/dependencies', requireAuth, (req, res) => {
  if (!canManageProject(req.user, req.project)) {
    return res.status(403).json({ error: 'Hanya admin atau manajer proyek ini yang dapat mengatur dependensi.' });
  }
  const b = req.body || {};
  const { predecessor_id: predId, successor_id: succId } = b;
  const type = b.type ?? 'FS';
  const lag = parseInt(b.lag ?? 0, 10);
  if (!['FS', 'SS'].includes(type)) return res.status(400).json({ error: 'Jenis dependensi harus FS atau SS.' });
  if (!Number.isFinite(lag) || lag < 0) return res.status(400).json({ error: 'Lag harus angka valid (>= 0 hari kerja).' });
  if (!predId || !succId) return res.status(400).json({ error: 'Tugas pendahulu dan penerus wajib dipilih.' });
  if (predId === succId) return res.status(400).json({ error: 'Tugas tidak boleh bergantung pada dirinya sendiri.' });

  const pred = db.prepare('SELECT * FROM tasks WHERE id = ? AND project_id = ?').get(predId, req.project.id);
  const succ = db.prepare('SELECT * FROM tasks WHERE id = ? AND project_id = ?').get(succId, req.project.id);
  if (!pred || !succ) {
    return res.status(400).json({ error: 'Tugas pendahulu dan penerus harus berasal dari proyek yang sama.' });
  }
  const dup = db.prepare('SELECT 1 FROM task_dependencies WHERE predecessor_id = ? AND successor_id = ?').get(predId, succId);
  if (dup) return res.status(400).json({ error: 'Dependensi antartugas tersebut sudah ada.' });

  const deps = dependensiProjectOk(db, req.project.id);
  if (createsCycle(deps, predId, succId)) {
    return res.status(400).json({ error: 'Hubungan ini membentuk siklus dependensi dan ditolak. Hapus atau ubah dependensi lain terlebih dahulu.' });
  }
  db.prepare('INSERT INTO task_dependencies (project_id, predecessor_id, successor_id, type, lag, notes) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.project.id, predId, succId, type, lag, b.notes || '');
  rescheduleProject(db, req.project.id);
  res.status(201).json({ ok: true, message: 'Dependensi ditambahkan dan jadwal dihitung ulang.' });
});
function dependensiProjectOk(dbObj, projectId) {
  return dbObj.prepare('SELECT successor_id, predecessor_id FROM task_dependencies WHERE project_id = ?').all(projectId);
}

router.put('/:projectId/dependencies/:depId', requireAuth, (req, res) => {
  if (!canManageProject(req.user, req.project)) return res.status(403).json({ error: 'Tidak punya izin.' });
  const dep = db.prepare('SELECT * FROM task_dependencies WHERE id = ? AND project_id = ?')
    .get(req.params.depId, req.project.id);
  if (!dep) return res.status(404).json({ error: 'Dependensi tidak ditemukan.' });
  const b = req.body || {};
  const type = b.type ?? dep.type;
  const lag = b.lag !== undefined ? parseInt(b.lag, 10) : dep.lag;
  if (!['FS', 'SS'].includes(type)) return res.status(400).json({ error: 'Jenis dependensi harus FS atau SS.' });
  if (!Number.isFinite(lag) || lag < 0) return res.status(400).json({ error: 'Lag harus angka valid (>= 0 hari kerja).' });
  db.prepare('UPDATE task_dependencies SET type = ?, lag = ?, notes = ? WHERE id = ?')
    .run(type, lag, b.notes ?? dep.notes, dep.id);
  rescheduleProject(db, req.project.id);
  res.json({ ok: true, message: 'Dependensi diperbarui.' });
});

router.delete('/:projectId/dependencies/:depId', requireAuth, (req, res) => {
  if (!canManageProject(req.user, req.project)) return res.status(403).json({ error: 'Tidak punya izin.' });
  const dep = db.prepare('SELECT * FROM task_dependencies WHERE id = ? AND project_id = ?')
    .get(req.params.depId, req.project.id);
  if (!dep) return res.status(404).json({ error: 'Dependensi tidak ditemukan.' });
  db.prepare('DELETE FROM task_dependencies WHERE id = ?').run(dep.id);
  rescheduleProject(db, req.project.id);
  res.json({ ok: true, message: 'Dependensi dihapus.' });
});

module.exports = router;
