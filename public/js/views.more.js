// View tambahan: sumber daya (tab proyek & global), laporan, manajemen akun
window.Views = window.Views || {};

// ============ TAB: SUMBER DAYA (dalam detail proyek) ============
async function renderSumberDayaProyek(body, project, canManage) {
  const [resources, chart, users] = await Promise.all([
    api.get('/api/resources'),
    api.get(`/api/analysis/${project.id}/resource-chart`),
    currentUser.role === 'admin' || currentUser.role === 'manager' ? api.get('/api/users').catch(() => []) : Promise.resolve([]),
  ]);
  const projMembers = project.members || [];
  const assignByRes = new Map();
  for (const r of (chart.resources || [])) assignByRes.set(r.resource_id, r);
  const myTasks = {};

  body.innerHTML = `
    <div class="grid cols-2">
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <h3 style="margin:0">👥 Anggota Tim Sumber Daya</h3>
          ${canManage ? '<button class="btn primary" id="btn-new-res">+ Tambah</button>' : ''}
        </div>
        <div class="table-scroll"><table class="tbl">
          <thead><tr><th>Nama</th><th>Peran</th><th>Tugas di Proyek Ini</th><th>Alokasi</th><th>Aksi</th></tr></thead>
          <tbody>
            ${resources.map((r) => {
              const info = assignByRes.get(r.id);
              const tasks = info ? info.assignments.map((a) => a.task_name) : [];
              myTasks[r.id] = tasks;
              return `<tr ${!r.is_active ? 'style="opacity:.55"' : ''}>
                <td><b>${esc(r.name)}</b><div style="font-size:.72rem;color:var(--muted)">Rp${fmtRp(r.rate)} / ${esc(r.rate_unit)}${r.is_active ? '' : ' · <b style="color:var(--danger)">nonaktif</b>'}</div></td>
                <td>${esc(r.role || '-')}</td>
                <td style="font-size:.8rem">${tasks.length ? tasks.map(esc).join('<br>') : '<i>belum ditugaskan</i>'}</td>
                <td>${info ? `<b style="${(info.conflicts.overallocationDays || []).length ? 'color:var(--danger)' : ''}">${info.total_days} hari kerja</b>` : '-'}</td>
                <td><div class="actions">
                  <button class="btn small" data-res-detail="${r.id}">Detail</button>
                  ${canManage ? `<button class="btn small" data-res-unav="${r.id}">Absensi</button>` : ''}
                </div></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table></div>
        <div class="alert info" style="font-size:.8rem;margin-top:10px">Penugasan & alokasi kerja diatur melalui detail tugas pada tab <b>Tugas</b> (tombol Detail → Penugasan Anggota).</div>
      </div>
      <div class="card">
        <h3>🪪 Anggota Akun Proyek (untuk login & hak akses)</h3>
        <div style="font-size:.8rem;color:var(--muted);margin-bottom:8px">Akun berstatus Anggota Tim hanya dapat melihat proyek tempat ia didaftarkan di sini.</div>
        <table class="tbl"><thead><tr><th>Nama</th><th>Username</th><th>Peran di Proyek</th>${canManage ? '<th></th>' : ''}</tr></thead>
        <tbody>
          ${projMembers.map((m) => `<tr>
            <td>${esc(m.full_name)}</td><td>${esc(m.username)}</td><td>${esc(m.role_label || m.role)}</td>
            ${canManage ? `<td><button class="btn small danger" data-delmember="${m.user_id}">Keluarkan</button></td>` : ''}
          </tr>`).join('') || '<tr><td colspan="4" class="empty-state">Belum ada akun yang ditambahkan.</td></tr>'}
        </tbody></table>
        ${canManage && users.length ? `
        <div class="form-row" style="margin-top:10px;align-items:flex-end">
          <div><label>Pilih Pengguna</label>
            <select id="member-user">
              ${users.filter((u) => !projMembers.some((m) => m.user_id === u.id)).map((u) => `<option value="${u.id}">${esc(u.full_name)} (${esc(u.role)})</option>`).join('')}
            </select>
          </div>
          <div><label>Peran di Proyek</label><input id="member-role" placeholder="cth: Petugas Pengadaan" /></div>
          <div style="flex:0"><button class="btn primary" id="member-add">Tambah</button></div>
        </div>` : ''}
      </div>
    </div>`;

  const newRes = body.querySelector('#btn-new-res');
  if (newRes) newRes.onclick = () => Views.resourceForm(null, () => route());

  body.querySelectorAll('[data-res-detail]').forEach((b) => b.onclick = () => Views.resourceDetail(Number(b.dataset.resDetail)));
  body.querySelectorAll('[data-res-unav]').forEach((b) => b.onclick = () => Views.resourceDetail(Number(b.dataset.resUnav), true));
  body.querySelectorAll('[data-delmember]').forEach((b) => b.onclick = () => {
    confirmDialog('Keluarkan akun ini dari proyek? Ia tidak lagi dapat melihat proyek ini.', async () => {
      await api.del(`/api/projects/${project.id}/members/${b.dataset.delmember}`);
      toast('Anggota dikeluarkan dari proyek.', 'success');
      route();
    });
  });
  const addBtn = body.querySelector('#member-add');
  if (addBtn) {
    addBtn.onclick = async () => {
      try {
        await api.post(`/api/projects/${project.id}/members`, {
          user_id: Number(body.querySelector('#member-user').value),
          role_label: body.querySelector('#member-role').value,
        });
        toast('Anggota akun ditambahkan ke proyek.', 'success');
        route();
      } catch (err) { toast(err.message, 'error'); }
    };
  }
}

// ============ TAB: LAPORAN ============
async function renderLaporan(body, project) {
  const r = await api.get(`/api/analysis/${project.id}/report`);
  const c = r.counts;
  body.innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <h3 style="margin:0">📄 Laporan Proyek</h3>
        <a class="btn" href="/api/analysis/${project.id}/report.csv" download>⬇ Unduh CSV</a>
      </div>
      <div class="grid cols-2" style="margin-top:12px">
        <dl class="detail-kv">
          <dt>Nama Proyek</dt><dd>${esc(r.project.name)}</dd>
          <dt>Organisasi</dt><dd>${esc(r.project.organization)}</dd>
          <dt>Manajer</dt><dd>${esc(r.project.manager_name)}</dd>
          <dt>Periode</dt><dd>${fmtDate(r.project.start_date)} → target ${fmtDate(r.project.target_end_date)}</dd>
          <dt>Status Proyek</dt><dd>${statusBadge(r.project.status)}</dd>
          <dt>Progres</dt><dd>${progressBar(r.project.progress)}<div style="font-size:.74rem;color:var(--muted)">${esc(r.progress_method)}</div></dd>
        </dl>
        <dl class="detail-kv">
          <dt>Total Tugas</dt><dd>${c.total_tasks}</dd>
          <dt>Selesai / Berjalan / Terhambat</dt><dd>${c.completed} / ${c.running} / ${c.blocked}</dd>
          <dt>Terlambat</dt><dd style="${c.late ? 'color:var(--danger);font-weight:800' : ''}">${c.late}</dd>
          <dt>Tugas Kritis</dt><dd style="color:var(--critical);font-weight:800">${c.critical}</dd>
          <dt>Estimasi Selesai</dt><dd>${r.estimated_finish ? fmtDate(r.estimated_finish) : '-'} ${r.is_late ? '<span class="badge critical">LEWAT TARGET</span>' : ''}</dd>
          <dt>Anggota Akun</dt><dd>${r.members.map((m) => esc(m.full_name)).join(', ') || '-'}</dd>
        </dl>
      </div>
      ${r.late_warning ? `<div class="alert error">${esc(r.late_warning)}</div>` : ''}
      ${r.critical_reason ? `<div class="alert warning">${esc(r.critical_reason)}</div>` : ''}
    </div>

    <div class="card">
      <h3>🧭 Jalur Kritis Proyek</h3>
      ${r.critical_path.length ? `<div class="kpi-path">${r.critical_path.map((n, i) => `${i ? '<span class="kpi-arrow">→</span>' : ''}<span class="kpi-pill">${esc(n.name)}</span>`).join('')}</div>` : '<div class="empty-state">Belum ada jalur kritis.</div>'}
    </div>

    <div class="card">
      <h3>📋 Status Seluruh Tugas</h3>
      <div class="table-scroll"><table class="tbl">
        <thead><tr><th>Tugas</th><th>Mulai</th><th>Selesai</th><th>Status</th><th>Prioritas</th><th>Progres</th><th>Kritis</th><th>Terlambat</th></tr></thead>
        <tbody>${r.tasks.map((t) => `<tr ${t.late ? 'style="background:#fef2f2"' : ''}>
          <td>${esc(t.name)}</td><td>${fmtDate(t.start_date)}</td><td>${fmtDate(t.end_date)}</td>
          <td>${statusBadge(t.status)}</td><td>${priorityBadge(t.priority)}</td>
          <td>${progressBar(t.progress)}</td>
          <td>${criticalBadge(t.critical)}</td>
          <td>${t.late ? '<span class="badge st-Terhambat">Ya</span>' : '-'}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>

    <div class="card">
      <h3>👥 Ringkasan Penugasan & Beban Kerja</h3>
      <div class="table-scroll"><table class="tbl">
        <thead><tr><th>Anggota</th><th>Peran</th><th>Tugas yang Diampu</th><th>Estimasi Biaya Tenaga Kerja</th><th>Konflik</th></tr></thead>
        <tbody>
          ${r.resource_summaries.map((rs) => `<tr>
            <td><b>${esc(rs.name)}</b>${rs.is_active ? '' : ' <span class="badge st-Terhambat">nonaktif</span>'}</td>
            <td>${esc(rs.role)}</td>
            <td>${rs.assignments} tugas</td>
            <td>-</td>
            <td style="font-size:.8rem">
              ${(rs.overallocationDays.length || rs.unavailabilityConflicts.length) ?
                `<span class="badge st-Terhambat">${rs.overallocationDays.length} hari kelebihan beban</span>
                 ${rs.unavailabilityConflicts.length ? `<span class="badge pr-Tinggi">${rs.unavailabilityConflicts.length} tabrakan absensi</span>` : ''}`
              : '<span class="badge st-Selesai">aman</span>'}
            </td>
          </tr>`).join('')}
        </tbody>
      </table></div>
      <div style="font-size:.78rem;color:var(--muted);margin-top:6px">Estimasi biaya tenaga kerja (asumsi): tarif harian × jumlah hari kerja alokasi; tarif bulanan dikonversi dengan asumsi 21 hari kerja/bulan. Rincian pada halaman <b>Sumber Daya → Detail</b>.</div>
    </div>`;
}

// ============ HALAMAN SUMBER DAYA (global) ============
Views.resourcesPage = async function () {
  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:10px">
        <h3 style="margin:0">👥 Manajemen Sumber Daya (Anggota Tim)</h3>
        <div style="display:flex;gap:8px">
          <input id="res-q" placeholder="Cari nama / peran…" style="width:220px" />
          <select id="res-status" style="width:150px"><option value="">Semua status</option><option value="aktif">Aktif</option><option value="nonaktif">Nonaktif</option></select>
          <button class="btn primary" id="btn-res-new">+ Tambah Anggota</button>
        </div>
      </div>
      <div id="res-list"></div>
    </div>`;

  async function load() {
    const q = content.querySelector('#res-q').value;
    const status = content.querySelector('#res-status').value;
    const rows = await api.get(`/api/resources?q=${encodeURIComponent(q)}&status=${status}`);
    content.querySelector('#res-list').innerHTML = rows.length ? `
      <div class="table-scroll"><table class="tbl">
        <thead><tr><th>Nama</th><th>Peran / Keahlian</th><th>Telepon</th><th>Email</th><th>Tarif</th><th>Status</th><th>Aksi</th></tr></thead>
        <tbody>${rows.map((r) => `<tr ${!r.is_active ? 'style="opacity:.6"' : ''}>
          <td><b>${esc(r.name)}</b></td><td>${esc(r.role || '-')}</td>
          <td>${esc(r.phone || '-')}</td><td>${esc(r.email || '-')}</td>
          <td>Rp${fmtRp(r.rate)} / ${esc(r.rate_unit)}</td>
          <td>${r.is_active ? '<span class="badge st-Selesai">Aktif</span>' : '<span class="badge st-Terhambat">Nonaktif</span>'}</td>
          <td><div class="actions">
            <button class="btn small" data-detail="${r.id}">Detail</button>
            <button class="btn small" data-edit="${r.id}">Edit</button>
            <button class="btn small ${r.is_active ? 'danger' : ''}" data-toggle="${r.id}" data-on="${r.is_active}">${r.is_active ? 'Nonaktifkan' : 'Aktifkan'}</button>
          </div></td>
        </tr>`).join('')}</tbody>
      </table></div>` : '<div class="empty-state"><div class="big">👥</div>Belum ada anggota. Tambahkan anggota tim pertama.</div>';

    content.querySelectorAll('[data-detail]').forEach((b) => b.onclick = () => Views.resourceDetail(Number(b.dataset.detail)));
    content.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => Views.resourceForm(Number(b.dataset.edit), load));
    content.querySelectorAll('[data-toggle]').forEach((b) => b.onclick = async () => {
      const on = b.dataset.on === '1';
      if (on) {
        await api.post(`/api/resources/${b.dataset.toggle}/deactivate`);
        toast('Anggota dinonaktifkan. Penugasan yang ada tidak dihapus — periksa Resource Chart.', 'success');
      } else {
        await api.put(`/api/resources/${b.dataset.toggle}`, { is_active: true });
        toast('Anggota diaktifkan.', 'success');
      }
      load();
    });
  }
  content.querySelector('#res-q').oninput = load;
  content.querySelector('#res-status').onchange = load;
  content.querySelector('#btn-res-new').onclick = () => Views.resourceForm(null, load);
  load();
};

// Form tambah/ubah anggota
Views.resourceForm = function (id, onSaved) {
  openModal(id ? 'Ubah Data Anggota' : 'Tambah Anggota Tim', `
    <form id="res-form">
      <label>Nama Lengkap *</label><input name="name" required />
      <div class="form-row">
        <div><label>Nomor Telepon</label><input name="phone" placeholder="08xx-xxxx-xxxx" /></div>
        <div><label>Email</label><input name="email" type="email" /></div>
      </div>
      <div class="form-row">
        <div><label>Peran / Keahlian *</label><input name="role" required placeholder="cth: Teknisi Listrik" /></div>
        <div><label>Status</label><select name="is_active"><option value="1">Aktif</option><option value="0">Nonaktif</option></select></div>
      </div>
      <div class="form-row">
        <div><label>Tarif / Gaji</label><input name="rate" type="number" min="0" value="0" /></div>
        <div><label>Satuan Tarif</label><select name="rate_unit"><option value="hari">per hari</option><option value="bulan">per bulan</option></select></div>
      </div>
      <label>Catatan</label><textarea name="notes" rows="2"></textarea>
      <div id="res-err" class="alert error hidden"></div>
      <div class="modal-actions">
        <button type="button" class="btn" id="res-cancel">Batal</button>
        <button type="submit" class="btn primary">Simpan</button>
      </div>
    </form>`, {
    onMount: async (m) => {
      if (id) {
        const r = await api.get('/api/resources/' + id);
        const f = m.querySelector('#res-form');
        f.name.value = r.name; f.phone.value = r.phone || ''; f.email.value = r.email || '';
        f.role.value = r.role || ''; f.rate.value = r.rate; f.rate_unit.value = r.rate_unit;
        f.is_active.value = String(r.is_active); f.notes.value = r.notes || '';
      }
      m.querySelector('#res-cancel').onclick = closeModal;
      m.querySelector('#res-form').onsubmit = async (e) => {
        e.preventDefault();
        const payload = Object.fromEntries(new FormData(e.target).entries());
        payload.rate = Number(payload.rate);
        payload.is_active = payload.is_active === '1';
        try {
          if (id) await api.put('/api/resources/' + id, payload);
          else await api.post('/api/resources', payload);
          closeModal();
          toast('Data anggota tersimpan.', 'success');
          if (onSaved) onSaved(); else route();
        } catch (err) {
          const eb = m.querySelector('#res-err'); eb.textContent = err.message; eb.classList.remove('hidden');
        }
      };
    },
  });
};

// Detail anggota: penugasan lintas proyek + ketidakhadiran pribadi
Views.resourceDetail = async function (id, focusAbsence) {
  const r = await api.get('/api/resources/' + id);
  openModal('Detail Anggota: ' + r.name, `
    <dl class="detail-kv">
      <dt>Peran</dt><dd>${esc(r.role || '-')}</dd>
      <dt>Kontak</dt><dd>${esc(r.phone || '-')} · ${esc(r.email || '-')}</dd>
      <dt>Tarif</dt><dd>Rp${fmtRp(r.rate)} / ${esc(r.rate_unit)}</dd>
      <dt>Status</dt><dd>${r.is_active ? '<span class="badge st-Selesai">Aktif</span>' : '<span class="badge st-Terhambat">Nonaktif</span>'}</dd>
      <dt>Catatan</dt><dd style="font-weight:400">${esc(r.notes || '-')}</dd>
    </dl>
    <h3 style="margin-top:14px">📌 Tugas yang Pernah / Sedang Diampu</h3>
    <div class="table-scroll"><table class="tbl"><thead><tr><th>Tugas</th><th>Proyek</th><th>Alokasi</th><th>Peran</th></tr></thead><tbody>
      ${(r.assignments || []).map((a) => `<tr><td>${esc(a.task_name)}</td><td>${esc(a.project_name)}</td>
        <td>${a.allocation}%</td><td>${esc(a.role_on_task || '-')}</td></tr>`).join('') || '<tr><td colspan="4" class="empty-state">Belum ada penugasan.</td></tr>'}
    </tbody></table></div>
    <h3 style="margin-top:14px">🗓 Ketidakhadiran Pribadi</h3>
    <div id="unav-list"></div>
    <form id="unav-form" class="form-row" style="align-items:flex-end;margin-top:8px">
      <div><label>Mulai</label><input type="date" name="start_date" required /></div>
      <div><label>Selesai</label><input type="date" name="end_date" required /></div>
      <div><label>Alasan</label><input name="reason" required placeholder="cth: cuti" style="width:150px" /></div>
      <div style="flex:0"><button class="btn primary">Catat</button></div>
    </form>
    <div id="unav-err" class="alert error hidden"></div>
    <div class="modal-actions"><button class="btn" id="rd-close">Tutup</button></div>
  `, {
    wide: true,
    onMount: (m) => {
      m.querySelector('#rd-close').onclick = closeModal;
      drawUnav();
      m.querySelector('#unav-form').onsubmit = async (e) => {
        e.preventDefault();
        try {
          await api.post(`/api/resources/${id}/unavailability`, Object.fromEntries(new FormData(e.target).entries()));
          toast('Ketidakhadiran dicatat. Resource Chart akan mempertimbangkannya.', 'success');
          e.target.reset();
          drawUnav();
        } catch (err) {
          const eb = m.querySelector('#unav-err'); eb.textContent = err.message; eb.classList.remove('hidden');
        }
      };
      if (focusAbsence) m.querySelector('#unav-form input').focus();

      function drawUnav() {
        m.querySelector('#unav-list').innerHTML = (r.unavailability || []).length ? `
          <table class="tbl"><thead><tr><th>Periode</th><th>Alasan</th><th>Status</th><th></th></tr></thead><tbody>
            ${r.unavailability.map((u) => `<tr>
              <td>${fmtDate(u.start_date)} – ${fmtDate(u.end_date)}</td>
              <td>${esc(u.reason)}</td>
              <td><span class="badge st-${esc(u.approval_status)}">${esc(u.approval_status)}</span></td>
              <td><button class="btn small danger" data-del="${u.id}">Hapus</button></td>
            </tr>`).join('')}
          </tbody></table>` : '<div class="empty-state" style="padding:16px">Tidak ada catatan ketidakhadiran.</div>';
        m.querySelectorAll('#unav-list [data-del]').forEach((b) => b.onclick = () => {
          confirmDialog('Hapus catatan ketidakhadiran ini?', async () => {
            await api.del('/api/resources/unavailability/' + b.dataset.del);
            r.unavailability = r.unavailability.filter((u) => String(u.id) !== b.dataset.del);
            toast('Catatan dihapus.', 'success');
            drawUnav();
          });
        });
      }
    },
  });
};

// ============ HALAMAN AKUN PENGGUNA (admin) ============
Views.usersPage = async function () {
  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h3 style="margin:0">⚙️ Akun Pengguna</h3>
        <button class="btn primary" id="btn-user-new">+ Buat Akun</button>
      </div>
      <div id="user-list"></div>
      <div class="alert info" style="font-size:.8rem">Peran: <b>Admin</b> kelola sistem · <b>Manajer Proyek</b> kelola proyek tanggung jawabnya · <b>Anggota Tim</b> lihat proyek yang diikutinya & perbarui progres tugasnya.</div>
    </div>`;

  async function load() {
    const users = await api.get('/api/users');
    content.querySelector('#user-list').innerHTML = `
      <div class="table-scroll"><table class="tbl">
        <thead><tr><th>Nama</th><th>Username</th><th>Email</th><th>Peran</th><th>Status</th><th>Aksi</th></tr></thead>
        <tbody>${users.map((u) => `<tr ${!u.is_active ? 'style="opacity:.6"' : ''}>
          <td><b>${esc(u.full_name)}</b></td><td>${esc(u.username)}</td><td>${esc(u.email)}</td>
          <td><span class="badge st-${u.role === 'admin' ? 'Selesai' : u.role === 'manager' ? 'Berjalan' : 'Belum-Dimulai'}">${esc(u.role)}</span></td>
          <td>${u.is_active ? '<span class="badge st-Selesai">Aktif</span>' : '<span class="badge st-Dibatalkan">Nonaktif</span>'}</td>
          <td><div class="actions">
            <button class="btn small" data-edit="${u.id}">Edit</button>
            <button class="btn small" data-reset="${u.id}">Reset Password</button>
            <button class="btn small ${u.is_active ? 'danger' : ''}" data-toggle="${u.id}" data-on="${u.is_active}" data-self="${u.id === currentUser.id}">${u.is_active ? 'Nonaktifkan' : 'Aktifkan'}</button>
          </div></td>
        </tr>`).join('')}</tbody>
      </table></div>`;

    content.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => userForm(Number(b.dataset.edit), load));
    content.querySelectorAll('[data-reset]').forEach((b) => b.onclick = () => resetForm(Number(b.dataset.reset), load));
    content.querySelectorAll('[data-toggle]').forEach((b) => b.onclick = async () => {
      const on = b.dataset.on === '1';
      try {
        await api.post(`/api/users/${b.dataset.toggle}/${on ? 'deactivate' : 'activate'}`);
        toast(on ? 'Akun dinonaktifkan.' : 'Akun diaktifkan.', 'success');
        load();
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  function userForm(id, cb) {
    openModal(id ? 'Ubah Akun' : 'Buat Akun Pengguna', `
      <form id="u-form">
        <div class="form-row">
          <div><label>Nama Lengkap *</label><input name="full_name" required /></div>
          <div><label>Username *</label><input name="username" ${id ? 'disabled' : 'required'} value="" /></div>
        </div>
        <div class="form-row">
          <div><label>Email *</label><input name="email" type="email" required /></div>
          <div><label>Peran</label>
            <select name="role">
              <option value="admin">Admin</option>
              <option value="manager">Manajer Proyek</option>
              <option value="member">Anggota Tim</option>
            </select>
          </div>
        </div>
        <label>${id ? 'Password baru (kosongkan untuk tetap)' : 'Password * (min. 6 karakter)'}</label>
        <input name="password" type="password" ${id ? '' : 'required'} />
        <div class="checkbox-list" style="margin-top:10px">
          <label><input type="checkbox" name="is_active" checked /> Akun aktif</label>
        </div>
        <div id="u-err" class="alert error hidden"></div>
        <div class="modal-actions">
          <button type="button" class="btn" id="u-cancel">Batal</button>
          <button type="submit" class="btn primary">Simpan</button>
        </div>
      </form>`, {
      onMount: async (m) => {
        if (id) {
          const u = (await api.get('/api/users')).find((x) => x.id === id);
          const f = m.querySelector('#u-form');
          f.full_name.value = u.full_name; f.email.value = u.email; f.role.value = u.role;
          f.username.value = u.username; f.is_active.checked = !!u.is_active;
        }
        m.querySelector('#u-cancel').onclick = closeModal;
        m.querySelector('#u-form').onsubmit = async (e) => {
          e.preventDefault();
          const f = e.target;
          const payload = {
            full_name: f.full_name.value,
            email: f.email.value,
            role: f.role.value,
            is_active: f.is_active.checked,
          };
          if (!id) { payload.username = f.username.value; payload.password = f.password.value; }
          else if (f.password.value) payload.password = f.password.value;
          try {
            if (id) await api.put('/api/users/' + id, payload);
            else await api.post('/api/users', payload);
            closeModal(); toast('Akun tersimpan.', 'success'); cb();
          } catch (err) {
            const eb = m.querySelector('#u-err'); eb.textContent = err.message; eb.classList.remove('hidden');
          }
        };
      },
    });
  }

  function resetForm(id, cb) {
    openModal('Reset Password', `
      <form id="rp-form">
        <label>Password baru (min. 6 karakter)</label>
        <input name="password" type="password" required />
        <div id="rp-err" class="alert error hidden"></div>
        <div class="modal-actions">
          <button type="button" class="btn" id="rp-cancel">Batal</button>
          <button type="submit" class="btn primary">Reset</button>
        </div>
      </form>`, {
      onMount: (m) => {
        m.querySelector('#rp-cancel').onclick = closeModal;
        m.querySelector('#rp-form').onsubmit = async (e) => {
          e.preventDefault();
          try {
            await api.post(`/api/users/${id}/reset-password`, { password: e.target.password.value });
            closeModal(); toast('Password direset.', 'success'); cb();
          } catch (err) {
            const eb = m.querySelector('#rp-err'); eb.textContent = err.message; eb.classList.remove('hidden');
          }
        };
      },
    });
  }

  content.querySelector('#btn-user-new').onclick = () => userForm(null, load);
  load();
};
