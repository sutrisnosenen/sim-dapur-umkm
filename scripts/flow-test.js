// Uji alur penugasan anggota: admin/manajer menambahkan akun ke proyek,
// menugaskannya ke tugas, lalu verifikasi akun anggota melihat proyek & tugas.
// Jalankan: node scripts/flow-test.js (server harus jalan di port 3100)
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const os = require('os');

const BASE = 'http://localhost:3100';
const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  path.join(os.homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'),
];
function findChrome() {
  for (const c of CHROME_CANDIDATES) if (fs.existsSync(c)) return c;
  throw new Error('Chrome tidak ditemukan.');
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`);
}

const TS = String(Date.now()).slice(-6);
const NEW_USER = 'anguji' + TS;
const NEW_PASS = 'rahasia123';
const NEW_NAME = 'Anggota Uji ' + TS;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'],
  });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|net::ERR_|401|403|404 \(/.test(m.text())) pageErrors.push(m.text());
  });

  async function login(username, password) {
    await page.goto(BASE + '/index.html', { waitUntil: 'networkidle0' });
    await page.evaluate((u, p) => {
      const id = document.getElementById('identifier');
      const pw = document.getElementById('password');
      id.focus(); id.select();
      document.execCommand('insertText', false, u);
      pw.focus(); pw.select();
      document.execCommand('insertText', false, p);
      if (!id.value) id.value = u;
      if (!pw.value) pw.value = p;
      document.getElementById('login-form').requestSubmit(document.getElementById('login-btn'));
    }, username, password);
    const ok = await page.waitForFunction(() => location.href.includes('app.html'), { timeout: 10000, polling: 200 })
      .then(() => true).catch(() => false);
    if (!ok) throw new Error('Login gagal: ' + username + ' (url=' + page.url() + ')');
  }

  async function logout() {
    await page.evaluate(() => { const b = document.getElementById('logout-btn'); if (b) b.click(); });
    await page.waitForFunction(() => !location.href.includes('app.html'), { timeout: 8000, polling: 200 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 400));
  }

  async function gotoHash(h) {
    await page.evaluate((hh) => { location.hash = hh; }, h);
    await new Promise((r) => setTimeout(r, 800));
    return page.evaluate(() => document.getElementById('content').innerText);
  }

  try {
    // ===== 1. Siapkan akun anggota uji (admin) =====
    console.log('\n== PERSIAPAN: buat akun anggota uji ==');
    await login('admin', 'admin123');
    const createRes = await page.evaluate(async (u, p, n) => {
      const res = await fetch('/api/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, email: u + '@uji.test', password: p, full_name: n, role: 'member' }),
      });
      return { status: res.status, body: await res.text() };
    }, NEW_USER, NEW_PASS, NEW_NAME);
    check('Akun anggota uji dibuat', createRes.status === 201, 'status ' + createRes.status + ' ' + createRes.body.slice(0, 120));

    // ===== 2. Admin menambahkan anggota lewat tombol di ringkasan =====
    console.log('\n== ADMIN: tambah anggota dari ringkasan ==');
    await gotoHash('#/project/1/ringkasan');
    const hasBtn = await page.evaluate(() => !!document.getElementById('rm-add'));
    check('Tombol "+ Tambah Anggota" tersedia di bagian Anggota Proyek (akun)', hasBtn);
    if (hasBtn) {
      await page.evaluate(() => document.getElementById('rm-add').click());
      await new Promise((r) => setTimeout(r, 400));
      const modalOk = await page.evaluate((name) => {
        const sel = document.querySelector('.modal select[name="user_id"]');
        if (!sel) return 'select tidak ada';
        const opt = [...sel.options].find((o) => o.textContent.includes(name));
        if (!opt) return 'opsi pengguna tidak ditemukan di modal';
        sel.value = opt.value;
        const role = document.querySelector('.modal input[name="role_label"]');
        if (role) role.value = 'Penguji Uji';
        document.querySelector('.modal form#rm-form').requestSubmit();
        return 'ok';
      }, NEW_NAME);
      check('Modal pilih akun terbuka & form disubmit', modalOk === 'ok', modalOk);
      await new Promise((r) => setTimeout(r, 1200));
      const txt = await page.evaluate(() => document.getElementById('content').innerText);
      check('Anggota baru muncul di daftar Anggota Proyek (akun)', txt.includes(NEW_NAME) && txt.includes(NEW_USER), '');
    }

    // ===== 3. Verifikasi relasi tersimpan (members + resource auto-link) =====
    console.log('\n== VERIFIKASI DATA TERPIMPIN ==');
    const stored = await page.evaluate(async (name) => {
      const proj = await (await fetch('/api/projects/1')).json();
      const res = await (await fetch('/api/resources')).json();
      return {
        memberFound: (proj.members || []).some((m) => m.full_name === name),
        resourceLinked: !!res.find((r) => r.name === name),
      };
    }, NEW_NAME);
    check('project_members menyimpan akun ke proyek', stored.memberFound);
    check('resource auto-link dibuat untuk akun (dipakai penugasan tugas)', stored.resourceLinked);

    // ===== 4. Admin menugaskan anggota ke tugas lewat panel Penugasan Anggota =====
    console.log('\n== ADMIN: tugaskan anggota ke tugas ==');
    await gotoHash('#/project/1/tugas');
    await page.evaluate(() => { const b = document.querySelector('[data-detail]'); if (b) b.click(); });
    await new Promise((r) => setTimeout(r, 600));
    const assignRes = await page.evaluate((name) => {
      const sel = document.querySelector('.modal #as-res');
      if (!sel) return 'select #as-res tidak ada';
      const opt = [...sel.options].find((o) => o.textContent.includes(name));
      if (!opt) return 'resource anggota tidak ada di select penugasan (value options: ' + [...sel.options].map((o) => o.textContent).join(' | ').slice(0, 200) + ')';
      sel.value = opt.value;
      const role = document.querySelector('.modal #as-role');
      if (role) role.value = 'Penguji Alur';
      document.querySelector('.modal #as-add').click();
      return 'ok';
    }, NEW_NAME);
    check('Resource anggota tersedia & form penugasan disubmit', assignRes === 'ok', assignRes);
    await new Promise((r) => setTimeout(r, 1400));
    const assignStored = await page.evaluate(async (name) => {
      const data = await (await fetch('/api/projects/1/tasks')).json();
      const rows = Object.values(data.assignments || {}).flat();
      return rows.some((a) => a.resource_name === name);
    }, NEW_NAME);
    check('resource_assignments tersimpan untuk tugas', assignStored);

    // ===== 5. Hak akses per peran =====
    console.log('\n== HAK AKSES ==');
    // Manajer: boleh lihat daftar pengguna & menambah anggota proyek
    await logout();
    await login('manajer', 'manajer123');
    const mgr = await page.evaluate(async () => {
      const users = await fetch('/api/users');
      const add = await fetch('/api/projects/1/members', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: 3, role_label: 'Petugas Pemeriksa' }),
      });
      return { users: users.status, add: add.status };
    });
    check('Manajer dapat membuka daftar pengguna (/api/users 200)', mgr.users === 200, 'status ' + mgr.users);
    check('Manajer dapat menambah anggota proyek (201)', mgr.add === 201, 'status ' + mgr.add);

    // Anggota: dilarang
    await logout();
    await login(NEW_USER, NEW_PASS);
    await new Promise((r) => setTimeout(r, 1200));
    const mem = await page.evaluate(async () => {
      const users = await fetch('/api/users');
      const add = await fetch('/api/projects/1/members', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: 3, role_label: 'X' }),
      });
      const del = await fetch('/api/projects/1/members/3', { method: 'DELETE' });
      return { users: users.status, add: add.status, del: del.status };
    });
    check('Anggota DILARANG lihat /api/users (403)', mem.users === 403, 'status ' + mem.users);
    check('Anggota DILARANG tambah anggota proyek (403)', mem.add === 403, 'status ' + mem.add);
    check('Anggota DILARANG keluarkan anggota proyek (403)', mem.del === 403, 'status ' + mem.del);

    // ===== 6. Akun anggota melihat proyek & tugas yang ditugaskan =====
    console.log('\n== AKUN ANGGOTA: proyek & tugas tampil ==');
    const dashTxt = await page.evaluate(() => document.getElementById('content').innerText);
    check('Dashboard menampilkan proyek tempat anggota terdaftar', dashTxt.includes('Maju Rasa'), dashTxt.slice(0, 120).replace(/\n/g, ' '));
    const projTxt = await gotoHash('#/projects');
    check('Daftar proyek menampilkan proyek bagi anggota', projTxt.includes('Maju Rasa'));
    const taskTxt = await gotoHash('#/project/1/tugas');
    check('Daftar tugas proyek tampil untuk anggota', taskTxt.includes('Survei lokasi'), '');
    check('Tombol "Perbarui Progres" tersedia untuk tugas yang ditugaskan', taskTxt.includes('Perbarui Progres'));
    check('Anggota TIDAK melihat tombol Tambah Tugas', !taskTxt.includes('Tambah Tugas'));
    // anggota memperbarui progres tugas yang ditugaskan
    const upd = await page.evaluate(async () => {
      const data = await (await fetch('/api/projects/1/tasks')).json();
      const mine = await (await fetch('/api/resources/assignments')).json();
      const myTask = (mine || [])[0];
      if (!myTask) return 'tidak ada penugasan milik anggota';
      const res = await fetch('/api/projects/1/tasks/' + myTask.task_id, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ progress: 50, status: 'Berjalan' }),
      });
      void data;
      return res.status;
    });
    check('Anggota dapat memperbarui progres tugas yang ditugaskan (200)', String(upd) === '200', 'status ' + upd);

    check('Tanpa error konsol/browser', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 300));
  } catch (e) {
    check('Kelancaran skrip uji alur', false, e.message);
  }

  await browser.close();
  const pass = results.filter((r) => r.ok).length;
  console.log('\nRINGKASAN: ' + pass + ' lulus, ' + (results.length - pass) + ' gagal dari ' + results.length + ' pemeriksaan.');
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error('ERR:', e); process.exit(1); });
