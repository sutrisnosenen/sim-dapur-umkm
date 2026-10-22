// Rute sumber daya (anggota tim), ketidakhadiran pribadi, dan penugasan.
const express = require('express');
const router = express.Router();
const { db, touch } = require('../db');
const { requireAuth, requireRole, canAccessProject, canManageProject } = require('../auth');
const { makeCalendar, loadCalendarData, toDate, toStr, addDays, isYmd } = require('../calendar');

// ===== CRUD sumber daya =====
router.get('/', requireAuth, (req, res) => {
  const { q, status } = req.query;
  let rows = db.prepare('SELECT * FROM resources ORDER BY name').all();
  if (status === 'aktif') rows = rows.filter((r) => r.is_active);
  if (status === 'nonaktif') rows = rows.filter((r) => !r.is_active);
  if (q) rows = rows.filter((r) => (r.name + ' ' + r.role).toLowerCase().includes(String(q).toLowerCase()));
  res.json(rows);
});

router.post('/', requireAuth, requireRole('admin', 'manager'), (req, res) => {
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'Nama anggota wajib diisi.' });
  const rate = Number(b.rate ?? 0);
  if (!Number.isFinite(rate) || rate < 0) return res.status(400).json({ error: 'Tarif/gaji harus angka yang valid.' });
  if (!['hari', 'bulan'].includes(b.rate_unit || 'hari')) return res.status(400).json({ error: 'Satuan tarif harus "hari" atau "bulan".' });
  if (b.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email)) return res.status(400).json({ error: 'Format email tidak valid.' });
  const r = db.prepare(
    `INSERT INTO resources (user_id, name, phone, email, role, rate, rate_unit, is_active, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    b.user_id || null, b.name.trim(), b.phone || '', b.email || '', b.role || '',
    rate, b.rate_unit || 'hari', b.is_active === undefined ? 1 : (b.is_active ? 1 : 0), b.notes || ''
  );
  res.status(201).json({ id: r.lastInsertRowid, message: 'Anggota tim berhasil ditambahkan.' });
});

// (:id dibatasi angka agar tidak menelan rute sub-sumber seperti /assignments)
router.get('/:id(\d+)', requireAuth, (req, res) => {
  const res1 = db.prepare('SELECT * FROM resources WHERE id = ?').get(req.params.id);
  if (!res1) return res.status(404).json({ error: 'Anggota tim tidak ditemukan.' });
  const assignments = db.prepare(
    `SELECT ra.*, t.name AS task_name, t.project_id, p.name AS project_name
     FROM resource_assignments ra JOIN tasks t ON t.id = ra.task_id JOIN projects p ON p.id = t.project_id
     WHERE ra.resource_id = ? ORDER BY COALESCE(ra.start_date, t.start_date)`
  ).all(req.params.id);
  const unavailability = db.prepare('SELECT * FROM resource_unavailability WHERE resource_id = ? ORDER BY start_date').all(req.params.id);
  res.json({ ...res1, assignments, unavailability });
});

router.put('/:id', requireAuth, requireRole('admin', 'manager'), (req, res) => {
  const row = db.prepare('SELECT * FROM resources WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Anggota tim tidak ditemukan.' });
  const b = req.body || {};
  if (b.name !== undefined && !String(b.name).trim()) return res.status(400).json({ error: 'Nama anggota tidak boleh kosong.' });
  if (b.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email)) return res.status(400).json({ error: 'Format email tidak valid.' });
  if (b.rate !== undefined) {
    const rate = Number(b.rate);
    if (!Number.isFinite(rate) || rate < 0) return res.status(400).json({ error: 'Tarif/gaji harus angka yang valid.' });
  }
  db.prepare(
    `UPDATE resources SET user_id = ?, name = ?, phone = ?, email = ?, role = ?, rate = ?, rate_unit = ?, is_active = ?, notes = ?,
     updated_at = datetime('now','localtime') WHERE id = ?`
  ).run(
    b.user_id ?? row.user_id, b.name ?? row.name, b.phone ?? row.phone, b.email ?? row.email,
    b.role ?? row.role, b.rate ?? row.rate, b.rate_unit ?? row.rate_unit,
    b.is_active === undefined ? row.is_active : (b.is_active ? 1 : 0), b.notes ?? row.notes,
    req.params.id
  );
  res.json({ ok: true, message: 'Data anggota tim diperbarui.' });
});

router.post('/:id/deactivate', requireAuth, requireRole('admin', 'manager'), (req, res) => {
  db.prepare('UPDATE resources SET is_active = 0, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?').run(req.params.id);
  res.json({ ok: true, message: 'Anggota tim dinonaktifkan.' });
});

// ===== Ketidakhadiran pribadi =====
router.post('/:id/unavailability', requireAuth, requireRole('admin', 'manager'), (req, res) => {
  const row = db.prepare('SELECT * FROM resources WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Anggota tim tidak ditemukan.' });
  const { start_date: startDate, end_date: endDate, reason, approval_status: approval } = req.body || {};
  if (!startDate || !endDate || !reason) return res.status(400).json({ error: 'Tanggal mulai, tanggal selesai, dan alasan wajib diisi.' });
  if (!isYmd(startDate) || !isYmd(endDate)) return res.status(400).json({ error: 'Tanggal ketidakhadiran tidak valid.' });
  if (new Date(endDate) < new Date(startDate)) return res.status(400).json({ error: 'Tanggal selesai tidak boleh sebelum tanggal mulai.' });
  const r = db.prepare(
    'INSERT INTO resource_unavailability (resource_id, start_date, end_date, reason, approval_status) VALUES (?, ?, ?, ?, ?)'
  ).run(req.params.id, startDate, endDate, reason, approval || 'Disetujui');
  res.status(201).json({ id: r.lastInsertRowid, message: 'Ketidakhadiran pribadi dicatat.' });
});

router.put('/unavailability/:uaId', requireAuth, requireRole('admin', 'manager'), (req, res) => {
  const ua = db.prepare('SELECT * FROM resource_unavailability WHERE id = ?').get(req.params.uaId);
  if (!ua) return res.status(404).json({ error: 'Data ketidakhadiran tidak ditemukan.' });
  const b = req.body || {};
  if ((b.start_date && !isYmd(b.start_date)) || (b.end_date && !isYmd(b.end_date))) {
    return res.status(400).json({ error: 'Tanggal ketidakhadiran tidak valid.' });
  }
  db.prepare('UPDATE resource_unavailability SET start_date = ?, end_date = ?, reason = ?, approval_status = ? WHERE id = ?')
    .run(b.start_date ?? ua.start_date, b.end_date ?? ua.end_date, b.reason ?? ua.reason, b.approval_status ?? ua.approval_status, ua.id);
  res.json({ ok: true, message: 'Data ketidakhadiran diperbarui.' });
});

router.delete('/unavailability/:uaId', requireAuth, requireRole('admin', 'manager'), (req, res) => {
  const ua = db.prepare('SELECT * FROM resource_unavailability WHERE id = ?').get(req.params.uaId);
  if (!ua) return res.status(404).json({ error: 'Data ketidakhadiran tidak ditemukan.' });
  db.prepare('DELETE FROM resource_unavailability WHERE id = ?').run(ua.id);
  res.json({ ok: true, message: 'Data ketidakhadiran dihapus.' });
});

// ===== Penugasan =====
router.get('/assignments', requireAuth, (req, res) => {
  const mine = req.user.role === 'member';
  let sql = `SELECT ra.*, t.name AS task_name, t.status AS task_status, t.project_id, p.name AS project_name, r.name AS resource_name
     FROM resource_assignments ra JOIN tasks t ON t.id = ra.task_id JOIN projects p ON p.id = t.project_id
     JOIN resources r ON r.id = ra.resource_id`;
  const params = [];
  if (mine) {
    sql += ' WHERE r.user_id = ?';
    params.push(req.user.id);
  } else if (req.query.project_id) {
    sql += ' WHERE t.project_id = ?';
    params.push(req.query.project_id);
  }
  sql += ' ORDER BY COALESCE(ra.start_date, t.start_date)';
  res.json(db.prepare(sql).all(...params));
});

// Helper deteksi konflik penugasan (dipanggil oleh server untuk data resource chart juga)
function getAssignmentConflicts(resId, includeAssignment) {
  const ca = db.prepare(
    `SELECT ra.*, t.name AS task_name, t.start_date AS task_start, t.end_date AS task_end
     FROM resource_assignments ra JOIN tasks t ON t.id = ra.task_id
     WHERE ra.resource_id = ?`
  ).all(resId);
  const unav = db.prepare("SELECT * FROM resource_unavailability WHERE resource_id = ? AND (approval_status IS NULL OR approval_status != 'Ditolak')").all(resId);
  const resource = db.prepare('SELECT * FROM resources WHERE id = ?').get(resId);
  const warnings = { overallocationDays: [], unavailabilityConflicts: [], inactive: !!resource && !resource.is_active };
  // Nilai per hari kerja: jumlah alokasi tugas yang aktif pada hari itu
  const perDay = {};
  for (const a of ca) {
    const start = a.start_date || a.task_start;
    const end = a.end_date || a.task_end;
    if (!start || !end) continue;
    let d = toDate(start);
    const stop = toDate(end);
    while (d <= stop) {
      const key = toStr(d);
      perDay[key] = (perDay[key] || 0) + Number(a.allocation || 0);
      d = addDays(d, 1);
    }
  }
  for (const [day, total] of Object.entries(perDay)) {
    if (total > 100) warnings.overallocationDays.push({ date: day, total });
  }
  for (const a of ca) {
    const start = a.start_date || a.task_start;
    const end = a.end_date || a.task_end;
    if (!start || !end) continue;
    for (const u of unav) {
      if (start <= u.end_date && end >= u.start_date) {
        warnings.unavailabilityConflicts.push({
          assignment_id: a.id, task_name: a.task_name,
          unavailability_start: u.start_date, unavailability_end: u.end_date, reason: u.reason,
        });
      }
    }
  }
  return warnings;
}

router.post('/assignments', requireAuth, (req, res) => {
  const b = req.body || {};
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(b.task_id);
  if (!task) return res.status(400).json({ error: 'Tugas tidak ditemukan.' });
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(task.project_id);
  if (!canManageProject(req.user, project)) {
    return res.status(403).json({ error: 'Hanya admin atau manajer proyek ini yang dapat mengatur penugasan.' });
  }
  const resource = db.prepare('SELECT * FROM resources WHERE id = ?').get(b.resource_id);
  if (!resource) return res.status(400).json({ error: 'Anggota tim tidak ditemukan.' });
  const allocation = Number(b.allocation ?? 100);
  if (!Number.isFinite(allocation) || allocation <= 0 || allocation > 100) {
    return res.status(400).json({ error: 'Alokasi kerja harus antara >0 dan 100.' });
  }
  if (b.start_date && b.end_date && new Date(b.end_date) < new Date(b.start_date)) {
    return res.status(400).json({ error: 'Tanggal selesai penugasan tidak boleh sebelum tanggal mulai.' });
  }
  if ((b.start_date && !isYmd(b.start_date)) || (b.end_date && !isYmd(b.end_date))) {
    return res.status(400).json({ error: 'Tanggal penugasan tidak valid.' });
  }
  const r = db.prepare(
    `INSERT INTO resource_assignments (task_id, resource_id, role_on_task, allocation, start_date, end_date, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(b.task_id, b.resource_id, b.role_on_task || '', allocation, b.start_date || null, b.end_date || null, b.notes || '');

  // Pemeriksaan konflik (tidak otomatis mengubah penugasan — hanya peringatan)
  const conflict = getAssignmentConflicts(b.resource_id, null);
  res.status(201).json({ id: r.lastInsertRowid, warnings: conflict, message: 'Penugasan dibuat.' });
});

router.put('/assignments/:id', requireAuth, (req, res) => {
  const a = db.prepare('SELECT * FROM resource_assignments WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Penugasan tidak ditemukan.' });
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(a.task_id);
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(task.project_id);
  if (!canManageProject(req.user, project)) return res.status(403).json({ error: 'Tidak punya izin.' });
  const b = req.body || {};
  if (b.allocation !== undefined) {
    const allocation = Number(b.allocation);
    if (!Number.isFinite(allocation) || allocation <= 0 || allocation > 100) {
      return res.status(400).json({ error: 'Alokasi kerja harus antara >0 dan 100.' });
    }
  }
  if ((b.start_date !== undefined && b.start_date !== null && b.start_date !== '' && !isYmd(b.start_date)) ||
      (b.end_date !== undefined && b.end_date !== null && b.end_date !== '' && !isYmd(b.end_date))) {
    return res.status(400).json({ error: 'Tanggal penugasan tidak valid.' });
  }
  db.prepare(
    'UPDATE resource_assignments SET role_on_task = ?, allocation = ?, start_date = ?, end_date = ?, notes = ? WHERE id = ?'
  ).run(b.role_on_task ?? a.role_on_task, b.allocation ?? a.allocation, b.start_date ?? a.start_date, b.end_date ?? a.end_date, b.notes ?? a.notes, a.id);
  const conflict = getAssignmentConflicts(a.resource_id, null);
  res.json({ ok: true, warnings: conflict, message: 'Penugasan diperbarui.' });
});

router.delete('/assignments/:id', requireAuth, (req, res) => {
  const a = db.prepare('SELECT * FROM resource_assignments WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Penugasan tidak ditemukan.' });
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(a.task_id);
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(task.project_id);
  if (!canManageProject(req.user, project)) return res.status(403).json({ error: 'Tidak punya izin.' });
  db.prepare('DELETE FROM resource_assignments WHERE id = ?').run(a.id);
  res.json({ ok: true, message: 'Penugasan dihapus.' });
});

module.exports = { router, getAssignmentConflicts };
