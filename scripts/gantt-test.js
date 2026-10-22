// Uji visual tab Gantt Chart (puppeteer-core + Chrome headless).
// Jalankan: node scripts/gantt-test.js  (server harus jalan di port 3100)
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
  results.push({ name, ok });
  console.log(`${ok ? '  \u2713 LULUS' : '  \u2717 GAGAL'}  ${name}${detail ? ' — ' + detail : ''}`);
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

  await page.setViewport({ width: 1360, height: 850 });

  async function login(username, password) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      await page.goto(BASE + '/index.html', { waitUntil: 'networkidle0' });
      if (!(await page.$('#identifier'))) { await new Promise((r) => setTimeout(r, 500)); continue; }
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
      const ok = await page.waitForFunction(() => location.href.includes('app.html'),
        { timeout: 10000, polling: 200 }).then(() => true).catch(() => false);
      if (ok) return true;
    }
    return false;
  }

  async function openGantt(mode) {
    await page.evaluate((m) => {
      location.hash = '#/project/1/gantt';
      if (m && m !== 'hari') window.addEventListener('gantt-ready', () => {}, { once: true });
    }, mode);
    await page.waitForSelector('.gantt-modes .gbtn[data-mode="hari"]', { timeout: 8000 });
    if (mode && mode !== 'hari') {
      await page.click(`.gantt-modes .gbtn[data-mode="${mode}"]`);
      await new Promise((r) => setTimeout(r, 500));
    } else {
      await new Promise((r) => setTimeout(r, 600));
    }
  }

  try {
    console.log('== LOGIN ADMIN ==');
    check('Login admin', await login('admin', 'admin123'));

    console.log('\n== GANTT: HEADER & LEGENDA ==');
    await openGantt('hari');
    const head = await page.evaluate(() => ({
      title: (document.querySelector('.gantt-head-card h3') || {}).innerText || '',
      modes: [...document.querySelectorAll('.gantt-modes .gbtn')].map((b) => b.dataset.mode + (b.classList.contains('active') ? '*' : '')),
      footer: (document.querySelector('.gantt-footer') || {}).innerText || '',
      ghcProj: (document.querySelector('.ghc-proj') || {}).innerText || '',
      ghcMeta: (document.querySelector('.ghc-meta') || {}).innerText || '',
      ghcPct: Number(((document.querySelector('.ghc-right b') || {}).innerText || '0').replace('%', '')),
      ghcFillW: (document.querySelector('.ghc-right .progress-fill') || {}).style?.width || '',
      legend: (document.querySelector('.gantt-legend') || {}).innerText || '',
      legendCount: document.querySelectorAll('.g-legend').length,
      legendTitle: (document.querySelector('.gantt-legend') || {}).title || '',
      swatches: [...document.querySelectorAll('.gantt-legend .gsw')].map((s) => getComputedStyle(s).backgroundColor + '/' + getComputedStyle(s).backgroundImage + '/' + getComputedStyle(s).borderLeftColor),
      note: (document.getElementById('gantt-note') || {}).innerText || '',
    }));
    check('Judul "Gantt Chart" tampil', head.title.includes('Gantt Chart'));
    check('Legenda 5 chip di atas chart dengan istilah lengkap', ['Tugas Biasa', 'Tugas Induk', 'Tugas Kritis', 'Progres Aktual', 'Hari Ini']
      .every((x) => head.legend.includes(x)) && head.legendCount === 5, head.legend.replace(/\n/g, ' | '));
    check('Legenda punya penjelasan (tooltip grup)', head.legendTitle.length > 20, head.legendTitle.slice(0, 60));
    check('Legenda berwarna (ada swatch terisi)', head.swatches.filter((c) => !c.startsWith('rgba(0, 0, 0, 0)/none/rgba(0, 0, 0, 0)')).length >= 5, head.swatches.join('; '));
    check('Kontrol skala segmented: 3 tombol, aktif = hari', head.modes.length === 3 && head.modes.includes('hari*'), head.modes.join(','));
    check('Header ringkasan proyek: nama, periode, durasi, kritis, progres',
      head.ghcProj.includes('Maju Rasa') && /hari kerja/.test(head.ghcMeta) && /tugas kritis/.test(head.ghcMeta) && head.ghcPct >= 0 && head.ghcPct <= 100 && head.ghcFillW === head.ghcPct + '%',
      `${head.ghcProj} | ${head.ghcMeta.replace(/\n/g, ' ')} | ${head.ghcPct}%`);
    check('Footer ringkasan tampil (tugas, kritis, dependensi)', /\d+\s+tugas/.test(head.footer) && /kritis/i.test(head.footer) && /dependensi/i.test(head.footer), head.footer.replace(/\n/g, ' | '));

    console.log('\n== GANTT: BARIS, LABEL & BATANG ==');
    const rows = await page.evaluate(() => {
      const rowsEls = [...document.querySelectorAll('#gantt-container .gantt-row')];
      const first = rowsEls[0];
      const labels = first && first.querySelector('.gantt-labels');
      const tname = labels && labels.querySelector('.gl-name');
      const startCell = labels && labels.querySelector('.c-start');
      const durCell = labels && labels.querySelector('.c-dur');
      const slackCell = labels && labels.querySelector('.c-slack');
      const bars = [...document.querySelectorAll('.gantt-bar')];
      const info = bars.slice(0, 30).map((b) => {
        const cs = getComputedStyle(b);
        const h = parseFloat(cs.height);
        const fill = b.querySelector('.fill');
        return {
          cls: b.className, bg: cs.backgroundColor, h,
          fillW: fill ? fill.style.width : null,
          top: parseFloat(cs.top),
          trackCw: b.closest('.gantt-track').style.getPropertyValue('--cw'),
        };
      });
      return {
        nRows: rowsEls.length,
        rowH: first ? parseFloat(getComputedStyle(first).height) : 0,
        tname: tname ? tname.innerText.trim() : null,
        startCell: startCell ? startCell.innerText : null,
        durCell: durCell ? durCell.innerText : null,
        slackCell: slackCell ? slackCell.innerText : null,
        tnameSize: tname ? getComputedStyle(tname).fontSize : null,
        bars: info,
        hasWknd: !!document.querySelector('.gantt-day.wkend'),
        tracks: [...document.querySelectorAll('.gantt-track')].length,
      };
    });
    check('Ada baris tugas (>=3)', rows.nRows >= 3, 'n=' + rows.nRows);
    const projProg = head.ghcPct;
    check('Persen header = progres proyek (konsisten dgn bar)', projProg >= 0 && projProg <= 100 && head.ghcFillW === projProg + '%', 'header=' + projProg + '%');
    check('Tinggi baris seragam 42px', rows.rowH === 42, 'rowH=' + rows.rowH);
    check('Label nama tugas tampil', !!rows.tname, String(rows.tname));
    check('Kolom tabel kiri terisi (mulai, durasi, slack)',
      /\d+\s[A-Za-z]+/.test(rows.startCell || '') && /\d+h/.test(rows.durCell || '') && /[\d–-]/.test(rows.slackCell || ''),
      `${rows.startCell} | ${rows.durCell} | ${rows.slackCell}`);
    const subInfo = await page.evaluate(() => ({
      hasPct: !!document.querySelector('.gantt-labels .tpct'),
      pct: [...document.querySelectorAll('.gantt-labels .tpct')].map((x) => Number(x.innerText.replace('%', ''))),
      assign: [...document.querySelectorAll('.gantt-labels .tassign:not(.g-hidden)')].length,
      rowsWithAssign: [...document.querySelectorAll('.gantt-labels')].filter((l) => {
        const a = l.querySelector('.tassign');
        return a && !a.classList.contains('g-hidden');
      }).length,
      pctLefts: [...new Set([...document.querySelectorAll('.gantt-labels .tpct')].map((p) => Math.round(p.getBoundingClientRect().left)))],
      pctW: [...new Set([...document.querySelectorAll('.gantt-labels .tpct')].map((p) => Math.round(p.getBoundingClientRect().width)))],
    }));
    check('Kolom persen sejajar & lebar seragam; progres di kolom meta', subInfo.hasPct && subInfo.pctLefts.length === 1 && subInfo.pctW.length === 1,
      JSON.stringify(subInfo.pctLefts) + ' w=' + JSON.stringify(subInfo.pctW));
    check('Persen progres di kolom sesuai rentang data', subInfo.pct.length > 0 && subInfo.pct.every((p) => p >= 0 && p <= 100), 'n=' + subInfo.pct.length);
    check('Jumlah baris dengan anggota = ikon 👥 terlihat', subInfo.rowsWithAssign === subInfo.assign, `rows=${subInfo.rowsWithAssign} icons=${subInfo.assign}`);
    check('Ukuran teks nama tugas wajar (>= .7rem)', parseFloat(rows.tnameSize) >= 10.4 && parseFloat(rows.tnameSize) <= 14, rows.tnameSize);
    check('Track punya grid sesuai skala (--cw=32px)', rows.bars.every((b) => b.trackCw === '32px'), rows.bars[0] && rows.bars[0].trackCw);
    check('Kolom header akhir pekan diberi warna berbeda', rows.hasWknd);
    const critRowBg = await page.evaluate(() => {
      const r = document.querySelector('#gantt-container .gantt-row.critical-row');
      return r ? getComputedStyle(r).backgroundColor : null;
    });
    check('Baris kritis TANPA latar merah muda (warna hanya pada batang)',
      critRowBg === null || !['rgb(255, 247, 247)', 'rgb(255, 245, 245)'].includes(critRowBg), String(critRowBg));
    const nameTip = await page.evaluate(() => [...document.querySelectorAll('.gantt-labels .gl-name')].every((n) => (n.title || '').length > 3));
    check('Semua nama tugas punya tooltip nama lengkap', nameTip);
    const childMark = await page.evaluate(() => {
      const marks = [...document.querySelectorAll('.gantt-labels .tw-mark')].length;
      const children = [...document.querySelectorAll('.gl-name.gl-child')].length;
      return { marks, children };
    });
    check('Subtugas punya penanda ↳ = jumlah baris anak', childMark.marks === childMark.children && childMark.children > 0, JSON.stringify(childMark));
    const headLabel = await page.evaluate(() => ((document.querySelector('.gantt-head .gantt-labels') || {}).innerText || '').toLowerCase());
    check('Header tabel kiri memuat kolom ID/Tugas/Anggota/Selesai', ['id', 'tugas', 'anggota', 'selesai', 'slk'].every((x) => headLabel.includes(x)), headLabel.replace(/\n/g, ' '));
    const band = await page.evaluate(() => {
      const p = document.querySelector('#gantt-container .gantt-row.parent-row');
      const dots = document.querySelectorAll('.gantt-labels .s-dot').length;
      const rowsN = document.querySelectorAll('#gantt-container .gantt-row').length;
      const we = document.querySelectorAll('#gantt-container .gantt-row .gantt-we').length;
      const ms = document.querySelectorAll('#gantt-container .gantt-row .gantt-ms').length;
      return { parentBg: p ? getComputedStyle(p).backgroundColor : null, dots, rowsN, we, ms };
    });
    check('Baris tugas induk punya pita latar khas (bukan putih)', band.parentBg !== null && band.parentBg !== 'rgb(255, 255, 255)', String(band.parentBg));
    check('Setiap baris punya titik status berwarna', band.dots === band.rowsN, `dots=${band.dots} rows=${band.rowsN}`);
    check('Shading akhir pekan ada di setiap baris (kelipatan jumlah baris)', band.we > 0 && band.we % band.rowsN === 0, `we=${band.we} rows=${band.rowsN}`);
    check('Garis batas bulan tampil di timeline', band.ms >= 1, `ms=${band.ms}`);

    const leaf = rows.bars.find((b) => !b.cls.includes('parent') && !b.cls.includes('critical'));
    const crit = rows.bars.find((b) => b.cls.includes('critical'));
    const par = rows.bars.find((b) => b.cls.includes('parent'));
    check('Ada tugas biasa &warna biru muda #bfdbfe', leaf && leaf.bg === 'rgb(191, 219, 254)', leaf ? leaf.bg : 'tidak ada');
    check('Progres batang = persentase (fill) & lebih gelap', leaf && leaf.fillW !== null, leaf ? 'fill=' + leaf.fillW : '-');
    const fillCol = await page.evaluate(() => getComputedStyle(document.querySelector('.gantt-bar .fill')).backgroundColor);
    check('Warna fill progres #2563eb', fillCol === 'rgb(37, 99, 235)', fillCol);
    check('Bar jalur kritis merah muda #fecaca', crit && crit.bg === 'rgb(254, 202, 202)', crit ? crit.bg : 'tidak ada tugas kritis');
    check('Tugas induk: bar gelap tipis 10px', par && par.bg === 'rgb(15, 23, 42)' && par.h === 10 && par.top === 15,
      par ? par.bg + ' h=' + par.h : 'tidak ada tugas induk');
    const progMatch = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#gantt-container .gantt-row')];
      const mismatch = rows.filter((r) => {
        const pct = r.querySelector('.tpct');
        const fill = r.querySelector('.gantt-bar .fill');
        if (!pct || !fill) return true;
        return Number(pct.innerText.replace('%', '')) !== parseInt(fill.style.width, 10);
      });
      return { total: rows.length, mismatch: mismatch.length };
    });
    check('Persen sub-label = lebar fill progres tiap baris', progMatch.mismatch === 0, JSON.stringify(progMatch));

    console.log('\n== GANTT: PENANDA HARI INI ==');
    const today = await page.evaluate(() => {
      const n = new Date();
      const p = (x) => String(x).padStart(2, '0');
      const todayStr = `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`;
      return {
        todayStr,
        lines: [...document.querySelectorAll('.today-line')].length,
        tag: (document.querySelector('.today-tag') || {}).innerText || null,
        rows: document.querySelectorAll('#gantt-container .gantt-row').length,
      };
    });
    check('Penanda hari ini + rencana selesai: 1 per baris + 1 di header (kelipatan)',
      today.lines >= today.rows + 1 && today.lines % (today.rows + 1) === 0, `lines=${today.lines} rows=${today.rows}`);
    check('Label "Hari Ini" pada header', today.tag === 'Hari Ini', String(today.tag));
    const endTag = await page.evaluate(() => (document.querySelector('.today-tag.end-tag') || {}).innerText || null);
    check('Penanda "Rencana Selesai" tampil di header timeline', endTag === 'Rencana Selesai', String(endTag));
    const deps = await page.evaluate(() => ({ n: document.querySelectorAll('.dep-line').length, ss: document.querySelectorAll('.dep-line[stroke-dasharray]').length }));
    check('Garis dependensi tergambar sesuai jumlah relasi (>0)', deps.n > 0, 'dep=' + deps.n + ' (SS dashed=' + deps.ss + ')');
    const wd = await page.evaluate(() => [...document.querySelectorAll('.gantt-day')].filter((d) => d.querySelector('i')).length);
    check('Header tanggal punya huruf hari', wd > 0, 'days-with-letter=' + wd);
    check('Tanggal hari ini ' + today.todayStr, true);

    console.log('\n== GANTT: SCROLLING STICKY ==');
    const scroll = await page.evaluate(async () => {
      const c = document.getElementById('gantt-container');
      c.scrollLeft = 400;
      await new Promise((r) => setTimeout(r, 150));
      const lab = document.querySelector('#gantt-container .gantt-row .gantt-labels');
      const labRect = lab.getBoundingClientRect();
      const cRect = c.getBoundingClientRect();
      const stillAtLeft = Math.abs(labRect.left - cRect.left) < 3;
      c.scrollHeight = c.scrollHeight; // noop
      c.scrollTop = 120;
      await new Promise((r) => setTimeout(r, 150));
      const head = document.querySelector('#gantt-container .gantt-head');
      const headAtTop = Math.abs(head.getBoundingClientRect().top - c.getBoundingClientRect().top) < 3;
      c.scrollLeft = 0; c.scrollTop = 0;
      return { stillAtLeft, headAtTop, scrollableX: c.scrollWidth > c.clientWidth + 10 };
    });
    check('Kolom label tetap sticky kiri saat scroll horizontal', scroll.stillAtLeft);
    check('Header tetap sticky atas saat scroll vertikal', scroll.headAtTop);
    check('Timeline bisa di-scroll horizontal', scroll.scrollableX);

    console.log('\n== GANTT: SKALA MINGGUAN & BULANAN ==');
    await openGantt('minggu');
    let m = await page.evaluate(() => ({
      cw: document.querySelector('.gantt-track').style.getPropertyValue('--cw'),
      rows: document.querySelectorAll('#gantt-container .gantt-row').length,
      days: [...document.querySelectorAll('.gantt-day')].filter((d) => d.innerText.trim() !== '').length,
      active: (document.querySelector('.gantt-modes .gbtn.active') || {}).dataset?.mode || null,
    }));
    check('Skala mingguan: --cw=10px', m.cw === '10px', m.cw);
    check('Tombol Mingguan jadi aktif setelah diklik', m.active === 'minggu', String(m.active));
    check('Skala mingguan: baris tetap utuh', m.rows >= 3, 'n=' + m.rows);
    await openGantt('bulan');
    m = await page.evaluate(() => ({
      cw: document.querySelector('.gantt-track').style.getPropertyValue('--cw'),
      months: [...document.querySelectorAll('.gantt-month')].length,
    }));
    check('Skala bulanan: --cw=4px', m.cw === '4px', m.cw);
    check('Skala bulanan: header bulan tampil', m.months >= 1, 'n=' + m.months);

    console.log('\n== GANTT: KLIK BATANG → DETAIL ==');
    await openGantt('hari');
    await page.click('.gantt-bar-leaf, .gantt-bar.parent');
    await new Promise((r) => setTimeout(r, 600));
    const modalOpen = await page.evaluate(() => !!document.querySelector('.modal'));
    check('Klik batang membuka modal detail tugas', modalOpen);
    if (modalOpen) {
      await page.evaluate(() => document.querySelectorAll('.modal-close, .modal [data-close]').forEach((b) => b.click()));
      await page.keyboard.press('Escape');
    }

    console.log('\n== GANTT: RESPONSIF (layar 780px) ==');
    await page.setViewport({ width: 780, height: 800 });
    await openGantt('hari');
    const resp = await page.evaluate(() => {
      const lab = document.querySelector('#gantt-container .gantt-row .gantt-labels');
      const w = lab ? Math.round(lab.getBoundingClientRect().width) : 0;
      const cs = lab ? getComputedStyle(lab.querySelector('.gl-name')) : null;
      return { w, fs: cs ? cs.fontSize : null };
    });
    check('Layar kecil: tabel kiri menyempit (~240px), teks nama mengecil',
      resp.w >= 234 && resp.w <= 246 && parseFloat(resp.fs) < 12.3, `w=${resp.w} fontsize=${resp.fs}`);

    check('Tidak ada error konsol browser', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  } catch (e) {
    check('Test berjalan tanpa exception', false, e.message);
  }

  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  console.log(`\n=== RINGKASAN: ${pass} lulus, ${fail} gagal, dari ${results.length} pemeriksaan ===`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
