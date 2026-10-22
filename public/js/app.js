// Aplikasi utama: routing hash + shell
// Semua view berada dalam objek window.Views, dibangun bertahap dari file view terpisah.
let currentUser = null;

// ===== Router =====
const routes = [
  { re: /^#\/dashboard$/, view: () => Views.dashboard() },
  { re: /^#\/projects$/, view: () => Views.projects() },
  { re: /^#\/project\/(\d+)\/(ringkasan|kalender|tugas|gantt|pert|kritikal|sumberdaya|resourcechart|laporan)$/,
    view: (m) => Views.projectDetail(Number(m[1]), m[2]) },
  { re: /^#\/resources$/, view: () => Views.resourcesPage() },
  { re: /^#\/users$/, view: () => Views.usersPage() },
];

async function route() {
  const hash = location.hash || '#/dashboard';
  document.querySelectorAll('.nav-link').forEach((a) => {
    a.classList.toggle('active', a.getAttribute('href') === hash);
  });
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading-box"><span class="spinner"></span> Memuat…</div>';
  for (const r of routes) {
    const m = hash.match(r.re);
    if (m) {
      try {
        await r.view(m);
      } catch (e) {
        content.innerHTML = `<div class="alert error">${esc(e.message || 'Terjadi kesalahan.')}</div>`;
      }
      // tutup sidebar setelah navigasi (mobile)
      document.getElementById('sidebar').classList.remove('open');
      document.getElementById('backdrop').classList.remove('show');
      return;
    }
  }
  content.innerHTML = '<div class="empty-state"><div class="big">🔍</div>Halaman tidak ditemukan.</div>';
}

// ===== Navigasi sesuai peran =====
function buildNav() {
  const nav = document.getElementById('nav');
  const role = currentUser.role;
  const links = [];
  links.push({ href: '#/dashboard', label: 'Dashboard', icon: '📊' });
  if (role !== 'member') {
    links.push({ href: '#/projects', label: 'Proyek', icon: '📁' });
  } else {
    links.push({ href: '#/projects', label: 'Proyek Saya', icon: '📁' });
  }
  if (role !== 'member') {
    links.push({ href: '#/resources', label: 'Sumber Daya', icon: '👥' });
  }
  if (role === 'admin') {
    links.push({ href: '#/users', label: 'Akun Pengguna', icon: '⚙️' });
  }
  nav.innerHTML = links.map((l) =>
    `<a class="nav-link" href="${l.href}"><span>${l.icon}</span><span>${l.label}</span></a>`
  ).join('');
}

// ===== Dashboard =====
async function dashboard(m) {
  const d = await api.get('/api/analysis/dashboard');
  const p = d.projects, t = d.tasks;
  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="grid cols-4">
      <div class="stat blue"><div class="num">${p.total}</div><div class="lbl">Total Proyek</div></div>
      <div class="stat green"><div class="num">${p.berjalan}</div><div class="lbl">Proyek Berjalan</div></div>
      <div class="stat amber"><div class="num">${p.ditunda}</div><div class="lbl">Proyek Ditunda</div></div>
      <div class="stat"><div class="num">${p.selesai}</div><div class="lbl">Proyek Selesai</div></div>
    </div>
    <div class="grid cols-4" style="margin-top:14px">
      <div class="stat"><div class="num">${t.total}</div><div class="lbl">Total Tugas</div></div>
      <div class="stat"><div class="num">${t.belum_mulai}</div><div class="lbl">Belum Dimulai</div></div>
      <div class="stat blue"><div class="num">${t.berjalan}</div><div class="lbl">Sedang Berjalan</div></div>
      <div class="stat red"><div class="num">${t.terlambat}</div><div class="lbl">Tugas Terlambat</div></div>
    </div>

    <div class="grid cols-2" style="margin-top:18px">
      <div class="card">
        <h3>📅 Jadwal Terdekat</h3>
        ${d.upcoming.length ? `
        <table class="tbl">
          <thead><tr><th>Tugas</th><th>Proyek</th><th>Mulai</th><th>Status</th></tr></thead>
          <tbody>
            ${d.upcoming.map((u) => `
              <tr>
                <td><a href="#/project/${u.project_id}/tugas">${esc(u.name)}</a></td>
                <td>${esc(u.project_name)}</td>
                <td>${fmtDate(u.start_date)}</td>
                <td>${statusBadge(u.status)}</td>
              </tr>`).join('')}
          </tbody>
        </table>` : '<div class="empty-state">Tidak ada tugas berjadwal ke depan.</div>'}
      </div>
      <div class="card">
        <h3>👥 Proyek yang Anda Akses</h3>
        <div id="dash-projects"><span class="spinner"></span></div>
      </div>
    </div>`;

  const projects = await api.get('/api/projects');
  const box = content.querySelector('#dash-projects');
  box.innerHTML = projects.length ? projects.map((pr) => `
    <div style="padding:10px 0;border-bottom:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <a href="#/project/${pr.id}/ringkasan" style="font-weight:600">${esc(pr.name)}</a>
        ${statusBadge(pr.status)}
      </div>
      <div style="display:flex;align-items:center;gap:10px;margin-top:6px">
        ${progressBar(pr.progress)}
        <span style="font-size:.78rem;color:var(--muted)">Target: ${fmtDate(pr.target_end_date)}</span>
      </div>
    </div>`).join('') : '<div class="empty-state">Belum ada proyek.</div>';
}

// ===== Daftar Proyek =====
async function projectsPage(m) {
  const content = document.getElementById('content');
  const canCreate = currentUser.role === 'admin' || currentUser.role === 'manager';
  content.innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:14px;flex-wrap:wrap">
        <h3 style="margin:0">📁 Daftar Proyek</h3>
        <div style="display:flex;gap:8px;align-items:center">
          <input id="proj-q" placeholder="Cari nama / organisasi…" style="width:230px" />
          <select id="proj-status" style="width:150px">
            <option value="">Semua status</option>
            <option>Perencanaan</option><option>Berjalan</option><option>Ditunda</option>
            <option>Selesai</option><option>Dibatalkan</option>
          </select>
          ${canCreate ? '<button id="btn-new-project" class="btn primary">+ Proyek Baru</button>' : ''}
        </div>
      </div>
      <div id="proj-list"></div>
    </div>`;

  async function loadList() {
    const q = content.querySelector('#proj-q').value;
    const status = content.querySelector('#proj-status').value;
    const rows = await api.get('/api/projects' + `?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}`);
    const box = content.querySelector('#proj-list');
    box.innerHTML = rows.length ? `
      <div class="table-scroll">
      <table class="tbl">
        <thead><tr><th>Nama Proyek</th><th>Organisasi</th><th>Manajer</th><th>Mulai</th><th>Target Selesai</th><th>Progres</th><th>Status</th><th style="width:120px">Aksi</th></tr></thead>
        <tbody>
          ${rows.map((r) => `
            <tr>
              <td><a href="#/project/${r.id}/ringkasan" style="font-weight:600">${esc(r.name)}</a></td>
              <td>${esc(r.organization)}</td>
              <td>${esc(r.manager_name)}</td>
              <td>${fmtDate(r.start_date)}</td>
              <td>${fmtDate(r.target_end_date)}</td>
              <td>${progressBar(r.progress)}</td>
              <td>${statusBadge(r.status)}</td>
              <td>
                <div class="actions">
                  <a class="btn small" href="#/project/${r.id}/ringkasan">Detail</a>
                  ${r.manager_id === currentUser.id || currentUser.role === 'admin' ? `
                    <button class="btn small" data-edit="${r.id}">Edit</button>
                    <button class="btn small danger" data-del="${r.id}">Hapus</button>` : ''}
                </div>
              </td>
            </tr>`).join('')}
        </tbody>
      </table></div>`
      : '<div class="empty-state"><div class="big">📁</div>Belum ada proyek. Buat proyek pertama Anda.</div>';

    box.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => Views.projectForm(Number(b.dataset.edit)));
    box.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => {
      confirmDialog('Hapus proyek ini? Seluruh tugas, dependensi, dan penugasan di dalamnya ikut terhapus.', async () => {
        await api.del('/api/projects/' + b.dataset.del);
        toast('Proyek dihapus.', 'success');
        loadList();
      });
    });
  }
  content.querySelector('#proj-q').oninput = loadList;
  content.querySelector('#proj-status').onchange = loadList;
  if (document.getElementById('btn-new-project')) {
    document.getElementById('btn-new-project').onclick = () => Views.projectForm(null, loadList);
  }
  loadList();
}

// ===== Ekspor ke window untuk modularitas sederhana =====
window.Views = window.Views || {};
Views.dashboard = dashboard;
Views.projects = projectsPage;

// ===== Inisialisasi =====
window.addEventListener('hashchange', route);
document.getElementById('logout-btn').onclick = async () => {
  await api.post('/api/auth/logout');
  window.location.href = '/index.html';
};
document.getElementById('menu-btn').onclick = () => {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('backdrop').classList.add('show');
};
document.getElementById('backdrop').onclick = () => {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('backdrop').classList.remove('show');
};

(async function init() {
  const me = await api.get('/api/auth/me');
  currentUser = me.user;
  buildNav();
  const chip = document.getElementById('user-chip');
  const roleName = { admin: 'Admin', manager: 'Manajer Proyek', member: 'Anggota Tim' }[currentUser.role] || currentUser.role;
  chip.innerHTML = `<div class="name">${esc(currentUser.full_name)}</div><div class="role">${esc(roleName)}</div>`;
  if (!location.hash) location.hash = '#/dashboard';
  route();
})();
