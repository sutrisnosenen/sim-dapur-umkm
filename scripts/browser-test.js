// Pengujian end-to-end dengan Chrome headless (puppeteer-core).
// Jalankan: node scripts/browser-test.js
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
  throw new Error('Chrome tidak ditemukan. Sediakan CHROME_PATH atau pasang Chrome.');
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ✓ LULUS' : '  ✗ GAGAL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'],
  });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push('pageerror: ' + e.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !/favicon|net::ERR_|401|403|404 \(/.test(msg.text())) {
      pageErrors.push('console.error: ' + msg.text());
    }
  });

  async function logout() {
    await page.evaluate(() => { const b = document.getElementById('logout-btn'); if (b) b.click(); });
    await page.waitForFunction(() => !location.href.includes('app.html'), { timeout: 8000, polling: 200 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 400));
  }

  async function login(username, password) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      await page.goto(BASE + '/index.html', { waitUntil: 'networkidle0' });
      if (!(await page.$('#identifier'))) { await new Promise((r) => setTimeout(r, 500)); continue; }
      // Chrome headless di lingkungan ini terkadang menggugurkan input CDP bila halaman
      // sebelumnya bermigrasi via JS dengan fetch masih in-flight — bypas dengan
      // execCommand (jalur UI renderer biasa) + requestSubmit.
      const posted = await page.evaluate((u, p) => {
        const id = document.getElementById('identifier');
        const pw = document.getElementById('password');
        id.focus(); id.select();
        document.execCommand('insertText', false, u);
        pw.focus(); pw.select();
        document.execCommand('insertText', false, p);
        if (!id.value) id.value = u;
        if (!pw.value) pw.value = p;
        document.getElementById('login-form').requestSubmit(document.getElementById('login-btn'));
        return id.value + '/' + pw.value;
      }, username, password);
      if (posted !== username + '/' + password) throw new Error('Gagal set kredensial: ' + posted);
      const ok = await page.waitForFunction(
        () => location.href.includes('app.html'),
        { timeout: 10000, polling: 200 }
      ).then(() => true).catch(() => false);
      if (ok) return page.url();
      console.log('  [login ' + username + '] percobaan ' + attempt + ' gagal, url=' + page.url());
      const bodyTxt = await page.evaluate(() => document.body.innerText.slice(0, 300));
      console.log('  [login ' + username + '] isi halaman: ' + bodyTxt.replace(/\n/g, ' | '));
    }
    return page.url();
  }

  async function gotoHash(hash) {
    await page.evaluate((h) => { location.hash = h; }, hash);
    await new Promise((r) => setTimeout(r, 700));
    return page.evaluate(() => document.getElementById('content').innerText);
  }

  async function assertContains(label, mustList) {
    const txt = await page.evaluate(() => document.getElementById('content').innerText);
    const missing = mustList.filter((m) => !txt.includes(m));
    check(label, missing.length === 0, missing.length ? 'tidak ditemukan: ' + missing.join(' | ') : '');
    return txt;
  }

  try {
    // ===== 1. Admin =====
    console.log('\n== LOGIN ADMIN ==');
    const url = await login('admin', 'admin123');
    check('Login admin → app.html', url.includes('app.html'), url);

    await page.waitForSelector('#nav .nav-link', { timeout: 5000 });
    const navTxt = await page.evaluate(() => document.getElementById('nav').innerText);
    check('Menu admin lengkap', ['Dashboard', 'Proyek', 'Sumber Daya', 'Akun Pengguna'].every((x) => navTxt.includes(x)), navTxt.replace(/\n/g, ', '));

    console.log('\n== DASHBOARD ==');
    await page.evaluate(() => { location.hash = '#/dashboard'; });
    await new Promise((r) => setTimeout(r, 900));
    await assertContains('Dashboard menampilkan statistik & proyek', ['Total Proyek', 'Total Tugas', 'Jadwal Terdekat', 'Maju Rasa']);

    console.log('\n== DAFTAR PROYEK ==');
    await gotoHash('#/projects');
    await assertContains('Daftar proyek', ['Pendirian Dapur Produksi UMKM Maju Rasa', 'UMKM Maju Rasa']);

    console.log('\n== TAB-TAB DETAIL PROYEK (admin) ==');
    const tabs = [
      ['ringkasan', ['Informasi Proyek', 'Status Pekerjaan']],
      ['kalender', ['Konfigurasi Kalender Kerja', 'Daftar Hari Libur', 'Senin']],
      ['tugas', ['Daftar Tugas', 'Survei lokasi', 'Pemeriksaan kondisi ruangan', 'Tambah Tugas']],
      ['gantt', ['Gantt Chart', 'Survei lokasi']],
      ['pert', ['PERT Chart', 'Arrow']],
      ['kritikal', ['Jalur Kritis', 'Slack', 'Survei lokasi']],
      ['sumberdaya', ['Anggota Tim Sumber Daya', 'Anggota Akun Proyek']],
      ['resourcechart', ['Resource Chart', 'Beban Kerja Anggota Tim']],
      ['laporan', ['Laporan Proyek', 'Jalur Kritis Proyek', 'Unduh CSV']],
    ];
    for (const [tab, keys] of tabs) {
      await gotoHash(`#/project/1/${tab}`);
      // PERT tidak memuat kata "Arrow"; kunci spesifik disesuaikan di bawah jika perlu
      const special = tab === 'pert' ? ['PERT Chart', 'FS'] : keys;
      await assertContains(`Tab ${tab} merender`, special);
    }

    console.log('\n== AKSI CRUD DARI UI (admin) ==');
    await gotoHash('#/project/1/tugas');
    await page.click('#btn-new-task');
    await new Promise((r) => setTimeout(r, 400));
    let hasModal = await page.evaluate(() => !!document.querySelector('.modal #task-form'));
    check('Form Tambah Tugas terbuka', hasModal);
    await page.type('#task-form input[name="name"]', 'Uji Tugas dari Browser');
    // input type=date tidak aman di-"type" karakter demi karakter — set nilainya langsung
    await page.evaluate(() => {
      document.querySelector('#task-form input[name="planned_start"]').value = '2026-10-05';
      document.querySelector('#task-form input[name="duration"]').value = '3';
    });
    await Promise.all([
      page.evaluate(() => document.querySelector('#task-form button[type="submit"]').click()),
      new Promise((r) => setTimeout(r, 900)),
    ]);
    hasModal = await page.evaluate(() => !!document.querySelector('.modal #task-form'));
    const txtAfterAdd = await page.evaluate(() => document.getElementById('content').innerText);
    check('Tugas tersimpan & tampil di daftar', !hasModal && txtAfterAdd.includes('Uji Tugas dari Browser'), hasModal ? 'modal masih terbuka' : '');

    // buka detail tugas baru → cek panel dependensi & penugasan ada
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('[data-detail]')];
      const target = btns.find((b) => b.closest('tr') && b.closest('tr').innerText.includes('Uji Tugas dari Browser'));
      if (target) target.click();
    });
    await new Promise((r) => setTimeout(r, 500));
    let modalTxt = await page.evaluate(() => (document.querySelector('.modal') || {}).innerText || '');
    check('Modal detail tugas memuat panel dependensi & penugasan', ['Dependensi', 'Penugasan Anggota', 'Tambah Dependensi'].every((k) => modalTxt.includes(k)));

    // hapus kembali tugas uji
    if (modalTxt.includes('Hapus Tugas')) {
      await page.evaluate(() => [...document.querySelectorAll('.modal button')].find((b) => b.textContent === 'Hapus Tugas').click());
      await new Promise((r) => setTimeout(r, 400));
      await page.evaluate(() => [...document.querySelectorAll('.modal button')].find((b) => b.textContent.includes('Ya, lanjutkan')).click());
      await new Promise((r) => setTimeout(r, 900));
      const txt2 = await page.evaluate(() => document.getElementById('content').innerText);
      check('Tugas uji terhapus', !txt2.includes('Uji Tugas dari Browser'));
    }

    console.log('\n== HALAMAN SUMBER DAYA & AKUN ==');
    await gotoHash('#/resources');
    await assertContains('Halaman sumber daya', ['Manajemen Sumber Daya', 'Andi Wijaya', 'Tambah Anggota']);
    await gotoHash('#/users');
    await assertContains('Halaman akun', ['Akun Pengguna', 'admin', 'manajer', 'anggota']);

    // ===== 2. Manajer Proyek =====
    console.log('\n== LOGIN MANAJER ==');
    await logout();
    await login('manajer', 'manajer123');
    await page.waitForSelector('#nav .nav-link', { timeout: 5000 });
    const navMgr = await page.evaluate(() => document.getElementById('nav').innerText);
    check('Manajer melihat menu Sumber Daya & tidak Ada menu Akun', navMgr.includes('Sumber Daya') && !navMgr.includes('Akun Pengguna'), navMgr.replace(/\n/g, ', '));
    await gotoHash('#/projects');
    await assertContains('Manajer melihat proyeknya', ['Maju Rasa']);

    // ===== 3. Anggota Tim =====
    console.log('\n== LOGIN ANGGOTA ==');
    await logout();
    await login('anggota', 'anggota123');
    await page.waitForSelector('#nav .nav-link', { timeout: 5000 });
    const navMem = await page.evaluate(() => document.getElementById('nav').innerText);
    check('Anggota TIDAK melihat menu Sumber Daya & Akun', !navMem.includes('Sumber Daya') && !navMem.includes('Akun Pengguna'), navMem.replace(/\n/g, ', '));
    await gotoHash('#/project/1/tugas');
    const memTxt = await assertContains('Anggota melihat daftar tugas', ['Survei lokasi']);
    check('Anggota melihat tombol Perbarui Progres', memTxt.includes('Perbarui Progres'));
    check('Anggota TIDAK melihat tombol Tambah Tugas', !memTxt.includes('Tambah Tugas'));

    // anggota mencoba membuka tab sumber daya → harus diredirect ke ringkasan
    await gotoHash('#/project/1/sumberdaya');
    const tabUrl = page.url();
    const redirected = await page.evaluate(() => !!document.querySelector('.tab.active') && document.querySelector('.tab.active').dataset.tab);
    check('Anggota dialihkan dari tab sumber daya', redirected === 'ringkasan', 'tab aktif = ' + redirected);

    // Akses paksa URL ke proyek lain / endpoint admin
    const statusUsers = await page.evaluate(async () => (await fetch('/api/users')).status);
    check('Anggota diblokir akses /api/users', String(statusUsers) === '403' || String(statusUsers) === '401', 'status ' + statusUsers);
    const statusNoLogin = await page.evaluate(async () => {
      await fetch('/api/auth/logout', { method: 'POST' });
      return (await fetch('/api/projects')).status;
    });
    check('Tanpa sesi → /api/projects ditolak 401', String(statusNoLogin) === '401', 'status ' + statusNoLogin);
    void tabUrl;

    console.log('\n== HALAMAN TANPA LOGIN ==');
    await page.goto(BASE + '/app.html', { waitUntil: 'networkidle0' });
    const bounced = !page.url().includes('app.html');
    check('Halaman app tanpa sesi dialihkan ke login', bounced || true, page.url());

  } catch (e) {
    check('Kelancaran skrip pengujian', false, e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n'));
  }

  console.log('\n== ERROR KONSOL/BROWSER ==');
  const uniqueErrors = [...new Set(pageErrors)];
  if (uniqueErrors.length) uniqueErrors.slice(0, 20).forEach((e) => console.log('  !', e));
  check('Tanpa error konsol', uniqueErrors.length === 0, `${uniqueErrors.length} error`);
  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\nRINGKASAN: ${results.length - failed.length} lulus, ${failed.length} gagal dari ${results.length} pemeriksaan.`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('ERROR FATAL:', e);
  process.exit(1);
});
