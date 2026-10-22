// Screenshot + audit layout Gantt Chart. Jalankan: node scripts/gantt-shot.js <label>
// Output: screenshots/gantt-<label>.png + audit geometri ke stdout.
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const os = require('os');

const BASE = 'http://localhost:3100';
const label = process.argv[2] || 'current';
const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  path.join(os.homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'),
];

(async () => {
  fs.mkdirSync('screenshots', { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME_CANDIDATES.find((c) => fs.existsSync(c)),
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1360,900'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1360, height: 900 });
  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle0' });
  await page.evaluate(() => {
    const id = document.getElementById('identifier'), pw = document.getElementById('password');
    id.focus(); document.execCommand('insertText', false, 'admin');
    pw.focus(); document.execCommand('insertText', false, 'admin123');
    document.getElementById('login-form').requestSubmit(document.getElementById('login-btn'));
  });
  await page.waitForFunction(() => location.href.includes('app.html'), { timeout: 10000 });
  await page.evaluate(() => { location.hash = '#/project/1/gantt'; });
  await page.waitForSelector('#gantt-container .gantt-row', { timeout: 8000 });
  await new Promise((r) => setTimeout(r, 700));

  // Audit geometri: cek perataan kolom persen, offset header vs baris, overlap, dst.
  const audit = await page.evaluate(() => {
    const c = document.getElementById('gantt-container');
    const rows = [...c.querySelectorAll('.gantt-row')];
    const head = c.querySelector('.gantt-head');
    const laptop = rows[0];
    const headLab = head.querySelector('.gantt-labels');
    const rowLab = laptop.querySelector('.gantt-labels');
    const pctL = [...c.querySelectorAll('.tpct')].map((p) => Math.round(p.getBoundingClientRect().left));
    const pctUnique = [...new Set(pctL)];
    const names = [...c.querySelectorAll('.tname')].filter((n) => n.getBoundingClientRect().width);
    const nameLeft = [...new Set([...c.querySelectorAll('.gl-name')].map((n) => Math.round(n.getBoundingClientRect().left)))];
    let headTrackLeft = null, rowTrackLeft = null;
    if (head.querySelector('.gantt-head-track') && laptop.querySelector('.gantt-track')) {
      headTrackLeft = head.querySelector('.gantt-head-track').getBoundingClientRect().left + c.scrollLeft;
      rowTrackLeft = laptop.querySelector('.gantt-track').getBoundingClientRect().left + c.scrollLeft;
    }
    return {
      rows: rows.length,
      rowHeights: [...new Set(rows.map((r) => Math.round(r.getBoundingClientRect().height)))],
      labelW: Math.round(rowLab.getBoundingClientRect().width),
      headerLabelW: Math.round(headLab.getBoundingClientRect().width),
      trackAlignDelta: (rowTrackLeft != null && headTrackLeft != null) ? Math.round(rowTrackLeft - headTrackLeft) : 'n/a',
      pctColumnUniqueLefts: pctUnique,
      nameLefts: nameLeft,
      viewportW: innerWidth,
      scrollRange: [c.scrollWidth, c.clientWidth],
    };
  });
  console.log('AUDIT ' + label + ': ' + JSON.stringify(audit));

  await page.screenshot({ path: `screenshots/gantt-${label}-full.png`, fullPage: true });
  const card = await page.$('#content .card');
  if (card) await card.screenshot({ path: `screenshots/gantt-${label}-chart.png` });

  // skala mingguan untuk pembanding
  await page.click('.gantt-modes .gbtn[data-mode="minggu"]');
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: `screenshots/gantt-${label}-weekly-chart.png` }).catch(() => {});
  await browser.close();
  console.log('SHOT OK -> screenshots/gantt-' + label + '-{full,chart,weekly}.png');
})().catch((e) => { console.error('SHOT FAIL:', e.message); process.exit(1); });
