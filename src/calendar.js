// Kalender kerja: perhitungan hari kerja memperhitungkan hari kerja mingguan dan hari libur.
// Semua tanggal memakai format 'YYYY-MM-DD' (string) dan diperlakukan sebagai tanggal lokal.

function toDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function toStr(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function isoWeekday(d) { return d.getDay() === 0 ? 7 : d.getDay(); } // 1=Senin..7=Minggu

// Muat konfigurasi kalender kerja dari database (hari kerja mingguan + daftar hari libur)
function loadCalendarData(db, projectId) {
  const cal = db.prepare('SELECT * FROM work_calendars WHERE project_id = ?').get(projectId);
  const workdays = cal ? cal.workdays.split(',').map((x) => parseInt(x, 10)).filter((n) => n >= 1 && n <= 7) : [1, 2, 3, 4, 5];
  const holidays = new Set(
    db.prepare('SELECT date FROM calendar_holidays WHERE project_id = ?').all(projectId).map((r) => r.date)
  );
  return { workdays, holidays };
}

function makeCalendar(calData) {
  const { workdays, holidays } = calData;
  const isWorkday = (s) => workdays.includes(isoWeekday(toDate(s))) && !holidays.has(s);

  // ===== Ordinal hari kerja (amortized O(1) dan cache tersimpan) =====
  // ordinal 0-based: jumlah hari kerja SEBELUM tanggal s (relative epoch 2000-01-01).
  // strs[n] menyimpan tanggal hari kerja ke-n; cache memanjang secara lazy sehingga
  // kalkulasi jadwal tidak perlu berputar ribuan hari tanggal setiap pemanggilan.
  const strs = [];
  const idxOf = new Map();
  let cursor = new Date(2000, 0, 1); // posisi sudah diproses hingga cursor

  function advance() {
    cursor = addDays(cursor, 1);
    const s = toStr(cursor);
    if (isWorkday(s)) {
      idxOf.set(s, strs.length);
      strs.push(s);
      return s;
    }
    return null;
  }

  function ensureDateCached(targetStr) {
    if (idxOf.has(targetStr)) return;
    while (true) {
      const s = advance();
      if (s === targetStr) return;
      if (cursor.getFullYear() > 2100) {
        throw new Error('Tanggal keluar dari rentang yang didukung (maks. 2100): ' + targetStr);
      }
    }
  }

  function ensureOrdinalCached(ord) {
    if (!Number.isFinite(ord)) throw new Error('Ordinal hari kerja bukan angka valid: ' + String(ord));
    if (ord < 0) throw new Error('Ordinal hari kerja tidak boleh negatif.');
    while (strs.length <= ord) {
      advance();
      if (cursor.getFullYear() > 2100 && strs.length <= ord) {
        throw new Error('Tanggal keluar dari rentang yang didukung (maks. 2100)');
      }
    }
  }

  // Untuk tanggal non-kerja: geser ke hari kerja berikutnya sebelum menghitung ordinal.
  function ordinalOf(s) {
    let d = toDate(s);
    while (!isWorkday(toStr(d))) d = addDays(d, 1);
    const target = toStr(d);
    ensureDateCached(target);
    return idxOf.get(target);
  }

  // Kembalikan tanggal dari ordinal (ordinal tertinggal ke waktu depan jika tidak dijangkau)
  function dateFromOrdinal(ord) {
    ensureOrdinalCached(ord);
    return strs[ord];
  }

  // Tanggal selesai (include) sebuah tugas: mulai + (durasi-1) hari kerja
  function finishDate(startStr, duration) {
    if (!duration || duration < 1) return startStr;
    return dateFromOrdinal(ordinalOf(startStr) + duration - 1);
  }

  // Jumlah hari kerja dalam rentang inklusif
  function countWorkdays(startStr, endStr) {
    let d = toDate(startStr);
    const end = toDate(endStr);
    let n = 0;
    while (d <= end) {
      if (isWorkday(toStr(d))) n++;
      d = addDays(d, 1);
    }
    return n;
  }

  // Daftar hari kerja dalam rentang inklusif
  function listWorkdays(startStr, endStr) {
    const out = [];
    let d = toDate(startStr);
    const end = toDate(endStr);
    while (d <= end) {
      if (isWorkday(toStr(d))) out.push(toStr(d));
      d = addDays(d, 1);
    }
    return out;
  }

  // Nama hari (Indonesia)
  const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  function dayName(s) { return dayNames[toDate(s).getDay()]; }
  function formatDateID(s) {
    if (!s) return '-';
    const d = toDate(s);
    return `${d.getDate()} ${monthNames[d.getMonth()]} ${d.getFullYear()}`;
  }

  return { isWorkday, ordinalOf, dateFromOrdinal, finishDate, countWorkdays, listWorkdays, dayName, formatDateID, workdays, holidays };
}

// Validasi format tanggal YYYY-MM-DD (nilai rusak dari klien harus ditolak)
function isYmd(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

module.exports = { toDate, toStr, addDays, isoWeekday, loadCalendarData, makeCalendar, isYmd };
