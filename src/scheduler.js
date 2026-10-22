// Modul penjadwalan proyek: forward pass, backward pass, analisis jalur kritis.
// Semua kalkulasi dilakukan dalam "ordinal hari kerja" agar akhir pekan dan hari libur
// otomatis diperhitungkan. Dependensi yang didukung: FS (Finish-to-Start) dan SS
// (Start-to-Start), dengan lag dalam HARI KERJA.

const { loadCalendarData, makeCalendar } = require('./calendar');

// ===== Validasi siklus dependensi =====
// Mengembalikan true jika menambahkan dependensi (succ bergantung pada pred)
// menciptakan siklus pada graf dependensi proyek.
function createsCycle(deps, predId, succId) {
  // Bangun graf successor -> [predecessor]; DFS dari succId mencari predId atau dirinya sendiri.
  const graph = new Map();
  for (const d of deps) {
    if (!graph.has(d.successor_id)) graph.set(d.successor_id, []);
    graph.get(d.successor_id).push(d.predecessor_id);
  }
  const target = succId === predId ? succId : predId;
  const stack = [succId];
  const seen = new Set();
  while (stack.length) {
    const node = stack.pop();
    if (node === target) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    if (graph.has(node)) stack.push(...graph.get(node));
  }
  return false;
}

// ===== Ambil data proyek untuk kalkulasi =====
function getProjectTasks(db, projectId) {
  return db.prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY sort_order, id').all(projectId);
}
function getProjectDeps(db, projectId) {
  return db.prepare('SELECT * FROM task_dependencies WHERE project_id = ?').all(projectId);
}

// ===== Forward pass =====
// dst: { targetEndOrdinal } untuk backward pass; jika null, pakai max EF.
//
// Mengembalikan { tasks: Map(id -> info), projectEF, warnings: [] }.
// info: { es (ordinal), ef (ordinal), start, end, isLeaf, critical, LS, LF, float, conflict }
function computeSchedule(cal, tasks, deps, options = {}) {
  const warnings = [];

  // identifikasi tugas daun (tanpa anak) -> disertakan dalam CPM
  const hasChildren = new Set(tasks.filter((t) => t.parent_task_id).map((t) => t.parent_task_id));
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const byId = (id) => taskMap.get(id);
  const isLeaf = (t) => !hasChildren.has(t.id);

  // durasi efektif: tugas induk dihitung dari gabungan anakannya (durasi tabel diabaikan)
  const effectiveDur = (t) => (isLeaf(t) ? Math.max(1, t.duration || 1) : 0);

  const projStart = options.projectStart;
  if (!projStart) throw new Error('Proyek belum memiliki tanggal mulai');

  // Siapkan struktur info
  const info = new Map();
  for (const t of tasks) {
    const isL = isLeaf(t);
    const anchorOrd = cal.ordinalOf(t.planned_start || projStart);
    info.set(t.id, {
      id: t.id,
      isLeaf: isL,
      duration: isL ? effectiveDur(t) : null,
      plannedOrd: anchorOrd,
      ES: isL ? anchorOrd : null,
      EF: null,
      derivedStart: null,
      derivedEnd: null,
      conflict: null,
      status: t.status,
      progress: t.progress,
      priority: t.priority,
      name: t.name,
      parent: t.parent_task_id,
    });
  }

  // urutan topologis: berulang hingga stabil (maks lewatan tugas induk yang berantai)
  const predsOf = new Map(); // taksId -> daftar dependensi yang menautkannya (successor_id = t.id)
  const succsOf = new Map(); // predecessor_id -> dependensi
  for (const d of deps) {
    if (!predsOf.has(d.successor_id)) predsOf.set(d.successor_id, []);
    predsOf.get(d.successor_id).push(d);
    if (!succsOf.has(d.predecessor_id)) succsOf.set(d.predecessor_id, []);
    succsOf.get(d.predecessor_id).push(d);
  }

  // Forward pass dalam beberapa putaran agar tugas induk (nilai EF dari anak)
  // yang menjadi pendahulu juga sudah stabil.
  let stable = false;
  for (let round = 0; round < tasks.length + 2 && !stable; round++) {
    stable = true;
    // urutkan tugas daun berdasarkan ketergantungan (Kahn-like greedy; siklus tidak boleh ada, sudah divalidasi)
    const inDegree = new Map();
    const adj = new Map();
    for (const t of tasks) {
      if (!info.get(t.id).isLeaf) continue;
      const plist = (predsOf.get(t.id) || []).filter((d) => info.get(d.predecessor_id).isLeaf || !info.get(d.predecessor_id).isLeaf);
      const usable = plist.filter((d) => byId(d.predecessor_id));
      inDegree.set(t.id, usable.length);
      adj.set(t.id, usable);
    }
    // BFS dari tugas tanpa pendahulu
    const queue = [];
    for (const [id, deg] of inDegree) if (deg === 0) queue.push(id);
    const visited = new Set();
    while (queue.length) {
      const id = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);
      const node = info.get(id);
      // ES = max(planned, constraint dari pendahulu)
      let es = node.plannedOrd;
      let fromPlanned = node.plannedOrd;
      let constraintOrd = null;
      for (const dep of adj.get(id)) {
        const pred = info.get(dep.predecessor_id);
        if (!pred) continue;
        let limit;
        if (dep.type === 'FS') {
          // pendahulu selesai + lag
          const predEF = pred.isLeaf ? pred.EF : ordinalOfDerivedEnd(pred);
          if (predEF == null) { stable = false; continue; }
          limit = predEF + 1 + (dep.lag || 0);
        } else {
          // SS: mulai bersamaan + lag
          const predES = pred.isLeaf ? pred.ES : ordinalOfDerivedStart(pred);
          if (predES == null) { stable = false; continue; }
          limit = predES + (dep.lag || 0);
        }
        if (constraintOrd == null || limit > constraintOrd) constraintOrd = limit;
      }
      if (constraintOrd != null && constraintOrd > es) {
        es = constraintOrd;
        node.conflict = {
          plannedDate: cal.dateFromOrdinal(fromPlanned),
          actualDate: cal.dateFromOrdinal(es),
        };
        stable = false;
      }
      node.ES = es;
      node.EF = es + node.duration - 1;
      node.start = cal.dateFromOrdinal(node.ES);
      node.end = cal.dateFromOrdinal(node.EF);
      // antrekan penerus
      for (const d of deps) {
        if (d.predecessor_id === id) {
          const succ = info.get(d.successor_id);
          if (succ && succ.isLeaf && !visited.has(succ.id)) queue.push(succ.id);
        }
      }
    }

    // tugas daun yang tidak terkompilasi tidak boleh ada (siklus sudah ditolak)

    // nilai tugas induk: dari min/max anak (setelah daun stabil)
    for (const t of tasks) {
      if (info.get(t.id).isLeaf) continue;
      const children = tasks.filter((c) => c.parent_task_id === t.id).map((c) => info.get(c.id));
      if (!children.length) continue;
      const starts = children.map((c) => (c.isLeaf ? c.ES : ordinalOfDerivedStart(c))).filter((v) => v != null);
      const ends = children.map((c) => (c.isLeaf ? c.EF : ordinalOfDerivedEnd(c))).filter((v) => v != null);
      const node = info.get(t.id);
      const newStart = starts.length ? Math.min(...starts) : node.plannedOrd;
      const newEnd = ends.length ? Math.max(...ends) : node.plannedOrd;
      if (node.derivedStart !== newStart || node.derivedEnd !== newEnd) stable = false;
      node.derivedStart = newStart;
      node.derivedEnd = newEnd;
    }
  }

  function ordinalOfDerivedStart(node) { return node.derivedStart; }
  function ordinalOfDerivedEnd(node) { return node.derivedEnd; }

  // ===== Backward pass =====
  const leaves = tasks.filter((t) => info.get(t.id).isLeaf).map((t) => info.get(t.id));
  let maxEFOrd = 0;
  for (const n of leaves) if (n.EF > maxEFOrd) maxEFOrd = n.EF;
  // target proyek yang lebih longgar boleh dipakai sebagai deadline
  const deadlineOrd = Math.max(options.targetEndOrdinal || 0, maxEFOrd);

  // Kombinasi FS + SS: LF dibatasi FS, LS dibatasi SS. Iterasi mundur sampai stabil.
  for (const n of leaves) { n._lfMax = deadlineOrd; n._lsMax = deadlineOrd - n.duration + 1; }
  for (let iter = 0; iter < leaves.length + 1; iter++) {
    let changed = false;
    for (const d of deps) {
      const succ = info.get(d.successor_id);
      const pred = info.get(d.predecessor_id);
      if (!succ || !pred || !pred.isLeaf || !succ.isLeaf) continue;
      const lag = d.lag || 0;
      const lsSucc = Math.min(succ._lsMax, succ._lfMax - succ.duration + 1);
      if (d.type === 'FS') {
        const limit = lsSucc - lag - 1; // EF pred maksimal
        if (limit < pred._lfMax) { pred._lfMax = limit; changed = true; }
      } else {
        const limit = lsSucc - lag; // LS pred maksimal
        if (limit < pred._lsMax) { pred._lsMax = limit; changed = true; }
      }
    }
    if (!changed) break;
  }
  for (const n of leaves) {
    n.LS = Math.min(n._lsMax, n._lfMax - n.duration + 1);
    n.LF = n.LS + n.duration - 1;
    n.float = n.LS - n.ES;
    n.critical = n.float <= 0;
  }

  // ===== Peringatan proyek terlambat =====
  let projectFinish = null;
  let latestEF = 0;
  for (const n of leaves) if (n.EF > latestEF) { latestEF = n.EF; projectFinish = n.end; }

  return { info, projectEFOrd: latestEF, projectFinish, warnings };
}

// ===== Simpan hasil jadwal ke database dan kembalikan ringkasan =====
function rescheduleProject(db, projectId) {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) throw new Error('Proyek tidak ditemukan');
  const tasks = getProjectTasks(db, projectId);
  const deps = getProjectDeps(db, projectId);
  const cal = makeCalendar(loadCalendarData(db, projectId));
  const { info, projectFinish, projectEFOrd } = computeSchedule(cal, tasks, deps, {
    projectStart: project.start_date,
  });

  const upd = db.prepare(
    `UPDATE tasks SET start_date = ?, end_date = ?, updated_at = updated_at WHERE id = ?`
  );
  const updStmt = db.prepare(
    `UPDATE tasks SET start_date = ?, end_date = ?, updated_at = datetime('now','localtime') WHERE id = ?`
  );
  const tx = db.transaction(() => {
    for (const t of tasks) {
      const n = info.get(t.id);
      const isLeaf = n.isLeaf;
      const startDate = isLeaf ? n.start : cal.dateFromOrdinal(n.derivedStart ?? n.ES ?? cal.ordinalOf(project.start_date));
      const endDate = isLeaf ? n.end : cal.dateFromOrdinal(n.derivedEnd ?? n.ES ?? cal.ordinalOf(project.start_date));
      // Jika tidak ada anakan, tugas tanpa durasi tetap dihitung normal
      updStmt.run(startDate, endDate, t.id);
    }
    // hitung progres proyek (rata-rata berbobot durasi tugas daun)
    const leaves = tasks.filter((t) => !tasks.some((c) => c.parent_task_id === t.id));
    let weighted = 0, total = 0;
    for (const t of leaves) {
      const dur = Math.max(1, t.duration || 1);
      weighted += (t.progress || 0) * dur;
      total += dur;
    }
    const progress = total > 0 ? Math.round((weighted / total) * 10) / 10 : 0;
    db.prepare('UPDATE projects SET progress = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?')
      .run(progress, projectId);
    void upd;
  });
  tx();

  return {
    projectFinish,
    projectEFOrd,
    info,
    tasks: tasks.map((t) => ({ ...t, schedule: info.get(t.id) })),
  };
}

// ===== Analisis jalur kritis =====
function analyzeCriticalPath(db, projectId) {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) throw new Error('Proyek tidak ditemukan');
  const tasks = getProjectTasks(db, projectId);
  const deps = getProjectDeps(db, projectId);
  const cal = makeCalendar(loadCalendarData(db, projectId));

  if (!tasks.length) {
    return { ok: false, reason: 'Proyek belum memiliki tugas, analisis jalur kritis belum dapat dilakukan.' };
  }
  const missingDur = tasks.filter((t) => !tasks.some((c) => c.parent_task_id === t.id) && (!t.duration || t.duration < 1));
  // durasi 0 tidak diizinkan pada level DB default 1, jadi cukup aman

  // target: gunakan target tanggal selesai proyek jika lebih longgar daripada jadwal
  const targetOrd = cal.ordinalOf(project.target_end_date);
  const base = computeSchedule(cal, tasks, deps, { projectStart: project.start_date });
  const forced = computeSchedule(cal, tasks, deps, {
    projectStart: project.start_date,
    targetEndOrdinal: Math.max(targetOrd, base.projectEFOrd),
  });

  const nodes = [];
  for (const n of forced.info.values()) nodes.push(n);
  const leafNodes = nodes.filter((n) => n.isLeaf);
  const minFloat = Math.min(...leafNodes.map((n) => n.float));
  for (const n of leafNodes) n.critical = n.float <= minFloat;

  // Rangkaian jalur kritis: mulai dari tugas kritis EF = projectEF, telusuri pendahulu kritis FS
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const criticalSet = new Set(leafNodes.filter((n) => n.critical).map((n) => n.id));

  const depPreds = new Map();
  for (const d of deps) {
    if (!depPreds.has(d.successor_id)) depPreds.set(d.successor_id, []);
    depPreds.get(d.successor_id).push(d);
  }

  // kumpulkan akhir jalur: tugas kritis dengan EF maksimum
  const maxEF = Math.max(...leafNodes.map((n) => n.EF));
  let path = [];
  const stack = leafNodes.filter((n) => n.critical && n.EF === maxEF).map((n) => ({ node: n, chain: [n.id] }));
  const paths = [];
  while (stack.length) {
    const { node, chain } = stack.pop();
    const dlist = (depPreds.get(node.id) || []).filter((d) => criticalSet.has(d.predecessor_id));
    // hanya telusuri FS dan SS dengan lag 0..n yang konsisten: gunakan pendahulu kritis LS = ES pada jalur
    const prevs = dlist.filter((d) => {
      const p = forced.info.get(d.predecessor_id);
      return p.critical && p.EF >= node.ES - (d.lag || 0) - 1;
    });
    if (!prevs.length) paths.push(chain);
    else for (const d of prevs) stack.push({ node: forced.info.get(d.predecessor_id), chain: [...chain, d.predecessor_id] });
  }

  const nodeById = (id) => {
    const n = forced.info.get(id);
    const t = taskMap.get(id);
    return {
      id,
      name: t.name,
      duration: n.isLeaf ? t.duration : null,
      start: n.isLeaf ? n.start : cal.dateFromOrdinal(n.derivedStart),
      end: n.isLeaf ? n.end : cal.dateFromOrdinal(n.derivedEnd),
      ES: n.isLeaf ? cal.dateFromOrdinal(n.ES) : null,
      EF: n.isLeaf ? cal.dateFromOrdinal(n.EF) : null,
      LS: n.isLeaf ? cal.dateFromOrdinal(n.LS) : null,
      LF: n.isLeaf ? cal.dateFromOrdinal(n.LF) : null,
      float: n.isLeaf ? n.float : null,
      critical: !!n.critical,
      status: t.status,
    };
  };

  const criticalList = [...criticalSet].map(nodeById).sort((a, b) => (a.start < b.start ? -1 : 1));
  const nonCriticalList = leafNodes.filter((n) => !criticalSet.has(n.id)).map((n) => nodeById(n.id));

  const ta = taskMap.get;
  void ta;

  const pathsFormatted = (paths.length ? [paths[0]] : paths).map((chain) => chain.reverse().map(nodeById));
  // ambil semua jalur yang ditemukan
  const allPaths = [];
  const collected = new Set();
  for (const chain of paths) {
    const key = chain.slice().sort((a, b) => a - b).join('-');
    if (collected.has(key)) continue;
    collected.add(key);
    allPaths.push(chain.slice().reverse().map(nodeById));
  }

  const estFinish = cal.dateFromOrdinal(forced.info.size ? maxEF : targetOrd);

  // keterlambatan: estimasi berbasis jadwal vs target proyek
  const isLate = targetOrd < maxEF;

  return {
    ok: true,
    totalWorkdays: maxEF ? maxEF - Math.min(...leafNodes.map((n) => n.ES)) + 1 : 0,
    estimatedFinish: estFinish,
    isLate,
    criticalTasks: criticalList,
    nonCriticalTasks: nonCriticalList,
    criticalPaths: allPaths.length ? allPaths : pathsFormatted,
    minFloat,
  };
}

module.exports = { createsCycle, computeSchedule, rescheduleProject, analyzeCriticalPath, getProjectTasks, getProjectDeps };
