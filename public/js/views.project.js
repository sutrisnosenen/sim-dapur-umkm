// View detail proyek + formulir proyek
window.Views = window.Views || {};

// ================= FORMULIR PROYEK (buat/ubah) =================
Views.projectForm = async function (id, onSaved) {
  const users = (currentUser.role === 'admin') ? await api.get('/api/users') : [];
  const proj = id ? await api.get('/api/projects/' + id) : null;
  const managers = currentUser.role === 'admin'
    ? users.filter((u) => ['admin', 'manager'].includes(u.role))
    : [{ id: currentUser.id, full_name: currentUser.full_name }];

  openModal(proj ? 'Ubah Proyek' : 'Proyek Baru', `
    <form id="proj-form">
      <label>Nama Proyek *</label>
      <input name="name" required value="${esc(proj?.name || '')}" />
      <div class="form-row">
        <div><label>Organisasi / UMKM *</label><input name="organization" required value="${esc(proj?.organization || '')}" /></div>
        <div><label>Lokasi</label><input name="location" value="${esc(proj?.location || '')}" /></div>
      </div>
      <label>Deskripsi</label>
      <textarea name="description" rows="3">${esc(proj?.description || '')}</textarea>
      <div class="form-row">
        <div><label>Tanggal Mulai *</label><input type="date" name="start_date" required value="${proj?.start_date || ''}" /></div>
        <div><label>Target Tanggal Selesai *</label><input type="date" name="target_end_date" required value="${proj?.target_end_date || ''}" /></div>
      </div>
      <div class="form-row">
        ${currentUser.role === 'admin' ? `
        <div><label>Manajer Proyek *</label>
          <select name="manager_id">${managers.map((u) => `<option value="${u.id}" ${proj?.manager_id === u.id ? 'selected' : ''}>${esc(u.full_name)}</option>`).join('')}</select>
        </div>` : ''}
        <div><label>Status</label>
          <select name="status">${['Perencanaan', 'Berjalan', 'Ditunda', 'Selesai', 'Dibatalkan'].map((s) => `<option ${proj?.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
        </div>
      </div>
      <div id="proj-form-err" class="alert error hidden"></div>
      <div class="modal-actions">
        <button type="button" class="btn" id="pf-cancel">Batal</button>
        <button type="submit" class="btn primary">${proj ? 'Simpan Perubahan' : 'Buat Proyek'}</button>
      </div>
    </form>`, {
    onMount: (m) => {
      m.querySelector('#pf-cancel').onclick = closeModal;
      m.querySelector('#proj-form').onsubmit = async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        const body = Object.fromEntries(f.entries());
        if (currentUser.role !== 'admin') delete body.manager_id;
        try {
          if (proj) await api.put('/api/projects/' + proj.id, body);
          else await api.post('/api/projects', body);
          closeModal();
          toast('Proyek berhasil disimpan.', 'success');
          if (onSaved) onSaved(); else route();
        } catch (err) {
          const eb = m.querySelector('#proj-form-err');
          eb.textContent = err.message;
          eb.classList.remove('hidden');
        }
      };
    },
  });
};

// ================= DETAIL PROYEK =================
Views.projectDetail = async function (projectId, tab) {
  const project = await api.get('/api/projects/' + projectId);
  document.getElementById('page-title').textContent = project.name;
  const canManage = project.can_manage;

  const tabs = [
    ['ringkasan', 'Ringkasan'],
    ['kalender', 'Kalender'],
    ['tugas', 'Tugas'],
    ['gantt', 'Gantt Chart'],
    ['pert', 'PERT Chart'],
    ['kritikal', 'Jalur Kritis'],
    ['sumberdaya', 'Sumber Daya'],
    ['resourcechart', 'Resource Chart'],
    ['laporan', 'Laporan'],
  ];
  // Anggota tim (member) hanya melihat ringkasan, kalender, tugas, gantt, pert, kritikal, resourcechart, laporan
  const allowed = currentUser.role === 'member'
    ? tabs.filter(([k]) => !['sumberdaya'].includes(k))
    : tabs;
  if (!allowed.some(([k]) => k === tab)) tab = 'ringkasan';

  const content = document.getElementById('content');
  content.classList.toggle('gantt-page', tab === 'gantt');
  content.innerHTML = `
    <div class="card" style="padding:14px 18px">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center">
        <div>
          <div style="font-weight:700;font-size:1.05rem">${esc(project.name)}</div>
          <div style="color:var(--muted);font-size:.85rem">${esc(project.organization)} · Manajer: ${esc(project.manager_name)}</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          ${statusBadge(project.status)}
          ${progressBar(project.progress)}
          ${canManage ? `<button class="btn small" id="edit-project">Edit Proyek</button>` : ''}
        </div>
      </div>
    </div>
    <div class="tabs">
      ${allowed.map(([k, label]) => `<button class="tab ${k === tab ? 'active' : ''}" data-tab="${k}">${label}</button>`).join('')}
    </div>
    <div id="tab-body"><div class="loading-box"><span class="spinner"></span> Memuat…</div></div>`;

  content.querySelectorAll('.tab').forEach((b) => b.onclick = () => {
    location.hash = `#/project/${projectId}/${b.dataset.tab}`;
  });
  const editBtn = content.querySelector('#edit-project');
  if (editBtn) editBtn.onclick = () => Views.projectForm(projectId);

  const body = content.querySelector('#tab-body');
  const renderers = {
    ringkasan: () => renderRingkasan(body, project, canManage),
    kalender: () => renderKalender(body, project, canManage),
    tugas: () => renderTugas(body, project, canManage),
    gantt: () => renderGantt(body, project, canManage),
    pert: () => renderPert(body, project, canManage),
    kritikal: () => renderKritikal(body, project),
    sumberdaya: () => renderSumberDayaProyek(body, project, canManage),
    resourcechart: () => renderResourceChart(body, project),
    laporan: () => renderLaporan(body, project),
  };
  await renderers[tab]();
};

// ---------- Tab: Ringkasan ----------
async function renderRingkasan(body, project, canManage) {
  const [report, users] = await Promise.all([
    api.get(`/api/analysis/${project.id}/report`),
    canManage ? api.get('/api/users').catch(() => []) : Promise.resolve([]),
  ]);
  const c = report.counts;
  body.innerHTML = `
    <div class="grid cols-2">
      <div class="card">
        <h3>ℹ️ Informasi Proyek</h3>
        <dl class="detail-kv">
          <dt>Organisasi</dt><dd>${esc(project.organization)}</dd>
          <dt>Lokasi</dt><dd>${esc(project.location || '-')}</dd>
          <dt>Deskripsi</dt><dd style="font-weight:400">${esc(project.description || '-')}</dd>
          <dt>Tanggal Mulai</dt><dd>${fmtDate(project.start_date)}</dd>
          <dt>Target Selesai</dt><dd>${fmtDate(project.target_end_date)}</dd>
          <dt>Aktual Selesai</dt><dd>${fmtDate(report.project.actual_end_date)}</dd>
          <dt>Manajer Proyek</dt><dd>${esc(report.project.manager_name)}</dd>
        </dl>
      </div>
      <div class="card">
        <h3>📈 Status Pekerjaan</h3>
        <dl class="detail-kv">
          <dt>Progres Proyek</dt><dd>${report.project.progress}% (rata-rata tertimbang durasi tugas daun)</dd>
          <dt>Total Tugas</dt><dd>${c.total_tasks}</dd>
          <dt>Selesai</dt><dd>${c.completed}</dd>
          <dt>Sedang Berjalan</dt><dd>${c.running}</dd>
          <dt>Terhambat</dt><dd>${c.blocked}</dd>
          <dt>Terlambat</dt><dd style="${c.late ? 'color:var(--danger)' : ''}">${c.late}</dd>
          <dt>Tugas Kritis</dt><dd>${c.critical}</dd>
          <dt>Estimasi Penyelesaian</dt><dd>${report.estimated_finish ? fmtDate(report.estimated_finish) : '-'} ${report.is_late ? '<span class="badge critical">TERLAMBAT dari target</span>' : ''}</dd>
        </dl>
      </div>
    </div>
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
        <h3 style="margin:0">👥 Anggota Proyek (akun)</h3>
        ${canManage ? '<button class="btn primary" id="rm-add">+ Tambah Anggota</button>' : ''}
      </div>
      <div style="font-size:.78rem;color:var(--muted);margin-bottom:8px">Akun yang terdaftar di sini dapat melihat proyek ini sesuai perannya (Anggota Tim: daftar tugas & progres; Manajer: pengelolaan proyek).</div>
      <div class="table-scroll"><table class="tbl">
        <thead><tr><th>Nama</th><th>Username</th><th>Peran di Proyek</th>${canManage ? '<th style="width:110px"></th>' : ''}</tr></thead>
        <tbody>
          ${report.members.map((mm) => `<tr>
            <td><b>${esc(mm.full_name)}</b></td><td>${esc(mm.username)}</td>
            <td>${esc(mm.role_label || mm.role || '-')}</td>
            ${canManage ? `<td><button class="btn small danger" data-rm-del="${mm.user_id}">Keluarkan</button></td>` : ''}
          </tr>`).join('') || `<tr><td colspan="${canManage ? 4 : 3}" class="empty-state">Belum ada anggota akun yang terdaftar di proyek ini.</td></tr>`}
        </tbody>
      </table></div>
    </div>`;

  if (!canManage) return;
  const addBtn = body.querySelector('#rm-add');
  if (addBtn) {
    addBtn.onclick = () => {
      const projMembers = report.members;
      const options = users
        .filter((u) => !projMembers.some((m) => m.user_id === u.id))
        .map((u) => `<option value="${u.id}">${esc(u.full_name)} (${esc(u.username)} — ${esc(u.role)})</option>`).join('');
      openModal('Tambah Anggota Proyek', `
        <div class="alert info" style="font-size:.84rem">Pilih akun yang sudah terdaftar. Akun langsung mendapat hak akses ke proyek dan tersedia pada panel Penugasan Anggota di detail tugas.</div>
        <form id="rm-form">
          <label>Akun Pengguna</label>
          ${options ? `<select name="user_id" required>${options}</select>` : '<div class="alert warning">Semua akun pengguna sudah menjadi anggota proyek ini.</div>'}
          <label>Peran di Proyek</label>
          <input name="role_label" placeholder="cth: Petugas Pengadaan" />
          <div id="rm-form-err" class="alert error hidden"></div>
          ${options ? '<div class="modal-actions"><button type="button" class="btn" id="rm-cancel">Batal</button><button type="submit" class="btn primary">Tambahkan</button></div>' : ''}
        </form>`, {
        onMount: (m) => {
          const cancel = m.querySelector('#rm-cancel');
          if (cancel) cancel.onclick = closeModal;
          const form = m.querySelector('#rm-form');
          if (!form) return;
          form.onsubmit = async (e) => {
            e.preventDefault();
            try {
              await api.post(`/api/projects/${project.id}/members`, {
                user_id: Number(form.user_id.value),
                role_label: form.role_label.value,
              });
              closeModal();
              toast('Anggota ditambahkan ke proyek.', 'success');
              route();
            } catch (err) {
              const eb = m.querySelector('#rm-form-err');
              eb.textContent = err.message;
              eb.classList.remove('hidden');
            }
          };
        },
      });
    };
  }
  body.querySelectorAll('[data-rm-del]').forEach((b) => b.onclick = () => {
    confirmDialog('Keluarkan akun ini dari proyek? Ia tidak lagi dapat melihat proyek ini, dan penugasannya pada tugas tetap tersimpan.', async () => {
      try {
        await api.del(`/api/projects/${project.id}/members/${b.dataset.rmDel}`);
        toast('Anggota dikeluarkan dari proyek.', 'success');
        route();
      } catch (err) { toast(err.message, 'error'); }
    });
  });
}

// ---------- Tab: Kalender ----------
async function renderKalender(body, project, canManage) {
  const data = await api.get(`/api/projects/${project.id}/calendar`);
  const [year, month] = (new Date().toISOString().slice(0, 7)).split('-').map(Number);
  let viewYear = year, viewMonth = month;
  const dayNames = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
  const holidayByDate = {};
  for (const h of data.holidays) holidayByDate[h.date] = h;

  body.innerHTML = `
    <div class="grid cols-2">
      <div class="card">
        <h3>🗓️ Kalender Bulanan</h3>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <button class="btn small" id="cal-prev">◀</button>
          <b id="cal-label"></b>
          <button class="btn small" id="cal-next">▶</button>
        </div>
        <div id="calendar-grid"></div>
        <div style="font-size:.78rem;color:var(--muted);margin-top:8px">
          Merah = hari libur (nasional/khusus), Abu = akhir pekan. Jadwal otomatis melewati hari-hari ini.
        </div>
      </div>
      <div class="card">
        <h3>⚙️ Konfigurasi Kalender Kerja</h3>
        <form id="cal-form">
          <label>Hari Kerja dalam Se Minggu</label>
          <div class="checkbox-list" id="cal-workdays">
            ${['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'].map((n, i) => `
              <label><input type="checkbox" value="${i + 1}" ${data.workdays.includes(i + 1) ? 'checked' : ''} ${!canManage ? 'disabled' : ''}/> ${n}</label>`).join('')}
          </div>
          <div class="form-row">
            <div><label>Jam Kerja Mulai</label><input type="time" name="work_start_time" value="${data.calendar?.work_start_time || '08:00'}" ${!canManage ? 'disabled' : ''} /></div>
            <div><label>Jam Kerja Selesai</label><input type="time" name="work_end_time" value="${data.calendar?.work_end_time || '17:00'}" ${!canManage ? 'disabled' : ''} /></div>
            <div><label>Jam Kerja / Hari</label><input type="number" name="hours_per_day" step="0.5" min="1" max="24" value="${data.calendar?.hours_per_day || 8}" ${!canManage ? 'disabled' : ''} /></div>
          </div>
          ${canManage ? '<button class="btn primary" style="margin-top:10px">Simpan Kalender Kerja</button>' : ''}
          <div id="cal-form-err" class="alert error hidden"></div>
        </form>
        <h3 style="margin-top:20px">🚩 Daftar Hari Libur</h3>
        ${canManage ? `
        <form id="holiday-form" class="form-row" style="align-items:flex-end">
          <div><label>Tanggal</label><input type="date" name="date" required /></div>
          <div><label>Nama Libur</label><input name="name" required placeholder="cth: Hari Raya Idulfitri" /></div>
          <div><label>Tipe</label>
            <select name="type"><option value="nasional">Libur Nasional</option><option value="khusus">Libur Khusus Proyek</option></select>
          </div>
          <div style="flex:0"><button class="btn primary">Tambah</button></div>
        </form>` : ''}
        <div class="table-scroll" style="margin-top:10px">
        <table class="tbl"><thead><tr><th>Tanggal</th><th>Nama</th><th>Tipe</th>${canManage ? '<th></th>' : ''}</tr></thead><tbody>
          ${data.holidays.map((h) => `
            <tr>
              <td>${fmtDate(h.date)}</td><td>${esc(h.name)}</td>
              <td><span class="badge ${h.type === 'nasional' ? 'st-Perencanaan' : 'st-Terhambat'}">${h.type === 'nasional' ? 'Nasional' : 'Khusus'}</span></td>
              ${canManage ? `<td><button class="btn small danger" data-del="${h.id}">Hapus</button></td>` : ''}
            </tr>`).join('')}
        </tbody></table></div>
      </div>
    </div>`;

  function drawCalendar() {
    const first = new Date(viewYear, viewMonth - 1, 1);
    const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
    let startIdx = (first.getDay() + 6) % 7; // Senin pertama
    const nm = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    body.querySelector('#cal-label').textContent = `${nm[viewMonth - 1]} ${viewYear}`;
    let html = '<div class="calendar-grid">' + dayNames.map((d) => `<div style="text-align:center;font-size:.72rem;font-weight:700;color:var(--muted)">${d}</div>`).join('');
    for (let i = 0; i < startIdx; i++) html += '<div></div>';
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = `${viewYear}-${String(viewMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const wd = new Date(viewYear, viewMonth - 1, d).getDay();
      const cls = [
        'cal-cell',
        (wd === 0 || wd === 6) ? 'weekend' : '',
        holidayByDate[ds] ? 'holiday' : '',
      ].join(' ');
      html += `<div class="${cls}"><div class="d">${d}</div>${holidayByDate[ds] ? `<div class="hol-name">${esc(holidayByDate[ds].name)}</div>` : ''}</div>`;
    }
    html += '</div>';
    body.querySelector('#calendar-grid').innerHTML = html;
  }
  drawCalendar();
  body.querySelector('#cal-prev').onclick = () => { viewMonth--; if (viewMonth < 1) { viewMonth = 12; viewYear--; } drawCalendar(); };
  body.querySelector('#cal-next').onclick = () => { viewMonth++; if (viewMonth > 12) { viewMonth = 1; viewYear++; } drawCalendar(); };

  body.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => {
    confirmDialog('Hapus hari libur ini? Jadwal akan dihitung ulang.', async () => {
      await api.del(`/api/projects/${project.id}/calendar/holidays/${b.dataset.del}`);
      toast('Hari libur dihapus, jadwal dihitung ulang.', 'success');
      route();
    });
  });

  body.querySelector('#cal-form').onsubmit = async (e) => {
    e.preventDefault();
    const fds = [...body.querySelectorAll('#cal-workdays input:checked')].map((c) => c.value);
    if (!fds.length) {
      const eb = body.querySelector('#cal-form-err'); eb.textContent = 'Minimal satu hari kerja harus dipilih.'; eb.classList.remove('hidden');
      return;
    }
    const f = new FormData(e.target);
    try {
      await api.put(`/api/projects/${project.id}/calendar`, {
        workdays: fds.join(','),
        work_start_time: f.get('work_start_time'),
        work_end_time: f.get('work_end_time'),
        hours_per_day: f.get('hours_per_day'),
      });
      toast('Kalender kerja diperbarui; jadwal dihitung ulang.', 'success');
      route();
    } catch (err) {
      const eb = body.querySelector('#cal-form-err'); eb.textContent = err.message; eb.classList.remove('hidden');
    }
  };

  const holForm = body.querySelector('#holiday-form');
  if (holForm) {
    holForm.onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        await api.post(`/api/projects/${project.id}/calendar/holidays`, {
          date: f.get('date'), name: f.get('name'), type: f.get('type'),
        });
        toast('Hari libur ditambahkan; jadwal dihitung ulang.', 'success');
        route();
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }
}

// ---------- Tab: Tugas ----------


// ==========================================================================
// Modal tugas tingkat modul — dapat dibuka dari tab Tugas maupun Gantt/PERT/Resource Chart.
// Konteks (data tugas, proyek, hak akses, resource aktif) diisi renderTugas() saat tab Tugas
// dibuka, atau Views.hydrateTaskModalCtx() saat modal dipanggil dari tab lain.
const tugasCtx = { data: null, project: null, canManage: false, activeResources: [] };

Views.hydrateTaskModalCtx = async function (project, data) {
  Object.assign(tugasCtx, { data, project, canManage: !!project.can_manage, activeResources: [] });
  try {
    const resources = await api.get('/api/resources');
    tugasCtx.activeResources = resources.filter((r) => r.is_active);
  } catch (e) { /* anggota tanpa akses daftar resource: daftar kosong cukup */ }
};

Views.taskDetailModal = function (projectArg, taskArg) {
  const found = (tugasCtx.data && tugasCtx.data.tasks || []).find((x) => x.id === taskArg.id);
  if (found) taskDetailModal(found); else route();
};
Views.taskFormModal = function (projectArg, taskArg, parentArg) {
  taskFormModal(taskArg || null, parentArg || null);
};
  // ===== Modal formulir tugas (buat / ubah) =====
  function taskFormModal(task, parentTask, onSavedInternal) {
  openModal(task ? 'Ubah Tugas' : `Tambah Tugas${parentTask ? ' (subtugas dari ' + parentTask.name + ')' : ''}`, `
    <form id="task-form">
      ${parentTask ? '' : `<div class="form-row"><div><label>Tugas Induk (opsional)</label>
        <select name="parent_task_id"><option value="">— Tidak ada (tugas utama) —</option>
          ${tugasCtx.data.tasks.filter((t) => !t.parent_task_id).map((t) => `<option value="${t.id}" ${task?.parent_task_id === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
        </select></div></div>`}
      <label>Nama Tugas *</label>
      <input name="name" required value="${esc(task?.name || '')}" />
      <div class="form-row">
        <div><label>Tanggal Mulai Rencana *</label><input type="date" name="planned_start" required value="${task?.planned_start || tugasCtx.project.start_date}" /></div>
        ${!task || !isParent(task) ? `<div><label>Durasi (hari kerja) *</label><input type="number" name="duration" min="1" required value="${task?.duration || 1}" /></div>` : ''}
        ${task && isParent(task) ? '<div><label style="color:var(--muted)">Durasi dihitung otomatis dari subtugas</label><input disabled value="otomatis" /></div>' : ''}
      </div>
      <div class="form-row">
        <div><label>Prioritas</label>
          <select name="priority">${['Rendah', 'Sedang', 'Tinggi', 'Mendesak'].map((p) => `<option ${(task?.priority || 'Sedang') === p ? 'selected' : ''}>${p}</option>`).join('')}</select>
        </div>
        <div><label>Status</label>
          <select name="status">${['Belum Dimulai', 'Berjalan', 'Terhambat', 'Selesai', 'Dibatalkan'].map((s) => `<option ${(task?.status || 'Belum Dimulai') === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
        </div>
      </div>
      <label>Deskripsi</label>
      <textarea name="description" rows="2">${esc(task?.description || '')}</textarea>
      <label>Catatan</label>
      <textarea name="notes" rows="2">${esc(task?.notes || '')}</textarea>
      <div id="task-form-err" class="alert error hidden"></div>
      <div class="modal-actions">
        <button type="button" class="btn" id="tf-cancel">Batal</button>
        <button type="submit" class="btn primary">Simpan</button>
      </div>
    </form>`, {
    onMount: (m) => {
      m.querySelector('#tf-cancel').onclick = closeModal;
      m.querySelector('#task-form').onsubmit = async (e) => {
        e.preventDefault();
        const payload = Object.fromEntries(new FormData(e.target).entries());
        delete payload.__proto__;
        try {
          if (parentTask && !task) payload.parent_task_id = parentTask.id;
          if (task) await api.put(`/api/projects/${tugasCtx.project.id}/tasks/${task.id}`, payload);
          else await api.post(`/api/projects/${tugasCtx.project.id}/tasks`, payload);
          closeModal();
          toast('Tugas disimpan. Jadwal dihitung ulang.', 'success');
          route();
        } catch (err) {
          const eb = m.querySelector('#task-form-err');
          eb.textContent = err.message;
          eb.classList.remove('hidden');
        }
      };
    },
  });
}
  function isParent(t) { return tugasCtx.data.tasks.some((x) => x.parent_task_id === t.id); }

  // ===== Modal detail tugas: dependensi + penugasan + progres =====
  function taskDetailModal(t) {
  const depList = tugasCtx.data.dependencies.filter((d) => d.predecessor_id === t.id || d.successor_id === t.id);
  const assigns = tugasCtx.data.assignments[t.id] || [];
  openModal('Detail Tugas', `
    <dl class="detail-kv">
      <dt>Nama</dt><dd>${esc(t.name)}</dd>
      <dt>Deskripsi</dt><dd style="font-weight:400">${esc(t.description || '-')}</dd>
      <dt>Kategori</dt><dd>${isParent(t) ? 'Tugas induk (jadwal otomatis dari subtugas)' : 'Tugas daun'}</dd>
      <dt>Periode Jadwal</dt><dd>${fmtDate(t.start_date)} — ${fmtDate(t.end_date)} (${t.duration} hari kerja)</dd>
      <dt>Prioritas / Status</dt><dd>${priorityBadge(t.priority)} ${statusBadge(t.status)}</dd>
      <dt>Progres</dt><dd>${progressBar(t.progress)}</dd>
      <dt>Catatan</dt><dd style="font-weight:400">${esc(t.notes || '-')}</dd>
    </dl>
    ${tugasCtx.canManage ? `
    <h3 style="margin-top:16px">🔗 Dependensi</h3>
    <table class="tbl"><thead><tr><th>Jenis</th><th>Pendahulu</th><th>Penerus</th><th>Lag (hari kerja)</th><th></th></tr></thead><tbody>
      ${depList.map((d) => `
        <tr><td><b>${d.type}</b></td><td>${esc(d.predecessor_name)}</td><td>${esc(d.successor_name)}</td>
        <td style="width:90px"><input type="number" min="0" value="${d.lag}" data-lag="${d.id}" /></td>
        <td style="display:flex;gap:6px">
          <button class="btn small" data-savedep="${d.id}">Simpan Lag</button>
          <button class="btn small danger" data-deldep="${d.id}">Hapus</button>
        </td></tr>`).join('') || '<tr><td colspan="5" class="empty-state">Tidak ada dependensi.</td></tr>'}
    </tbody></table>
    <div class="form-row" style="align-items:flex-end;margin-top:10px" id="add-dep-row">
      <div><label>Pendahulu</label><select id="dep-pred">${tugasCtx.data.tasks.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></div>
      <div><label>Penerus</label><select id="dep-succ">${tugasCtx.data.tasks.map((x) => `<option value="${x.id}" ${x.id === t.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
      <div><label>Jenis</label><select id="dep-type"><option value="FS">FS (Finish-to-Start)</option><option value="SS">SS (Start-to-Start)</option></select></div>
      <div><label>Lag (hari kerja)</label><input id="dep-lag" type="number" value="0" min="0" style="width:90px" /></div>
      <div style="flex:0"><button class="btn primary" id="dep-add">Tambah Dependensi</button></div>
    </div>
    <div style="font-size:.78rem;color:var(--muted)">${esc(tugasCtx.data.dependencies.map((d) => `${d.type}: ${d.predecessor_name} → ${d.successor_name}`).join(' '))}</div>
    <h3 style="margin-top:16px">👥 Penugasan Anggota</h3>
    <table class="tbl"><thead><tr><th>Anggota</th><th>Peran di Tugas</th><th>Alokasi %</th><th></th></tr></thead><tbody>
      ${assigns.map((a) => `
        <tr><td>${esc(a.resource_name)}${a.resource_active ? '' : ' <span class="badge st-Terhambat">nonaktif</span>'}</td>
        <td style="width:150px"><input value="${esc(a.role_on_task)}" data-role="${a.id}" /></td>
        <td style="width:90px"><input type="number" min="1" max="100" value="${a.allocation}" data-alloc="${a.id}" /></td>
        <td style="display:flex;gap:6px">
          <button class="btn small" data-saveassign="${a.id}">Simpan</button>
          <button class="btn small danger" data-delassign="${a.id}">Hapus</button>
        </td></tr>`).join('') || '<tr><td colspan="4" class="empty-state">Belum ada anggota yang ditugaskan.</td></tr>'}
    </tbody></table>
    <div class="form-row" style="align-items:flex-end;margin-top:10px">
      <div><label>Anggota</label><select id="as-res">${tugasCtx.activeResources.map((r) => `<option value="${r.id}">${esc(r.name)} — ${esc(r.role)}</option>`).join('')}</select></div>
      <div><label>Alokasi %</label><input id="as-alloc" type="number" min="1" max="100" value="100" style="width:90px" /></div>
      <div><label>Peran di Tugas</label><input id="as-role" placeholder="cth: Koordinator" style="width:150px" /></div>
      <div style="flex:0"><button class="btn primary" id="as-add">Tambah Penugasan</button></div>
    </div>` : ''}
    <h3 style="margin-top:16px">✏️ Ubah Data</h3>
    ${tugasCtx.canManage ? `
    <div class="modal-actions" style="justify-content:flex-start;gap:8px">
      <button class="btn" id="task-edit">Edit Data Tugas</button>
      <button class="btn" id="task-subtask">+ Tambah Subtugas</button>
      <button class="btn danger" id="task-del">Hapus Tugas</button>
    </div>` : ''}
    <div class="modal-actions"><button class="btn" id="task-close">Tutup</button></div>
  `, {
    wide: true,
    onMount: (m) => {
      m.querySelector('#task-close').onclick = closeModal;
      if (!tugasCtx.canManage) return;
      m.querySelectorAll('[data-savedep]').forEach((b) => b.onclick = async () => {
        const depId = b.dataset.savedep;
        const lag = m.querySelector(`[data-lag="${depId}"]`).value;
        try {
          await api.put(`/api/projects/${tugasCtx.project.id}/dependencies/${depId}`, { lag });
          toast('Dependensi diperbarui.', 'success'); closeModal(); route();
        } catch (err) { toast(err.message, 'error'); }
      });
      m.querySelectorAll('[data-deldep]').forEach((b) => b.onclick = () => {
        confirmDialog('Hapus dependensi ini?', async () => {
          await api.del(`/api/projects/${tugasCtx.project.id}/dependencies/${b.dataset.deldep}`);
          toast('Dependensi dihapus.', 'success'); closeModal(); route();
        });
      });
      m.querySelector('#dep-add').onclick = async () => {
        try {
          const r = await api.post(`/api/projects/${tugasCtx.project.id}/dependencies`, {
            predecessor_id: Number(m.querySelector('#dep-pred').value),
            successor_id: Number(m.querySelector('#dep-succ').value),
            type: m.querySelector('#dep-type').value,
            lag: Number(m.querySelector('#dep-lag').value),
          });
          toast('Dependensi ditambahkan.', 'success');
          route();
        } catch (err) { toast(err.message, 'error'); }
      };
      m.querySelectorAll('[data-saveassign]').forEach((b) => b.onclick = async () => {
        const id = b.dataset.saveassign;
        try {
          const resp = await api.put('/api/resources/assignments/' + id, {
            role_on_task: m.querySelector(`[data-role="${id}"]`).value,
            allocation: Number(m.querySelector(`[data-alloc="${id}"]`).value),
          });
          toast('Penugasan disimpan.', 'success');
          (resp.warnings || []).forEach((w) => toast('Peringatan: beban kerja berlebih pada ' + w.date + ' (total ' + w.total + '%)', 'error', 6000));
          closeModal(); route();
        } catch (err) { toast(err.message, 'error'); }
      });
      m.querySelectorAll('[data-delassign]').forEach((b) => b.onclick = () => {
        confirmDialog('Hapus penugasan anggota ini dari tugas?', async () => {
          await api.del('/api/resources/assignments/' + b.dataset.delassign);
          toast('Penugasan dihapus.', 'success'); closeModal(); route();
        });
      });
      m.querySelector('#as-add').onclick = async () => {
        try {
          const resp = await api.post('/api/resources/assignments', {
            task_id: t.id,
            resource_id: Number(m.querySelector('#as-res').value),
            allocation: Number(m.querySelector('#as-alloc').value),
            role_on_task: m.querySelector('#as-role').value,
          });
          toast('Penugasan ditambahkan.', 'success');
          const w = resp.warnings || {};
          if (w.overallocationDays && w.overallocationDays.length) {
            toast(`Peringatan: alokasi total melebihi 100% pada ${w.overallocationDays.length} hari. Tinjau Resource Chart.`, 'error', 7000);
          }
          if (w.unavailabilityConflicts && w.unavailabilityConflicts.length) {
            toast(`Peringatan: penugasan bertabrakan dengan hari libur/ketidakhadiran pribadi (${w.unavailabilityConflicts.length} tugas).`, 'error', 7000);
          }
          if (w.inactive) toast('Peringatan: anggota ini berstatus nonaktif.', 'error', 6000);
          route();
        } catch (err) { toast(err.message, 'error'); }
      };
      m.querySelector('#task-edit').onclick = () => { closeModal(); taskFormModal(t, null); };
      m.querySelector('#task-subtask').onclick = () => { closeModal(); taskFormModal(null, t); };
      m.querySelector('#task-del').onclick = () => {
        confirmDialog(`Hapus tugas "${t.name}"? Subtugas dan penugasannya di bawahnya ikut terhapus.`, async () => {
          await api.del(`/api/projects/${tugasCtx.project.id}/tasks/${t.id}`);
          toast('Tugas dihapus.', 'success'); closeModal(); route();
        });
      };
    },
  });
}
  // ekspos modal agar dapat dibuka dari tab Gantt/PERT/Resource Chart
  Views.taskDetailModal = function (projectArg, taskArg) {
  const found = tugasCtx.data.tasks.find((x) => x.id === taskArg.id);
  if (found) taskDetailModal(found); else route();
  };
  Views.taskFormModal = function (projectArg, taskArg, parentArg) {
  taskFormModal(taskArg || null, parentArg || null);
  };


async function renderTugas(body, project, canManage) {
  const data = await api.get(`/api/projects/${project.id}/tasks`);
  const resources = await api.get('/api/resources');
  const activeResources = resources.filter((r) => r.is_active);
  Object.assign(tugasCtx, { data, project, canManage, activeResources });

  body.innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:10px">
        <h3 style="margin:0">✅ Daftar Tugas & Subtugas</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <select id="tf-status" style="width:150px"><option value="">Semua status</option>${['Belum Dimulai', 'Berjalan', 'Terhambat', 'Selesai', 'Dibatalkan'].map((s) => `<option>${s}</option>`).join('')}</select>
          <select id="tf-priority" style="width:130px"><option value="">Semua prioritas</option>${['Rendah', 'Sedang', 'Tinggi', 'Mendesak'].map((s) => `<option>${s}</option>`).join('')}</select>
          <input id="tf-q" placeholder="Cari tugas…" style="width:180px" />
          ${canManage ? '<button class="btn primary" id="btn-new-task">+ Tambah Tugas</button>' : ''}
        </div>
      </div>
      <div class="info-banner"></div>
      <div id="task-list"></div>
    </div>`;

  body.querySelector('.info-banner').innerHTML = `
    <div class="alert info">Durasi dalam <b>hari kerja</b>. Tanggal selesai dihitung otomatis dari tanggal mulai + durasi + kalender kerja${canManage ? '; ubah data memicu hitung ulang otomatis dan penerbitan konflik bila dependensi berbenturan dengan tanggal yang diinput.' : '.'}</div>`;

  // untuk anggota: daftar tugas yang ditugaskan kepadanya (via tautan akun-anggota)
  let myTaskIds = new Set();
  if (currentUser.role === 'member') {
    try {
      const mine = await api.get('/api/resources/assignments');
      myTaskIds = new Set((mine || []).map((x) => x.task_id));
    } catch { /* abaikan */ }
  }

  function matches(t) {
    const st = body.querySelector('#tf-status').value;
    const pr = body.querySelector('#tf-priority').value;
    const q = body.querySelector('#tf-q').value.toLowerCase();
    return (!st || t.status === st) && (!pr || t.priority === pr) && (!q || t.name.toLowerCase().includes(q));
  }

  function drawList() {
    const byParent = {};
    const roots = [];
    const depMap = {};
    for (const d of data.dependencies) {
      (depMap[d.successor_id] = depMap[d.successor_id] || []).push(d);
    }
    for (const t of data.tasks) {
      if (t.parent_task_id) (byParent[t.parent_task_id] = byParent[t.parent_task_id] || []).push(t);
      else roots.push(t);
    }
    const rowsHtml = [];
    function drawRow(t, depth) {
      if (!matches(t)) { (byParent[t.id] || []).forEach((c) => drawRow(c, depth)); return; }
      const assigns = (data.assignments[t.id] || []).map((a) => a.resource_name).join(', ');
      rowsHtml.push(`
        <tr style="display:table-row">
          <td style="padding-left:${10 + depth * 22}px">
            ${depth > 0 ? '<span style="color:var(--muted)">↳ </span>' : ''}
            <b>${esc(t.name)}</b>
            ${depMap[t.id] ? `<div style="font-size:.72rem;color:var(--muted)">Dependensi: ${depMap[t.id].map((d) => `${d.type}(${esc(d.predecessor_name)}, lag ${d.lag})`).join('; ')}</div>` : ''}
          </td>
          <td>${fmtDate(t.start_date)}</td>
          <td>${fmtDate(t.end_date)}</td>
          <td>${t.duration} hari kerja</td>
          <td>${priorityBadge(t.priority)}</td>
          <td>${statusBadge(t.status)}</td>
          <td>${progressBar(t.progress)}</td>
          <td style="font-size:.76rem">${esc(assigns) || '-'}</td>
          <td>
            <div class="actions">
              <button class="btn small" data-detail="${t.id}">Detail</button>
              ${!canManage && myTaskIds.has(t.id) ? `<button class="btn small primary" data-myprogress="${t.id}">Perbarui Progres</button>` : ''}
            </div>
          </td>
        </tr>`);
      (byParent[t.id] || []).forEach((c) => drawRow(c, depth + 1));
    }
    roots.forEach((t) => drawRow(t, 0));
    const listNode = body.querySelector('#task-list');
    listNode.innerHTML = rowsHtml.length ? `
      <div class="table-scroll"><table class="tbl">
        <thead><tr><th>Nama Tugas</th><th>Mulai</th><th>Selesai</th><th>Durasi</th><th>Prioritas</th><th>Status</th><th>Progres</th><th>Anggota</th><th>Aksi</th></tr></thead>
        <tbody>${rowsHtml.join('')}</tbody>
      </table></div>` : '<div class="empty-state"><div class="big">🗂️</div>Tidak ada tugas yang cocok dengan filter.</div>';

    listNode.querySelectorAll('[data-detail]').forEach((b) => b.onclick = () => {
      const t = data.tasks.find((x) => x.id === Number(b.dataset.detail));
      taskDetailModal(t);
    });
    listNode.querySelectorAll('[data-myprogress]').forEach((b) => {
      const t = data.tasks.find((x) => x.id === Number(b.dataset.myprogress));
      Views.myTaskProgressForm(project.id, t);
    });
  }

  body.querySelector('#tf-status').onchange = drawList;
  body.querySelector('#tf-priority').onchange = drawList;
  body.querySelector('#tf-q').oninput = drawList;
  const btnNew = body.querySelector('#btn-new-task');
  if (btnNew) btnNew.onclick = () => taskFormModal(null, null);

  drawList();
}

// ================= FORMULIR PROGRES UNTUK ANGGOTA TIM =================
Views.myTaskProgressForm = async function (projectId, task) {
  openModal('Perbarui Progres: ' + task.name, `
    <form id="mp-form">
      <dl class="detail-kv">
        <dt>Periode</dt><dd>${fmtDate(task.start_date)} — ${fmtDate(task.end_date)}</dd>
        <dt>Status saat ini</dt><dd>${statusBadge(task.status)}</dd>
        <dt>Progres saat ini</dt><dd>${task.progress}%</dd>
      </dl>
      <label>Persentase Progres Baru</label>
      <input type="number" id="mp-progress" min="0" max="100" value="${task.progress}" />
      <label>Status</label>
      <select id="mp-status">
        ${['Belum Dimulai', 'Berjalan', 'Terhambat', 'Selesai'].map((s) => `<option ${task.status === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
      <div id="mp-err" class="alert error hidden"></div>
      <div class="modal-actions">
        <button type="button" class="btn" id="mp-cancel">Batal</button>
        <button type="submit" class="btn primary">Simpan Progres</button>
      </div>
    </form>`, {
    onMount: (m) => {
      const progInput = m.querySelector('#mp-progress');
      const statusSel = m.querySelector('#mp-status');
      m.querySelector('#mp-cancel').onclick = closeModal;
      m.querySelector('#mp-form').onsubmit = async (e) => {
        e.preventDefault();
        try {
          await api.put(`/api/projects/${projectId}/tasks/${task.id}`, {
            progress: Number(progInput.value),
            status: statusSel.value,
          });
          closeModal();
          toast('Progres tugas diperbarui.', 'success');
          route();
        } catch (err) {
          const eb = m.querySelector('#mp-err');
          eb.textContent = err.message;
          eb.classList.remove('hidden');
        }
      };
    },
  });
};

