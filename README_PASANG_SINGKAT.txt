RQ SDM TAHAP 7 — ABSENSI BULANAN

1. Cadangkan src/App.tsx dan src/App.css.
2. Ekstrak ZIP, lalu salin frontend/src/App.tsx, App.css, AttendanceModule.tsx dan lib/supabase.ts ke D:\RQ_SDM sesuai struktur folder. Salin public/rq-logo.png ke public/rq-logo.png. Jangan ganti .env.local.
3. Terminal D:\RQ_SDM: npm install xlsx
4. Supabase > SQL Editor: jalankan 08_attendance_schedule_versioning.sql.
5. Pastikan schedule_version_function tidak NULL.
6. Terminal: npm run dev
7. Uji dengan data simulasi terlebih dahulu.

Menu baru: Absensi Bulanan.
Tab: Roster Bulanan, Jadwal Kerja, Impor Excel.
Sekjen/Super Admin dapat lintas unit; Kepala Unit mengatur jadwal dan absensi unit; Petugas Absensi mengisi absensi unit; Pimpinan hanya melihat.
