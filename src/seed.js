// Seeder data awal: akun demo (3 peran), proyek contoh, tugas + dependensi, sumber daya, penugasan.
// Dijalankan otomatis saat pertama kali server dinyalakan; "npm run seed" menghapus dan
// membuat ulang seluruh data demo.
const fs = require('fs');
const path = require('path');
const { db, DB_PATH } = require('./db');
const { hashPassword } = require('./auth');
const { rescheduleProject } = require('./scheduler');

function seedAll() {

  // ===== Pengguna demo =====
  const insUser = db.prepare(
    `INSERT INTO users (username, email, password_hash, full_name, role) VALUES (?, ?, ?, ?, ?)`
  );
  const users = {};
  const u = (username, email, pass, name, role) => {
    const r = insUser.run(username, email, hashPassword(pass), name, role);
    users[username] = r.lastInsertRowid;
  };
  u('admin', 'admin@freebuff.test', 'admin123', 'Administrator Sistem', 'admin');
  u('manajer', 'manajer@majurasa.test', 'manajer123', 'Budi Santoso', 'manager');
  u('anggota', 'anggota@majurasa.test', 'anggota123', 'Siti Rahma', 'member');

  // ===== Proyek contoh =====
  const projIns = db.prepare(
    `INSERT INTO projects (name, organization, description, location, start_date, target_end_date, manager_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const projectId = projIns.run(
    'Pendirian Dapur Produksi UMKM Maju Rasa',
    'UMKM Maju Rasa',
    'Proyek persiapan dapur produksi makanan untuk UMKM, mulai dari survei lokasi, persiapan ruangan, pengadaan peralatan, instalasi fasilitas, penataan peralatan, hingga uji coba produksi dan pemeriksaan akhir.',
    'Jl. Merdeka No. 45, Bandung',
    '2026-10-01',
    '2026-10-30',
    users.manajer,
    'Berjalan'
  ).lastInsertRowid;

  db.prepare('INSERT INTO project_members (project_id, user_id, role_label) VALUES (?, ?, ?)')
    .run(projectId, users.anggota, 'Petugas Pemeriksa');

  // ===== Kalender kerja =====
  db.prepare('INSERT INTO work_calendars (project_id, workdays, work_start_time, work_end_time, hours_per_day) VALUES (?, ?, ?, ?, ?)')
    .run(projectId, '1,2,3,4,5', '08:00', '17:00', 8);

  // Hari libur nasional Indonesia (contoh data manual, bukan dari API eksternal)
  const insHoliday = db.prepare('INSERT INTO calendar_holidays (project_id, date, name, type) VALUES (?, ?, ?, ?)');
  insHoliday.run(projectId, '2026-10-09', 'Libur Nasional (contoh data manual)', 'nasional');
  insHoliday.run(projectId, '2026-10-14', 'Hari Aksara (contoh libur nasional manual)', 'nasional');
  insHoliday.run(projectId, '2026-10-19', 'Libur khusus proyek: rapat nasional bahan baku', 'khusus');

  // ===== Tugas (nama dari spesifikasi) =====
  const insTask = db.prepare(
    `INSERT INTO tasks (project_id, parent_task_id, name, description, planned_start, duration, priority, status, progress, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const T = {};
  const t = (name, dur, plannedStart, extra = {}) => {
    const r = insTask.run(
      projectId, extra.parent || null, name, extra.desc || '', plannedStart, dur,
      extra.priority || 'Sedang', extra.status || 'Belum Dimulai', extra.progress ?? 0, extra.sort ?? 0
    );
    T[name] = r.lastInsertRowid;
    return T[name];
  };

  // Group 1: Persiapan Lokasi
  const persiapanLokasiId = insTask.run(projectId, null, 'Persiapan Lokasi', 'Grup pekerjaan persiapan lokasi dapur', '2026-10-01', 6, 'Tinggi', 'Berjalan', 0, 1).lastInsertRowid;
  t('Survei lokasi', 2, '2026-10-01', { parent: persiapanLokasiId, status: 'Selesai', progress: 100, sort: 1, priority: 'Tinggi' });
  t('Pemeriksaan kondisi ruangan', 2, '2026-10-03', { parent: persiapanLokasiId, status: 'Berjalan', progress: 60, sort: 2 });
  t('Pengukuran ruangan', 1, '2026-10-05', { parent: persiapanLokasiId, status: 'Berjalan', progress: 50, sort: 3 });
  t('Penentuan tata letak dapur', 2, '2026-10-06', { parent: persiapanLokasiId, status: 'Berjalan', progress: 30, sort: 4 });

  // Pengadaan Peralatan
  const pengadaanId = insTask.run(projectId, null, 'Pengadaan Peralatan', 'Grup pekerjaan pengadaan peralatan dapur', '2026-10-08', 9, 'Tinggi', 'Belum Dimulai', 0, 2).lastInsertRowid;
  t('Penyusunan daftar peralatan', 2, '2026-10-08', { parent: pengadaanId, sort: 5, priority: 'Tinggi' });
  t('Pencarian pemasok', 3, '2026-10-09', { parent: pengadaanId, sort: 6, priority: 'Tinggi' });
  t('Melakukan pembelian', 4, '2026-10-12', { parent: pengadaanId, sort: 7, priority: 'Tinggi' });
  t('Memeriksa kelengkapan peralatan', 2, '2026-10-16', { parent: pengadaanId, sort: 8 });
  t('Penataan Peralatan', 2, '2026-10-20', { parent: pengadaanId, sort: 9, status: 'Belum Dimulai' });

  // Persiapan Fasilitas
  const fasilitasId = insTask.run(projectId, null, 'Persiapan Fasilitas', 'Grup pekerjaan instalasi dan persiapan fasilitas', '2026-10-06', 7, 'Tinggi', 'Berjalan', 0, 3).lastInsertRowid;
  t('Pekerjaan instalasi listrik', 3, '2026-10-06', { parent: fasilitasId, sort: 10, priority: 'Mendesak' });
  t('Pekerjaan instalasi air', 3, '2026-10-09', { parent: fasilitasId, sort: 11, priority: 'Mendesak' });
  t('Penataan meja kerja', 2, '2026-10-13', { parent: fasilitasId, sort: 12 });
  t('Pemasangan rak penyimpanan', 2, '2026-10-15', { parent: fasilitasId, sort: 13 });
  t('Pemeriksaan fasilitas', 2, '2026-10-19', { parent: fasilitasId, sort: 14 });

  // Persiapan Produksi
  const produksiId = insTask.run(projectId, null, 'Persiapan Produksi', 'Grup pekerjaan persiapan produksi dan uji coba', '2026-10-21', 7, 'Sedang', 'Belum Dimulai', 0, 4).lastInsertRowid;
  t('Penempatan peralatan', 2, '2026-10-21', { parent: produksiId, sort: 15 });
  t('Pemeriksaan kebersihan', 1, '2026-10-23', { parent: produksiId, sort: 16 });
  t('Persiapan bahan dan perlengkapan', 2, '2026-10-24', { parent: produksiId, sort: 17 });
  t('Uji coba produksi', 2, '2026-10-26', { parent: produksiId, sort: 18, priority: 'Tinggi' });

  // Penyelesaian
  const penyelesaianId = insTask.run(projectId, null, 'Penyelesaian', 'Grup pekerjaan akhir proyek', '2026-10-28', 3, 'Tinggi', 'Belum Dimulai', 0, 5).lastInsertRowid;
  t('Pemeriksaan akhir', 1, '2026-10-28', { parent: penyelesaianId, sort: 19, priority: 'Tinggi' });
  t('Perbaikan temuan', 2, '2026-10-29', { parent: penyelesaianId, sort: 20 });
  t('Serah terima hasil proyek', 1, '2026-10-30', { parent: penyelesaianId, sort: 21, priority: 'Tinggi' });

  // ===== Dependensi (sesuai tabel contoh spesifikasi) =====
  const insDep = db.prepare(
    `INSERT INTO task_dependencies (project_id, predecessor_id, successor_id, type, lag, notes) VALUES (?, ?, ?, ?, ?, ?)`
  );
  const dep = (pred, succ, type = 'FS', lag = 0) => insDep.run(projectId, T[pred], T[succ], type, lag, '');

  dep('Survei lokasi', 'Pemeriksaan kondisi ruangan');
  dep('Pemeriksaan kondisi ruangan', 'Pengukuran ruangan');
  dep('Pengukuran ruangan', 'Penentuan tata letak dapur');
  dep('Penentuan tata letak dapur', 'Penyusunan daftar peralatan');
  dep('Penyusunan daftar peralatan', 'Pencarian pemasok', 'SS', 1);
  dep('Pencarian pemasok', 'Melakukan pembelian');
  dep('Melakukan pembelian', 'Memeriksa kelengkapan peralatan');
  dep('Memeriksa kelengkapan peralatan', 'Penataan Peralatan');
  dep('Penentuan tata letak dapur', 'Pekerjaan instalasi listrik');
  dep('Pekerjaan instalasi listrik', 'Pekerjaan instalasi air');
  dep('Pekerjaan instalasi air', 'Penataan meja kerja');
  dep('Penataan meja kerja', 'Pemasangan rak penyimpanan');
  dep('Pemeriksaan fasilitas', 'Uji coba produksi');
  dep('Penataan Peralatan', 'Uji coba produksi');
  dep('Pemeriksaan akhir', 'Perbaikan temuan');
  dep('Perbaikan temuan', 'Serah terima hasil proyek');

  // ===== Sumber daya (anggota tim) =====
  const insRes = db.prepare(
    `INSERT INTO resources (user_id, name, phone, email, role, rate, rate_unit, is_active, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const R = {};
  const r = (name, role, rate, rateUnit, extra = {}) => {
    const row = insRes.run(extra.userId || null, name, extra.phone || '', extra.email || '', role, rate, rateUnit, extra.active ?? 1, extra.notes || '');
    R[name.split(' ')[0]] = row.lastInsertRowid;
    return row.lastInsertRowid;
  };
  r('Budi Santoso', 'Manajer Proyek', 5000, 'hari');
  r('Andi Wijaya', 'Koordinator Lapangan', 350, 'hari');
  const sitiId = r('Siti Rahma', 'Petugas Pemeriksa', 300, 'hari', { userId: users.anggota, phone: '0812-0000-0001', email: 'anggota@majurasa.test' });
  r('Rudi Hartono', 'Teknisi Listrik', 400, 'hari');
  r('Joko Susilo', 'Teknisi Air', 400, 'hari');
  r('Putri Lestari', 'Petugas Pengadaan', 350, 'hari');
  r('Agus Salim', 'Pekerja Penataan Ruangan', 250, 'hari');
  r('Dewi Anggraini', 'Petugas Persiapan Produksi', 300, 'hari');

  // Ketidakhadiran pribadi contoh (Siti tahu libur pribadinya 2 hari)
  db.prepare('INSERT INTO resource_unavailability (resource_id, start_date, end_date, reason, approval_status) VALUES (?, ?, ?, ?, ?)')
    .run(sitiId, '2026-10-19', '2026-10-19', 'Acara keluarga', 'Disetujui');

  // ===== Penugasan contoh =====
  const insAssign = db.prepare(
    `INSERT INTO resource_assignments (task_id, resource_id, role_on_task, allocation, start_date, end_date, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const assign = (taskName, resKey, roleOnTask = '', allocation = 100) =>
    insAssign.run(T[taskName], R[resKey], roleOnTask, allocation, null, null, '');

  assign('Survei lokasi', 'Andi', 'Koordinator', 60);
  assign('Survei lokasi', 'Siti', 'Pemeriksa', 40);
  assign('Pemeriksaan kondisi ruangan', 'Andi', 'Koordinator', 50);
  assign('Pemeriksaan kondisi ruangan', 'Dewi', 'Anggota', 50);
  assign('Pengukuran ruangan', 'Agus', 'Anggota', 100);
  assign('Penentuan tata letak dapur', 'Budi', 'Manajer', 30);
  assign('Penentuan tata letak dapur', 'Agus', 'Anggota', 60);
  assign('Penyusunan daftar peralatan', 'Putri', 'Pengadaan', 100);
  assign('Pencarian pemasok', 'Putri', 'Pengadaan', 80);
  assign('Melakukan pembelian', 'Putri', 'Pengadaan', 100);
  assign('Memeriksa kelengkapan peralatan', 'Siti', 'Pemeriksa', 60);
  assign('Memeriksa kelengkapan peralatan', 'Andi', 'Koordinator', 40);
  assign('Penataan Peralatan', 'Agus', 'Anggota', 100);
  assign('Pekerjaan instalasi listrik', 'Rudi', 'Teknisi', 100);
  assign('Pekerjaan instalasi air', 'Joko', 'Teknisi', 100);
  assign('Penataan meja kerja', 'Agus', 'Anggota', 70);
  assign('Pemasangan rak penyimpanan', 'Agus', 'Anggota', 70);
  assign('Pemeriksaan fasilitas', 'Siti', 'Pemeriksa', 60);
  assign('Pemeriksaan fasilitas', 'Budi', 'Manajer', 30);
  assign('Penempatan peralatan', 'Dewi', 'Anggota', 70);
  assign('Pemeriksaan kebersihan', 'Dewi', 'Anggota', 50);
  assign('Persiapan bahan dan perlengkapan', 'Dewi', 'Anggota', 100);
  assign('Uji coba produksi', 'Dewi', 'Anggota', 70);
  assign('Uji coba produksi', 'Siti', 'Pemeriksa', 40);
  assign('Pemeriksaan akhir', 'Siti', 'Pemeriksa', 60);
  assign('Pemeriksaan akhir', 'Budi', 'Manajer', 40);
  assign('Perbaikan temuan', 'Andi', 'Koordinator', 60);
  assign('Perbaikan temuan', 'Rudi', 'Teknisi', 40);
  assign('Serah terima hasil proyek', 'Budi', 'Manajer', 50);

  // Hitung jadwal dengan memperhatikan dependensi dan kalender
  return { projectId };
}

function run(reset) {
  const existing = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (existing > 0 && !reset) {
    console.log('Database sudah berisi data, lewati seeding (gunakan --reset untuk mengulang).');
    return;
  }
  db.exec(`
    BEGIN;
    DELETE FROM resource_assignments; DELETE FROM resource_unavailability; DELETE FROM resources;
    DELETE FROM task_dependencies; DELETE FROM task_progress_history; DELETE FROM tasks;
    DELETE FROM calendar_holidays; DELETE FROM work_calendars; DELETE FROM project_members; DELETE FROM projects;
    DELETE FROM sessions; DELETE FROM users;
    COMMIT;
  `);
  const { projectId } = seedAll();
  rescheduleProject(db, projectId);
  console.log('Seeding selesai. Proyek contoh #' + projectId + ' dibuat.');
}

if (require.main === module) {
  run(process.argv.includes('--reset'));
}

module.exports = { run };
