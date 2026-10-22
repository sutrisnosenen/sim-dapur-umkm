// View visualisasi: Gantt Chart, PERT Chart, Jalur Kritis, Resource Chart
window.Views = window.Views || {};

function routeGanttDependency(source, target, bars, width, height, rowHeight, type) {
  const start = {
    x: type === 'SS' ? source.left : source.left + source.width,
    y: source.row * rowHeight + rowHeight / 2,
  };
  const end = {
    x: target.left,
    y: target.row * rowHeight + rowHeight / 2,
  };
  const xs = new Set([0, width, start.x, end.x]);
  const ys = new Set([0, height, start.y, end.y]);
  for (const bar of bars) {
    xs.add(Math.max(0, bar.left - 4));
    xs.add(Math.min(width, bar.left + bar.width + 4));
    const top = bar.row * rowHeight + 9;
    const bottom = bar.row * rowHeight + rowHeight - 9;
    ys.add(Math.max(0, top - 4));
    ys.add(Math.min(height, bottom + 4));
    ys.add((bar.row + 1) * rowHeight);
  }

  const xValues = [...xs].sort((a, b) => a - b);
  const yValues = [...ys].sort((a, b) => a - b);
  const xIndex = new Map(xValues.map((x, i) => [x, i]));
  const yIndex = new Map(yValues.map((y, i) => [y, i]));
  const cols = xValues.length, nodeCount = cols * yValues.length;
  const startNode = yIndex.get(start.y) * cols + xIndex.get(start.x);
  const endNode = yIndex.get(end.y) * cols + xIndex.get(end.x);
  const obstacles = bars.map((bar) => ({
    taskId: bar.taskId,
    left: bar.left - 4,
    right: bar.left + bar.width + 4,
    top: bar.row * rowHeight + 5,
    bottom: bar.row * rowHeight + rowHeight - 5,
  }));
  const samePoint = (x, y, point) => x === point.x && y === point.y;
  const blockedPoint = (x, y) => {
    if (samePoint(x, y, start) || samePoint(x, y, end)) return false;
    return obstacles.some((o) => x > o.left && x < o.right && y > o.top && y < o.bottom);
  };
  const blockedSegment = (x1, y1, x2, y2) => obstacles.some((o) => {
    if (o.taskId === source.taskId && samePoint(x1, y1, start)) {
      const leavesOutward = type === 'SS' ? x2 < x1 : x2 > x1;
      if (leavesOutward && y1 === y2) return false;
    }
    if (o.taskId === target.taskId && y1 === end.y && y2 === end.y && x1 < end.x && x2 <= end.x) return false;
    if (o.taskId === target.taskId && samePoint(x2, y2, end) && y1 === y2 && x1 < x2) return false;
    if (y1 === y2) return y1 > o.top && y1 < o.bottom && Math.max(x1, x2) > o.left && Math.min(x1, x2) < o.right;
    return x1 > o.left && x1 < o.right && Math.max(y1, y2) > o.top && Math.min(y1, y2) < o.bottom;
  });
  const startState = startNode * 5;
  const states = nodeCount * 5;
  const costs = new Float64Array(states).fill(Infinity);
  const previous = new Int32Array(states).fill(-1);
  const heap = [];
  const push = (item) => {
    let i = heap.length;
    heap.push(item);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p].priority <= item.priority) break;
      heap[i] = heap[p];
      i = p;
    }
    heap[i] = item;
  };
  const pop = () => {
    const first = heap[0], last = heap.pop();
    if (heap.length) {
      let i = 0;
      while (true) {
        let child = i * 2 + 1;
        if (child >= heap.length) break;
        if (child + 1 < heap.length && heap[child + 1].priority < heap[child].priority) child++;
        if (heap[child].priority >= last.priority) break;
        heap[i] = heap[child];
        i = child;
      }
      heap[i] = last;
    }
    return first;
  };
  const heuristic = (node) => {
    const x = xValues[node % cols], y = yValues[Math.floor(node / cols)];
    return Math.abs(end.x - x) + Math.abs(end.y - y);
  };
  costs[startState] = 0;
  push({ state: startState, cost: 0, priority: heuristic(startNode) });
  let goalState = -1;

  while (heap.length) {
    const current = pop();
    const state = current.state, node = Math.floor(state / 5), incoming = state % 5;
    if (current.cost !== costs[state]) continue;
    const row = Math.floor(node / cols), col = node % cols;
    const x = xValues[col], y = yValues[row];
    if (node === endNode && incoming === 1) { goalState = state; break; }

    const neighbors = [];
    for (let nextCol = col + 1; nextCol < cols; nextCol++) {
      const next = row * cols + nextCol, nx = xValues[nextCol];
      if (blockedSegment(x, y, nx, y)) break;
      if (!blockedPoint(nx, y)) { neighbors.push([next, 1]); break; }
    }
    for (let nextCol = col - 1; nextCol >= 0; nextCol--) {
      const next = row * cols + nextCol, nx = xValues[nextCol];
      if (blockedSegment(x, y, nx, y)) break;
      if (!blockedPoint(nx, y)) { neighbors.push([next, 2]); break; }
    }
    for (let nextRow = row - 1; nextRow >= 0; nextRow--) {
      const next = nextRow * cols + col, ny = yValues[nextRow];
      if (blockedSegment(x, y, x, ny)) break;
      if (!blockedPoint(x, ny)) { neighbors.push([next, 3]); break; }
    }
    for (let nextRow = row + 1; nextRow < yValues.length; nextRow++) {
      const next = nextRow * cols + col, ny = yValues[nextRow];
      if (blockedSegment(x, y, x, ny)) break;
      if (!blockedPoint(x, ny)) { neighbors.push([next, 4]); break; }
    }
    for (const [next, direction] of neighbors) {
      const nx = xValues[next % cols], ny = yValues[Math.floor(next / cols)];
      if (blockedPoint(nx, ny) || blockedSegment(x, y, nx, ny)) continue;
      if (state === startState && (y !== ny || direction !== (type === 'SS' ? 2 : 1))) continue;
      if (next === endNode && (y !== ny || direction !== 1)) continue;

      const nextState = next * 5 + direction;
      const cost = costs[state] + Math.abs(nx - x) + Math.abs(ny - y) + (incoming && incoming !== direction ? 18 : 0);
      if (cost >= costs[nextState]) continue;
      costs[nextState] = cost;
      previous[nextState] = state;
      push({ state: nextState, cost, priority: cost + heuristic(next) });
    }
  }

  if (goalState < 0) return null;
  const points = [];
  for (let state = goalState; state >= 0; state = previous[state]) {
    const node = Math.floor(state / 5);
    points.push({ x: xValues[node % cols], y: yValues[Math.floor(node / cols)] });
    if (state === startState) break;
  }
  points.reverse();
  for (let i = points.length - 2; i > 0; i--) {
    const a = points[i - 1], b = points[i], c = points[i + 1];
    if ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)) points.splice(i, 1);
  }
  return points;
}

// ============ GANTT CHART ============
async function renderGantt(body, project, canManage) {
  const [data, cp] = await Promise.all([
    api.get(`/api/analysis/${project.id}/gantt`),
    api.get(`/api/analysis/${project.id}/critical-path`).catch(() => null),
  ]);
  if (!data.tasks.length) {
    body.innerHTML = '<div class="card"><div class="empty-state"><div class="big">📊</div>Belum ada tugas untuk ditampilkan di Gantt Chart.</div></div>';
    return;
  }
  // slack per tugas dari analisis jalur kritis (bila tersedia)
  const slackMap = new Map();
  if (cp && cp.ok) [...(cp.criticalTasks || []), ...(cp.nonCriticalTasks || [])].forEach((x) => slackMap.set(x.id, x.float));

  const NM = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Ags', 'Sep', 'Okt', 'Nov', 'Des'];
  const STATUS_COLOR = { 'Belum Dimulai': '#94a3b8', 'Berjalan': '#2563eb', 'Terhambat': '#d97706', 'Selesai': '#16a34a', 'Dibatalkan': '#cbd5e1' };
  const ROW_H = 42;
  const shortDate = (s) => { if (!s) return '–'; const [y, m, d] = s.split('-'); return `${d} ${NM[m - 1]}`; };
  const projEnd = data.estimated_finish || data.project?.target_end_date || null;
  const critCount = data.tasks.filter((x) => x.critical).length;
  const projProg = Number(data.project?.progress || 0);
  const totalDays = cp && cp.ok ? cp.totalWorkdays : data.tasks.reduce((s, t) => s + (t.duration || 0), 0);
  let pxPerDay = 32;
  let mode = 'hari';

  body.innerHTML = `
    <div class="card gantt-card">
      <div class="gantt-kpis">
        <div class="gantt-kpi"><span class="gk-label">Periode Proyek</span><strong>${fmtDate(data.project?.start_date)} – ${fmtDate(projEnd)}</strong><small>${esc(data.project?.name || '')}</small></div>
        <div class="gantt-kpi"><span class="gk-label">Durasi Total</span><strong>${totalDays} hari kerja</strong><small>${data.tasks.length} tugas terjadwal</small></div>
        <div class="gantt-kpi gk-critical"><span class="gk-label">Jalur Kritis</span><strong>${critCount} tugas</strong><small>${data.critical_ok ? 'Analisis jalur kritis aktif' : 'Analisis tidak tersedia'}</small></div>
        <div class="gantt-kpi gk-progress">
          <span class="gk-label">Progres Proyek</span>
          <div class="gk-progress-line"><div class="progress-bar"><div class="progress-fill ${projProg >= 100 ? 'done' : ''}" style="width:${projProg}%"></div></div><strong>${projProg}%</strong></div>
          <small>${data.dependencies.length} dependensi tersimpan</small>
        </div>
      </div>
      <div class="gantt-section-head">
        <div><h3>📊 Gantt Chart</h3><span>Jadwal tugas proyek</span></div>
        <div class="gantt-modes" role="group" aria-label="Skala waktu timeline">
          <button type="button" class="gbtn active" data-mode="hari">Harian</button>
          <button type="button" class="gbtn" data-mode="minggu">Mingguan</button>
          <button type="button" class="gbtn" data-mode="bulan">Bulanan</button>
        </div>
      </div>
      <div class="gantt-toolbar">
        <div class="gantt-legend" title="Warna batang mengikuti jenis tugas; bagian gelap dalam batang = progres aktual, bagian terang = sisa jadwal rencana">
          <span class="g-legend"><i class="gsw gsw-task"></i>Tugas Biasa</span>
          <span class="g-legend"><i class="gsw gsw-parent"></i>Tugas Induk</span>
          <span class="g-legend"><i class="gsw gsw-critical"></i>Tugas Kritis</span>
          <span class="g-legend"><i class="gsw gsw-prog"></i>Progres Aktual</span>
          <span class="g-legend"><i class="gsw gsw-today"></i>Hari Ini</span>
        </div>
      </div>
      ${data.critical_ok ? '' : `<div class="alert warning">${esc(data.critical_reason || 'Analisis jalur kritis belum dapat dilakukan; penanda kritis tidak ditampilkan.')}</div>`}
      <div id="gantt-container" class="chart-scroll gantt-scroll"></div>
      <div class="gantt-footer">
        <span class="gf-item"><b>${data.tasks.length}</b> tugas</span>
        <span class="gf-item gf-crit"><b>${critCount}</b> tugas kritis</span>
        <span class="gf-item"><b>${data.dependencies.length}</b> dependensi</span>
        <span class="gf-spacer"></span>
        <span class="gf-item">Garis siku = dependensi tersimpan · garis putus = Mulai-ke-Mulai (SS)</span>
      </div>
    </div>`;

  build();

  function build() {
    pxPerDay = mode === 'hari' ? 32 : mode === 'minggu' ? 10 : 4;
    const dates = data.tasks.flatMap((t) => [t.start_date, t.end_date]).filter(Boolean);
    const min = dates.reduce((a, b) => (a < b ? a : b));
    const max = dates.reduce((a, b) => (a > b ? a : b));
    const allDays = [];
    let cur = new Date(min);
    const stop = new Date(max);
    while (cur <= stop) {
      allDays.push(cur.toISOString().slice(0, 10));
      cur = new Date(cur.getTime() + 86400000);
    }
    const totalW = allDays.length * pxPerDay;
    const dayIdx = new Map(allDays.map((d, i) => [d, i]));
    const taskById = new Map(data.tasks.map((t) => [t.id, t]));

    const monthSpans = [];
    for (let i = 0; i < allDays.length; i++) {
      const ym = allDays[i].slice(0, 7);
      if (!monthSpans.length || monthSpans[monthSpans.length - 1].ym !== ym) monthSpans.push({ ym, start: i, len: 1 });
      else monthSpans[monthSpans.length - 1].len++;
    }
    const showDay = (day, index) => {
      if (mode === 'hari') return index % 2 === 0;
      if (mode === 'minggu') return new Date(day + 'T00:00:00').getDay() === 1;
      return day.slice(8) === '01';
    };
    const isWeekend = (d) => { const w = new Date(d + 'T00:00:00').getDay(); return w === 0 || w === 6; };
    const WD = ['M', 'S', 'S', 'R', 'K', 'J', 'S'];

    // lapisan bawah: akhir pekan + batas bulan
    const weRanges = [];
    let weStart = -1;
    for (let i = 0; i < allDays.length; i++) {
      if (isWeekend(allDays[i])) { if (weStart < 0) weStart = i; }
      else if (weStart >= 0) { weRanges.push([weStart, i]); weStart = -1; }
    }
    if (weStart >= 0) weRanges.push([weStart, allDays.length]);
    let underlay = weRanges.map(([a, b]) => `<div class="gantt-we" style="left:${a * pxPerDay}px;width:${(b - a) * pxPerDay}px"></div>`).join('');
    for (let i = 1; i < allDays.length; i++) {
      if (allDays[i].slice(0, 7) !== allDays[i - 1].slice(0, 7)) underlay += `<div class="gantt-ms" style="left:${i * pxPerDay}px"></div>`;
    }

    const rows = sortTasksForDisplay();
    let rowsHtml = '';
    const barPositions = new Map();

    rows.forEach((t, i) => {
      const isParent = data.tasks.some((x) => x.parent_task_id === t.id);
      const isChild = !!t.parent_task_id;
      const startI = dayIdx.get(t.start_date) ?? 0;
      const endI = dayIdx.get(t.end_date) ?? 0;
      const left = startI * pxPerDay;
      const width = Math.max((endI - startI + 1) * pxPerDay - 2, 4);
      const tAssign = (data.assignments || []).filter((a) => a.task_id === t.id);
      const names = [...new Set(tAssign.map((a) => a.resource_name))].join(', ');
      const slack = slackMap.get(t.id);
      barPositions.set(t.id, { taskId: t.id, left, width, row: i });
      rowsHtml += `
        <div class="gantt-row ${i % 2 ? 'alt' : ''} ${isParent ? 'parent-row' : ''} ${t.critical ? 'critical-row' : ''}">
          <div class="gantt-labels gl-cols">
            <span class="gl-id" title="ID tugas #${t.id}">#${t.id}</span>
            <span class="gl-name ${isChild ? 'gl-child' : ''}" title="${esc(t.name)}${t.critical ? ' · tugas pada jalur kritis' : ''}">${isChild ? '<span class="tw-mark">↳</span>' : ''}<span class="s-dot" style="background:${STATUS_COLOR[t.status] || '#94a3b8'}" title="Status: ${esc(t.status)}"></span><b class="gl-task-name ${isParent ? 'gl-parent-name' : ''}">${esc(t.name)}</b>${t.critical ? '<span class="kb" title="Tugas pada jalur kritis">K</span>' : ''}</span>
            <span class="gl-c c-assign tassign ${tAssign.length ? '' : 'g-hidden'}" title="${esc(names || 'Belum ada anggota')}">👥${tAssign.length}</span>
            <span class="gl-c c-dur" title="Durasi hari kerja">${t.duration}h</span>
            <span class="gl-c c-start tdates" title="Mulai: ${t.start_date}">${shortDate(t.start_date)}</span>
            <span class="gl-c c-end tdates" title="Selesai: ${t.end_date}">${shortDate(t.end_date)}</span>
            <span class="gl-c c-slack tslack" title="Slack (hari kerja)">${slack === undefined || slack === null ? '–' : slack}</span>
          </div>
          <div class="gantt-track" style="--cw:${pxPerDay}px;flex:0 0 ${totalW}px">${underlay}
            <div class="gantt-bar ${t.critical ? 'critical' : ''} ${isParent ? 'parent' : ''} ${isParent ? '' : 'gantt-bar-leaf'}"
                 data-task="${t.id}"
                 style="left:${left}px;width:${width}px" title="${esc(t.name)} · ${t.status} · ${t.progress}% · ${t.start_date} – ${t.end_date}" aria-label="${esc(t.name)}: progres ${t.progress}%">
              <div class="fill" style="width:${t.progress}%"></div>
            </div>
          </div>
        </div>`;
    });

    const headMonths = monthSpans.map((m) =>
      `<div class="gantt-month" style="flex:0 0 ${m.len * pxPerDay}px">${NM[Number(m.ym.slice(5, 7)) - 1]} ${m.ym.slice(0, 4)}</div>`).join('');
    const headDays = allDays.map((d, i) => showDay(d, i)
      ? `<div class="gantt-day ${isWeekend(d) ? 'wkend' : ''}" style="flex:0 0 ${pxPerDay}px"><span>${Number(d.slice(8))}</span><i>${WD[new Date(d + 'T00:00:00').getDay()]}</i></div>`
      : `<div class="gantt-day ${isWeekend(d) ? 'wkend' : ''}" style="flex:0 0 ${pxPerDay}px"></div>`).join('');

    const container = body.querySelector('#gantt-container');
    container.innerHTML = `
      <div class="gantt-head">
        <div class="gantt-labels gl-cols gl-head-row"><span class="gl-h">ID</span><span class="gl-h ta-l">Tugas</span><span class="gl-h c-assign">Anggota</span><span class="gl-h c-dur">Durasi</span><span class="gl-h c-start">Mulai</span><span class="gl-h c-end">Selesai</span><span class="gl-h c-slack">Slack</span></div>
        <div class="gantt-head-track" style="flex:0 0 ${totalW}px"><div class="gantt-months">${headMonths}</div><div class="gantt-days">${headDays}</div></div>
      </div>
      ${rowsHtml}`;

    // penanda hari ini & rencana selesai (tanggal lokal)
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const addMarker = (dayStr, cls, tagHtml) => {
      if (!dayIdx.has(dayStr)) return;
      const left = (dayIdx.get(dayStr) + 0.5) * pxPerDay;
      container.querySelector('.gantt-head-track').insertAdjacentHTML('beforeend',
        `<div class="today-line ${cls}" style="left:${left}px">${tagHtml || ''}</div>`);
      container.querySelectorAll('.gantt-row .gantt-track').forEach((tr) => {
        tr.insertAdjacentHTML('beforeend', `<div class="today-line ${cls}" style="left:${left}px"></div>`);
      });
    };
    addMarker(todayStr, '', '<span class="today-tag">Hari Ini</span>');
    if (projEnd) addMarker(projEnd, 'end-line', '<span class="today-tag end-tag">Rencana Selesai</span>');

    // garis dependensi (panah) hanya untuk hubungan antartugas yang nyata
    let depPaths = '';
    let pathCount = 0;
    for (const d of data.dependencies) {
      const a = barPositions.get(d.predecessor_id), b = barPositions.get(d.successor_id);
      if (!a || !b) continue;
      const points = routeGanttDependency(a, b, [...barPositions.values()], totalW, rows.length * ROW_H, ROW_H, d.type);
      if (!points) continue;
      const dash = d.type === 'SS' ? ' stroke-dasharray="5 3"' : '';
      const pp = `M${points.map((p) => `${p.x},${p.y}`).join(' L')}`;
      depPaths += `<path class="dep-line"${dash} d="${pp}" marker-end="url(#dep-arrow)"/>`;
      pathCount++;
    }
    if (pathCount) {
      container.insertAdjacentHTML('beforeend',
        `<svg class="gantt-deps" width="${totalW}" height="${rows.length * ROW_H}"><defs>
          <marker id="dep-arrow" markerWidth="6" markerHeight="6" viewBox="0 0 6 6" markerUnits="userSpaceOnUse" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#94a3b8"/></marker>
        </defs>${depPaths}</svg>`);
      const svg = container.querySelector('.gantt-deps');
      svg.style.left = container.querySelector('.gantt-row .gantt-labels').offsetWidth + 'px';
      svg.style.top = container.querySelector('.gantt-head').offsetHeight + 'px';
    }

    container.querySelectorAll('.gantt-bar-leaf, .gantt-bar.parent').forEach((bar) => {
      bar.onclick = () => {
        const t = taskById.get(Number(bar.dataset.task));
        Views.taskDetailModalFor(project, t);
      };
    });

    body.querySelectorAll('.gantt-modes .gbtn').forEach((b) => {
      b.onclick = () => {
        body.querySelectorAll('.gantt-modes .gbtn').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        mode = b.dataset.mode;
        build();
      };
    });

    function sortTasksForDisplay() {
      const byParent = {};
      const roots = [];
      for (const t of data.tasks) {
        if (t.parent_task_id) (byParent[t.parent_task_id] = byParent[t.parent_task_id] || []).push(t);
        else roots.push(t);
      }
      const out = [];
      roots.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id).forEach((r) => {
        out.push(r);
        (byParent[r.id] || []).sort((a, b) => a.sort_order - b.sort_order || a.id - b.id).forEach((c) => out.push(c));
      });
      for (const t of data.tasks) { // subtugas tingkat lebih dalam
        if (out.indexOf(t) === -1) out.push(t);
      }
      return out;
    }
  }
}

// ============ PERT CHART ============
async function renderPert(body, project, canManage) {
  const data = await api.get(`/api/analysis/${project.id}/pert`);
  body.innerHTML = `
    <div class="card">
      <h3>🕸️ PERT Chart / Network Diagram</h3>
      ${data.ok ? '' : `<div class="alert warning">${esc(data.reason || 'Analisis belum dapat dilakukan.')}</div>`}
      <div class="alert info" style="font-size:.8rem">
        <b>FS</b> (Finish-to-Start) = garis normal; <b>SS</b> (Start-to-Start) = garis putus-putus.
        Label pada panah menampilkan lag (hari kerja). Node merah = tugas kritis. Klik node untuk detail.
      </div>
      <div class="chart-scroll" style="background:#fafbfe"><div class="pert-wrap" id="pert-img"></div></div>
    </div>`;
  if (!data.tasks.length) {
    body.querySelector('#pert-img').innerHTML = '<div class="empty-state">Belum ada tugas.</div>';
    return;
  }
  drawPert(body, data);
}

function drawPert(body, data) {
  // layer: hitung kedalaman DAG untuk penempatan node kolom per level
  const taskById = new Map(data.tasks.map((t) => [t.id, t]));
  const preds = (id) => data.dependencies.filter((d) => d.successor_id === id).map((d) => d.predecessor_id);
  const depth = new Map();
  data.tasks.forEach((t) => {
    const stack = [t.id];
    if (!depth.has(t.id)) depth.set(t.id, 0);
    while (stack.some(() => false)) break;
  });
  // BFS berulang hingga stabil (graf DAG)
  for (let round = 0; round < data.tasks.length + 2; round++) {
    let changed = false;
    for (const t of data.tasks) {
      const plist = preds(t.id);
      const base = plist.length ? Math.max(...plist.map((p) => depth.get(p) ?? -1)) : -1;
      const newDepth = plist.length ? base + 1 : 0;
      if (depth.get(t.id) !== newDepth) { depth.set(t.id, newDepth); changed = true; }
    }
    if (!changed) break;
  }
  const byCol = new Map();
  for (const t of data.tasks) {
    const col = depth.get(t.id);
    (byCol.get(col) || byCol.set(col, []).get(col)).push(t);
  }
  const maxCol = Math.max(...byCol.keys());
  const NW = 150, NH = 88, GAPX = 70, GAPY = 26;
  const width = (maxCol + 1) * (NW + GAPX) + GAPX;
  const byColSizes = [...byCol.values()].map((a) => a.length);
  const height = Math.max(...byColSizes) * (NH + GAPY) + 60;

  const nodePos = new Map();
  for (const [col, list] of [...byCol.entries()].sort((a, b) => a[0] - b[0])) {
    const x = 30 + col * (NW + GAPX);
    const totalH = list.length * (NH + GAPY) - GAPY;
    let y = (height - totalH) / 2;
    for (const t of list) {
      nodePos.set(t.id, { x, y: y, cx: x + NW / 2, cy: y + NH / 2, isParent: data.tasks.some((z) => z.parent_task_id === t.id) });
      y += NH + GAPY;
    }
  }
  let svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`;
  svg += `<defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#94a3b8"/></marker>
          <marker id="arrow-crit" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#b91c1c"/></marker></defs>`;

  // Edges
  for (const d of data.dependencies) {
    const a = nodePos.get(d.predecessor_id), b = nodePos.get(d.successor_id);
    if (!a || !b) continue;
    const crit = d._crit || (taskById.get(d.predecessor_id)?.critical && taskById.get(d.successor_id)?.critical);
    const isSS = d.type === 'SS';
    const x1 = a.cx + NW / 2, y1 = a.cy, x2 = b.x - 2, y2 = b.cy;
    const mx = (x1 + x2) / 2;
    svg += `<path class="pert-edge ${crit ? 'critical' : ''}" ${isSS ? 'stroke-dasharray="6 4"' : ''}
      marker-end="${crit ? 'url(#arrow-crit)' : 'url(#arrow)'}" d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}"/>`;
    // label jenis + lag
    svg += `<rect x="${mx - 16}" y="${(y1 + y2) / 2 - 9}" width="34" height="14" rx="7" fill="#fff" stroke="#e2e8f0"/>
            <text class="pert-edge-label" x="${mx + 1}" y="${(y1 + y2) / 2 + 1}" text-anchor="middle">${d.type}·${d.lag}</text>`;
  }

  // Nodes
  for (const t of data.tasks) {
    const p = nodePos.get(t.id);
    const isParent = p.isParent;
    svg += `<g class="pert-node ${t.critical ? 'critical' : ''}" data-task="${t.id}" style="cursor:pointer">
      <rect x="${p.x}" y="${p.y}" width="${NW}" height="${NH}" rx="8"/>
      <text class="tname" x="${p.x + 8}" y="${p.y + 18}">${esc(trunc(t.name, 20))}${isParent ? ' (induk)' : ''}</text>
      <text x="${p.x + 8}" y="${p.y + 36}">${fmtDate(t.start_date)} → ${fmtDate(t.end_date)}</text>
      <text x="${p.x + 8}" y="${p.y + 52}">${isParent ? '' : t.duration + ' hari kerja · '}${t.progress}%</text>
      <text x="${p.x + 8}" y="${p.y + 68}">${esc(t.status)}${t.critical ? ' · 🔴 kritis' : ''}</text>
    </g>`;
  }
  svg += '</svg>';
  body.querySelector('#pert-img').innerHTML = svg;
  body.querySelectorAll('.pert-node').forEach((n) => {
    n.onclick = () => {
      const t = taskById.get(Number(n.dataset.task));
      Views.taskDetailModalFor(project, t);
      document.querySelectorAll('.pert-node.selected').forEach((x) => x.classList.remove('selected'));
      n.classList.add('selected');
    };
  });
}
function trunc(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

// ============ JALUR KRITIS ============
async function renderKritikal(body, project) {
  const cp = await api.get(`/api/analysis/${project.id}/critical-path`);
  if (!cp.ok) {
    body.innerHTML = `<div class="card"><div class="alert warning"><b>Analisis jalur kritis belum dapat dilakukan:</b><br>${esc(cp.reason || '')}</div></div>`;
    return;
  }
  const path = (cp.criticalPaths && cp.criticalPaths[0]) ? cp.criticalPaths[0] : [];
  body.innerHTML = `
    <div class="card">
      <h3>🎯 Analisis Jalur Kritis</h3>
      <div class="grid cols-3">
        <div class="stat red"><div class="num">${cp.totalWorkdays}</div><div class="lbl">Estimasi Total Hari Kerja Proyek</div></div>
        <div class="stat blue"><div class="num">${fmtDate(cp.estimatedFinish)}</div><div class="lbl">Perkiraan Tanggal Penyelesaian</div></div>
        <div class="stat ${cp.isLate ? 'red' : 'green'}"><div class="num" style="font-size:1rem">${cp.isLate ? '⚠️ TERLAMBAT' : '✅ TERKENDALI'}</div><div class="lbl">${cp.isLate ? 'Estimasi melewati tanggal target proyek' : 'Estimasi selesai sesuai/lebih cepat dari target'}</div></div>
      </div>
      ${cp.isLate ? '<div class="alert error">Peringatan: jadwal kritis menunjukkan penyelesaian berpotensi melewati target tanggal proyek. Pertimbangkan memangkas durasi tugas kritis atau mengatur ulang dependensi.</div>' : ''}

      <h3 style="margin-top:16px">🧭 Urutan Jalur Kritis</h3>
      ${path.length ? `<div class="kpi-path">${path.map((n, i) => `${i ? '<span class="kpi-arrow">→</span>' : ''}<span class="kpi-pill" title="${fmtDate(n.start)} – ${fmtDate(n.end)}">${esc(n.name)}</span>`).join('')}</div>` : '<div class="empty-state">Jalur kritis belum tersedia.</div>'}
      ${cp.criticalPaths && cp.criticalPaths.length > 1 ? `<div class="alert info">Terdapat ${cp.criticalPaths.length} jalur kritis; jalur utama ditampilkan di atas. Tabel di bawah memuat seluruh tugas kritis.</div>` : ''}

      <h3 style="margin-top:16px">📅 Nilai ES / EF / LS / LF / Slack per Tugas</h3>
      <div class="table-scroll"><table class="tbl">
        <thead><tr><th>Tugas</th><th>ES (Mulai Paling Awal)</th><th>EF</th><th>LS (Mulai Paling Akhir)</th><th>LF</th><th>Slack (hari kerja)</th><th>Status</th></tr></thead>
        <tbody>
          ${[...cp.criticalTasks, ...cp.nonCriticalTasks].map((t) => `
            <tr ${t.critical ? 'style="background:#fff5f5"' : ''}>
              <td><b>${esc(t.name)}</b> ${criticalBadge(t.critical)}</td>
              <td>${fmtDate(t.ES)}</td><td>${fmtDate(t.EF)}</td>
              <td>${fmtDate(t.LS)}</td><td>${fmtDate(t.LF)}</td>
              <td style="font-weight:${t.float === 0 ? '800;color:var(--critical)' : ''}">${t.float}</td>
              <td>${statusBadge(t.status)}</td>
            </tr>`).join('')}
        </tbody>
      </table></div>
      <div class="alert info" style="font-size:.8rem">Tugas <b>kritis</b> memiliki slack 0 — keterlambatan di tugas ini langsung menunda penyelesaian proyek. Analisis menggunakan kombinasi dependensi FS & SS dengan lag hari kerja dan kalender kerja proyek.</div>
    </div>`;
}

// ============ RESOURCE CHART ============
async function renderResourceChart(body, project) {
  const data = await api.get(`/api/analysis/${project.id}/resource-chart`);
  if (data.empty) {
    body.innerHTML = `<div class="card"><div class="empty-state"><div class="big">👥</div>${esc(data.message)}</div></div>`;
    return;
  }
  const days = data.days;
  const pxPerDay = 22;
  const totalW = days.length * pxPerDay;
  const dayIdx = new Map(days.map((d, i) => [d, i]));

  // kelompok mingguan untuk header
  const weeks = [];
  for (let i = 0; i < days.length; i++) {
    const d = new Date(days[i]);
    // minggu: mulai Senin
    const isMonday = d.getDay() === 1;
    if (!weeks.length || isMonday) weeks.push({ start: i, len: 0, label: fmtDate(days[i]).slice(0, 6) });
    weeks[weeks.length - 1].len++;
  }

  body.innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px">
        <h3 style="margin:0">👥 Resource Chart — Beban Kerja Anggota Tim</h3>
        <div style="font-size:.8rem;color:var(--muted)">${fmtDate(data.rangeStart)} – ${fmtDate(data.rangeEnd)}</div>
      </div>
      <div class="alert info" style="font-size:.8rem">Beban harian = jumlah alokasi penugasan (%) yang aktif pada hari itu. Blok merah muda = hari dengan total alokasi > 100% (kelebihan beban). Sebagian blok menyatakan <b>alokasi %</b>.</div>
      <div class="chart-scroll"><div id="res-canvas" style="min-width:${totalW + 200}px"></div></div>
      <div id="res-conflicts" style="margin-top:12px"></div>
    </div>`;

  const canvas = body.querySelector('#res-canvas');
  canvas.innerHTML = `
    <div class="res-weekhead">
      <div style="flex:0 0 190px;border-right:1px solid var(--border);padding:4px 10px;font-weight:700">Anggota</div>
      <div class="res-weekhead" style="flex:1;display:flex">
        ${weeks.map((w) => `<div style="flex:0 0 ${w.len * pxPerDay}px;text-align:center;border-right:1px solid #f1f5f9;padding:4px">Minggu ${w.label}</div>`).join('')}
      </div>
    </div>`;

  const allConflicts = [];
  for (const res of data.resources) {
    const row = document.createElement('div');
    row.className = 'res-row';
    const overDays = new Set((res.conflicts.overallocationDays || []).map((c) => c.date));
    let blocks = '';
    for (const a of res.assignments) {
      const s = dayIdx.get(a.start), e = dayIdx.get(a.end);
      if (s == null || e == null) continue;
      const overlap = [...Array(e - s + 1).keys()].some((i) => overDays.has(days[s + i]));
      blocks += `<div class="res-block ${overlap ? 'over' : ''}" data-task="${a.task_id}" data-assign="${a.assignment_id}"
        style="left:${s * pxPerDay}px;width:${Math.max((e - s + 1) * pxPerDay - 2, 14)}px"
        title="${esc(a.task_name)} · alokasi ${a.allocation}% · ${fmtDate(a.start)}–${fmtDate(a.end)}">${a.allocation}% ${esc(trunc(a.task_name, 16))}</div>`;
    }
    // penanda hari libur pribadi
    const unavail = (data.unavailabilities || []).filter((u) => u.resource_id === res.resource_id);
    for (const u of unavail) {
      const s = dayIdx.get(u.start_date), e = dayIdx.get(u.end_date);
      if (s == null || e == null) continue;
      blocks += `<div style="position:absolute;top:0;bottom:0;left:${s * pxPerDay}px;width:${(e - s + 1) * pxPerDay}px;background:repeating-linear-gradient(45deg,#fde68a,#fde68a 4px,transparent 4px,transparent 8px);border:1px dashed var(--warning)" title="Tidak hadir: ${esc(u.reason)}"></div>`;
    }
    row.innerHTML = `
      <div class="res-label"><b>${esc(res.resource_name)}</b><div style="font-size:.7rem;color:var(--muted)">${esc(res.resource_role)}${res.resource_active ? '' : ' · <b style="color:var(--danger)">nonaktif</b>'}</div></div>
      <div class="res-track" style="min-width:${totalW}px">${blocks}</div>`;
    canvas.appendChild(row);

    if ((res.conflicts.overallocationDays || []).length || (res.conflicts.unavailabilityConflicts || []).length || res.conflicts.inactive) {
      allConflicts.push(res);
    }
  }

  const cbox = body.querySelector('#res-conflicts');
  cbox.innerHTML = allConflicts.length ? `
    <div class="card" style="border-color:#fecaca">
      <h3 style="color:var(--danger)">⚠️ Konflik Beban Kerja Terdeteksi</h3>
      ${allConflicts.map((r) => `
        <div style="margin-bottom:10px">
          <b>${esc(r.resource_name)}</b>
          ${(r.conflicts.overallocationDays || []).length ? `<div style="font-size:.82rem;color:var(--danger)">Kelebihan beban (>100%) pada ${r.conflicts.overallocationDays.length} hari, antara lain: ${r.conflicts.overallocationDays.slice(0, 5).map((c) => fmtDate(c.date) + ' (' + c.total + '%)').join(', ')}</div>` : ''}
          ${(r.conflicts.unavailabilityConflicts || []).length ? `<div style="font-size:.82rem;color:var(--warning)">Penugasan bertabrakan dengan ketidakhadiran pribadi: ${(r.conflicts.unavailabilityConflicts).map((c) => esc(c.task_name) + ' (' + fmtDate(c.unavailability_start) + '–' + fmtDate(c.unavailability_end) + ' · ' + esc(c.reason) + ')').join('; ')}</div>` : ''}
          ${r.conflicts.inactive ? '<div style="font-size:.82rem;color:var(--danger)">Anggota ini nonaktif tetapi masih memiliki penugasan.</div>' : ''}
        </div>`).join('')}
    </div>` : '<div class="alert success">Tidak ada konflik beban kerja pada proyek ini.</div>';

  canvas.querySelectorAll('.res-block').forEach((b) => {
    b.onclick = () => {
      const taskId = Number(b.dataset.task);
      api.get(`/api/analysis/${project.id}/gantt`).then((g) => {
        const t = g.tasks.find((x) => x.id === taskId);
        if (t) Views.taskDetailModalFor(project, t);
      });
    };
  });
}

// helper untuk detail tugas (dibagikan antar tab): ambil ulang data lalu buka modal detail
Views.taskDetailModalFor = async function (project, task) {
  const data = await api.get(`/api/projects/${project.id}/tasks`);
  const t = data.tasks.find((x) => x.id === task.id);
  if (!t) return;
  // pastikan konteks modal tugas terisi walaupun tab Tugas belum pernah dibuka
  await Views.hydrateTaskModalCtx(project, data);
  Views.taskDetailModal(project, t, data);
};
