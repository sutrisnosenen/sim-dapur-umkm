// Rute analisis: dashboard, jalur kritis, data untuk Gantt & PERT, Resource Chart, laporan.
const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { requireAuth, canAccessProject, canManageProject } = require('../auth');
const { analyzeCriticalPath, rescheduleProject, getProjectTasks, getProjectDeps } = require('../scheduler');
const { makeCalendar, loadCalendarData } = require('../calendar');
const { getAssignmentConflicts } = require('./resources');

// semua rute analisis memerlukan login
router.use(requireAuth);

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

router.use('/:projectId', (req, res, next) => {
  // hanya proyeksi pada endpoint dengan ID proyek numerik; path lain (mis. /dashboard) dilewati
  if (!/^\d+$/.test(req.params.projectId)) return next();
  req.project = getProjectOr404(req, res);
  if (req.project) next();
});

// Keterlambatan tugas: tanggal akhir tugas berjalan sudah lewat dan belum selesai
function lateTasks(tasks, today) {
  return tasks.filter((t) =>
    (t.status === 'Berjalan' || t.status === 'Belum Dimulai' || t.status === 'Terhambat') &&
    t.end_date && t.end_date < today
  );
}

// GET /api/analysis/dashboard
router.get('/dashboard', requireAuth, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  let projects, taskRows;
  if (req.user.role === 'admin') {
    projects = db.prepare('SELECT * FROM projects').all();
    taskRows = db.prepare('SELECT t.* FROM tasks t').all();
  } else if (req.user.role === 'manager') {
    projects = db.prepare('SELECT * FROM projects WHERE manager_id = ?').all(req.user.id);
    const ids = projects.map((p) => p.id);
    taskRows = ids.length ? db.prepare(`SELECT t.* FROM tasks t WHERE t.project_id IN (${ids.map(() => '?').join(',')})`).all(...ids) : [];
  } else {
    projects = db.prepare(
      'SELECT p.* FROM projects p WHERE p.id IN (SELECT project_id FROM project_members WHERE user_id = ?)'
    ).all(req.user.id);
    const ids = projects.map((p) => p.id);
    taskRows = ids.length ? db.prepare(`SELECT t.* FROM tasks t WHERE t.project_id IN (${ids.map(() => '?').join(',')})`).all(...ids) : [];
  }
  const count = (arr, status) => arr.filter((t) => t.status === status).length;
  const severity = taskRows.filter((t) => t.end_date && t.end_date < today && ['Berjalan', 'Belum Dimulai', 'Terhambat'].includes(t.status));
  const upcoming = taskRows
    .filter((t) => t.start_date && t.start_date >= today && t.status !== 'Selesai' && t.status !== 'Dibatalkan')
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
    .slice(0, 5)
    .map((t) => ({ ...t, project_name: (projects.find((p) => p.id === t.project_id) || {}).name || '' }));
  res.json({
    projects: {
      total: projects.length,
      berjalan: count(projects, 'Berjalan'),
      selesai: count(projects, 'Selesai'),
      ditunda: count(projects, 'Ditunda'),
      perencanaan: count(projects, 'Perencanaan'),
    },
    tasks: {
      total: taskRows.length,
      belum_mulai: count(taskRows, 'Belum Dimulai'),
      berjalan: count(taskRows, 'Berjalan'),
      terhambat: count(taskRows, 'Terhambat'),
      selesai: count(taskRows, 'Selesai'),
      terlambat: lateTasks(taskRows, today).length,
    },
    upcoming,
    today,
  });
});

// GET /api/analysis/:projectId/critical-path — analisis jalur kritis
router.get('/:projectId/critical-path', requireAuth, (req, res) => {
  rescheduleProject(db, req.project.id); // pastikan data tak basi
  const result = analyzeCriticalPath(db, req.project.id);
  res.json(result);
});

// GET /api/analysis/:projectId/gantt — data gantt lengkap
router.get('/:projectId/gantt', requireAuth, (req, res) => {
  rescheduleProject(db, req.project.id);
  const tasks = getProjectTasks(db, req.project.id);
  const deps = db.prepare(
    `SELECT td.*, tp.name AS predecessor_name, ts.name AS successor_name
     FROM task_dependencies td JOIN tasks tp ON tp.id = td.predecessor_id JOIN tasks ts ON ts.id = td.successor_id
     WHERE td.project_id = ?`
  ).all(req.project.id);
  const assignments = db.prepare(
    `SELECT ra.task_id, ra.allocation, r.name AS resource_name
     FROM resource_assignments ra JOIN resources r ON r.id = ra.resource_id
     JOIN tasks t ON t.id = ra.task_id WHERE t.project_id = ?`
  ).all(req.project.id);
  const cp = analyzeCriticalPath(db, req.project.id);
  const criticalSet = new Set((cp.ok ? cp.criticalTasks : []).map((t) => t.id));
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.project.id);
  res.json({
    project,
    tasks: tasks.map((t) => ({ ...t, critical: criticalSet.has(t.id) })),
    dependencies: deps,
    assignments: assignments,
    estimated_finish: cp.ok ? cp.estimatedFinish : null,
    critical_ok: cp.ok,
    critical_reason: cp.ok ? null : (cp.reason || null),
  });
});

// GET /api/analysis/:projectId/pert — data jaringan untuk PERT chart (sama struktur dengan gantt)
router.get('/:projectId/pert', requireAuth, (req, res) => {
  rescheduleProject(db, req.project.id);
  const tasks = getProjectTasks(db, req.project.id);
  const deps = getProjectDeps(db, req.project.id);
  const cp = analyzeCriticalPath(db, req.project.id);
  const criticalSet = new Set((cp.ok ? cp.criticalTasks : []).map((t) => t.id));
  res.json({
    tasks: tasks.map((t) => ({ ...t, critical: criticalSet.has(t.id) })),
    dependencies: deps,
    ok: cp.ok,
    reason: cp.ok ? null : (cp.reason || null),
  });
});

// GET /api/analysis/:projectId/resource-chart — beban kerja sumber daya
router.get('/:projectId/resource-chart', requireAuth, (req, res) => {
  rescheduleProject(db, req.project.id);
  const project = req.project;
  const cal = makeCalendar(loadCalendarData(db, project.id));
  const tasks = getProjectTasks(db, project.id);
  const taskNames = new Map(tasks.map((t) => [t.id, t]));
  const assignments = db.prepare(
    `SELECT ra.*, r.name AS resource_name, r.role AS resource_role, r.is_active AS resource_active,
            r.rate AS resource_rate, r.rate_unit AS resource_rate_unit
     FROM resource_assignments ra JOIN resources r ON r.id = ra.resource_id
     JOIN tasks t ON t.id = ra.task_id
     WHERE t.project_id = ?`
  ).all(project.id);

  // batas waktu charter: min start s/d max end tugas proyek
  const dates = tasks.map((t) => [t.start_date, t.end_date]).flat().filter(Boolean);
  if (!dates.length) {
    return res.json({ empty: true, message: 'Belum ada tugas berjadwal untuk membentuk Resource Chart.' });
  }
  const rangeStart = dates.reduce((a, b) => (a < b ? a : b));
  const rangeEnd = dates.reduce((a, b) => (a > b ? a : b));
  const days = [];
  let cur = rangeStart;
  while (cur <= rangeEnd) {
    days.push(cur);
    const d = new Date(cur);
    d.setDate(d.getDate() + 1);
    cur = d.toISOString().slice(0, 10);
  }

  // beban per anggota per hari (hanya hari kerja proyek); libur proyek tidak menambah beban
  const perResource = {};
  const resourceIds = new Set();
  for (const a of assignments) {
    const task = taskNames.get(a.task_id);
    const start = a.start_date || task.start_date;
    const end = a.end_date || task.end_date;
    if (!start || !end) continue;
    resourceIds.add(a.resource_id);
    (perResource[a.resource_id] = perResource[a.resource_id] || {
      resource_id: a.resource_id,
      resource_name: a.resource_name,
      resource_role: a.resource_role,
      resource_active: a.resource_active,
      rate: a.resource_rate,
      rate_unit: a.resource_rate_unit,
      total_days: 0,
      estimated_cost: 0,
      assignments: [],
      utilization: {}, // tanggal -> persen
    }).assignments.push({
      assignment_id: a.id,
      allocation: a.allocation,
      task_id: a.task_id,
      task_name: task.name,
      start, end,
    });
  }

  for (const [resId, info] of Object.entries(perResource)) {
    // hitung pemanfaatan harian
    const util = {};
    for (const a of info.assignments) {
      let d = new Date(a.start);
      const end = new Date(a.end);
      while (d <= end) {
        const ds = d.toISOString().slice(0, 10);
        if (cal.isWorkday(ds)) {
          util[ds] = (util[ds] || 0) + Number(a.allocation || 0);
          info.total_days += Number(a.allocation || 0) / 100;
        }
        d.setDate(d.getDate() + 1);
      }
    }
    info.utilization = util;
    // konflik beban berlebih
    const conflict = getAssignmentConflicts(Number(resId), null);
    info.conflicts = {
      overallocationDays: conflict.overallocationDays.filter((c) => c.date >= rangeStart && c.date <= rangeEnd),
      unavailabilityConflicts: conflict.unavailabilityConflicts,
      inactive: conflict.inactive,
    };
    // estimasi biaya: tarif harian dikali jumlah hari kerja efektif; tarif bulanan dikonversi /21 hari kerja
    const dailyRate = info.rate_unit === 'bulan' ? Number(info.rate) / 21 : Number(info.rate);
    info.estimated_cost = Math.round(dailyRate * info.total_days);
  }

  const unavail = db.prepare(
    `SELECT ru.*, r.name AS resource_name FROM resource_unavailability ru JOIN resources r ON r.id = ru.resource_id
     WHERE ru.start_date <= ? AND ru.end_date >= ? AND r.id IN (${[...resourceIds].join(',') || 'NULL'})`
  ).all(rangeEnd, rangeStart);
  res.json({ rangeStart, rangeEnd, days, resources: Object.values(perResource), unavailabilities: unavail });
});

// GET /api/analysis/:projectId/report — laporan ringkasan proyek
router.get('/:projectId/report', requireAuth, (req, res) => {
  rescheduleProject(db, req.project.id);
  const p = req.project;
  const cal = makeCalendar(loadCalendarData(db, p.id));
  const today = new Date().toISOString().slice(0, 10);
  const tasks = getProjectTasks(db, p.id);
  const cp = analyzeCriticalPath(db, p.id);
  const criticalMap = new Map((cp.ok ? cp.criticalTasks : []).map((t) => [t.id, t]));
  const manager = db.prepare('SELECT full_name FROM users WHERE id = ?').get(p.manager_id);
  const members = db.prepare(
    `SELECT u.full_name, u.username, pm.role_label FROM project_members pm JOIN users u ON u.id = pm.user_id WHERE pm.project_id = ?`
  ).all(p.id);
  const assignments = db.prepare(
    `SELECT ra.*, r.name AS resource_name, t.name AS task_name FROM resource_assignments ra
     JOIN resources r ON r.id = ra.resource_id JOIN tasks t ON t.id = ra.task_id WHERE t.project_id = ?`
  ).all(p.id);
  const resourceIds = new Set(assignments.map((a) => a.resource_id));
  const resourceSummaries = [...resourceIds].map((rid) => {
    const res1 = db.prepare('SELECT * FROM resources WHERE id = ?').get(rid);
    const own = assignments.filter((a) => a.resource_id === rid);
    const conflict = getAssignmentConflicts(rid, null);
    return {
      id: rid, name: res1.name, role: res1.role, is_active: !!res1.is_active,
      assignments: own.length,
      overallocationDays: conflict.overallocationDays,
      unavailabilityConflicts: conflict.unavailabilityConflicts,
    };
  });

  const report = {
    project: {
      ...p, manager_name: manager ? manager.full_name : '-',
    },
    progress_method: 'Rata-rata progres tugas daun berbobot durasi (hari kerja) setiap tugas',
    estimated_finish: cp.ok ? cp.estimatedFinish : null,
    is_late: cp.ok ? cp.isLate : null,
    late_warning: cp.ok && cp.isLate ? 'Estimasi penyelesaian melebihi target tanggal selesai proyek.' : null,
    counts: {
      total_tasks: tasks.length,
      completed: tasks.filter((t) => t.status === 'Selesai').length,
      running: tasks.filter((t) => t.status === 'Berjalan').length,
      blocked: tasks.filter((t) => t.status === 'Terhambat').length,
      late: lateTasks(tasks, today).length,
      critical: criticalMap.size,
    },
    tasks: tasks.map((t) => ({
      id: t.id, name: t.name, start_date: t.start_date, end_date: t.end_date,
      duration: t.duration, status: t.status, priority: t.priority, progress: t.progress,
      critical: criticalMap.has(t.id), late: t.end_date < today && ['Berjalan', 'Belum Dimulai', 'Terhambat'].includes(t.status),
    })),
    critical_reason: cp.ok ? null : (cp.reason || null),
    critical_path: cp.ok && cp.criticalPaths[0] ? cp.criticalPaths[0].map((n) => ({ id: n.id, name: n.name, start: n.start, end: n.end })) : [],
    members,
    assignments,
    resource_summaries: resourceSummaries,
  };
  void cal;
  res.json(report);
});

// GET /api/analysis/:projectId/report.csv — ekspor CSV laporan
router.get('/:projectId/report.csv', requireAuth, (req, res) => {
  const project = req.project;
  rescheduleProject(db, project.id);
  const tasks = getProjectTasks(db, project.id);
  const today = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="laporan-proyek-${project.id}.csv"`);
  res.write('Nama Tugas;Tanggal Mulai;Tanggal Selesai;Durasi (hari kerja);Status;Prioritas;Progres (%);Kritis;Terlambat\n');
  for (const t of tasks) {
    res.write([
      t.name.replace(/;/g, ','), t.start_date, t.end_date, t.duration, t.status, t.priority, t.progress,
      t.status === 'Selesai' ? '' : '', t.end_date < today && ['Berjalan', 'Belum Dimulai', 'Terhambat'].includes(t.status) ? 'Ya' : 'Tidak',
    ].join(';') + '\n');
  }
  void today;
  res.end();
});

module.exports = router;
