# RQ SDM Tahap 8 — Penilaian Kinerja

Modul ini menambahkan penilaian berkala yang terikat pada **penugasan**, bukan hanya profil orang. Guru Tahfidz dan Musyrif yang merupakan orang yang sama dapat dinilai secara terpisah berdasarkan tugas masing-masing.

## Isi paket
- `frontend/src/App.tsx`: navigasi RQ SDM ditambah menu Penilaian Kinerja.
- `frontend/src/PerformanceModule.tsx`: formulir penilaian, riwayat, detail skor, draft, finalisasi, dan pengaturan indikator khusus Sekjen/Super Admin.
- `frontend/src/App.css`: gaya modul penilaian yang mengikuti tema biru tua RQ SDM.
- `frontend/src/AttendanceModule.tsx`: versi yang disertakan agar file frontend tetap satu rangkaian dengan Tahap 7.
- `frontend/src/lib/supabase.ts`: konfigurasi client Supabase yang dipakai paket sebelumnya.
- `frontend/public/rq-logo.png`: logo yang dipakai pada paket sebelumnya.
- `09_performance_review_workflow.sql`: indikator umum, fungsi penyimpanan transaksional, dan penguatan kebijakan RLS untuk mutasi penilaian.

## Prasyarat
1. Proyek RQ SDM sudah memakai struktur skema awal Supabase yang memiliki `performance_indicators`, `performance_reviews`, `performance_review_scores`, `employee_assignments`, `units`, dan `positions`.
2. Fungsi `public.can_manage_unit(uuid)`, `public.is_hr_admin()`, dan kebijakan baca `performance_reviews` / `performance_review_scores` dari skema awal sudah tersedia.
3. Tahap 7 Absensi sudah dipasang. `xlsx` tetap dibutuhkan untuk impor Excel pada modul absensi.

## Pemasangan frontend
1. Di `D:\RQ_SDM`, cadangkan `src\App.tsx` dan `src\App.css`.
2. Ekstrak ZIP, lalu salin file di folder `frontend` ke proyek dengan struktur yang sama:
   - `frontend\src\App.tsx` → `D:\RQ_SDM\src\App.tsx`
   - `frontend\src\App.css` → `D:\RQ_SDM\src\App.css`
   - `frontend\src\PerformanceModule.tsx` → `D:\RQ_SDM\src\PerformanceModule.tsx`
   - `frontend\src\AttendanceModule.tsx` → `D:\RQ_SDM\src\AttendanceModule.tsx`
   - `frontend\src\lib\supabase.ts` → `D:\RQ_SDM\src\lib\supabase.ts`
   - `frontend\public\rq-logo.png` → `D:\RQ_SDM\public\rq-logo.png`
3. Jangan mengganti `.env.local`, `package.json`, `package-lock.json`, atau `src\main.tsx`.

## Pemasangan SQL
1. Buka Supabase → SQL Editor → New query.
2. Buka `09_performance_review_workflow.sql`, salin seluruh isinya, tempel ke SQL Editor, lalu Run.
3. Jalankan sekali pada proyek yang sudah memiliki tabel `performance_*`. Skrip dapat dijalankan ulang untuk seed dan fungsi, tetapi tetap tinjau perubahan kebijakan jika database telah dikustomisasi.
4. Pastikan hasil Run tanpa error sebelum membuka modul.

## Menjalankan
```cmd
cd /d D:\RQ_SDM
npm run dev
```

Menu Penilaian Kinerja muncul untuk Sekjen/Super Admin, Pimpinan (baca), dan Kepala Unit yang memiliki akses unit. Petugas absensi/operator SDM tidak otomatis mendapat hak menilai.

## Perilaku modul
- Lima indikator global awal disediakan: kedisiplinan, tanggung jawab, kualitas kerja, pencapaian target, serta komunikasi/kerja sama.
- Sekjen/Super Admin dapat menambah indikator lingkup global, unit, atau jabatan serta mengaktifkan/menonaktifkannya.
- Kepala Unit hanya dapat membuat dan mengubah penilaian pada unit yang ditugaskan.
- Pimpinan dapat melihat riwayat dan rincian nilai, tetapi tidak dapat menyimpan penilaian kecuali ia juga mempunyai peran Kepala Unit pada unit tersebut.
- Nilai memakai skala 1–5. Nilai akhir adalah rata-rata tertimbang dari semua indikator aktif yang berlaku bagi unit/jabatan penugasan.
- Semua indikator aktif yang berlaku harus diberi nilai sebelum draft/final disimpan, agar hasil antarpenugasan konsisten.
- Draft dapat diedit. Finalisasi mengunci penilaian dari Kepala Unit; Sekjen/Super Admin tetap dapat memperbaikinya jika diperlukan.
- Fungsi RPC memvalidasi akses unit, kecocokan employee/assignment/unit, periode, lingkup indikator, skor, dan duplikasi indikator dalam satu transaksi.
- Mutasi langsung tabel review/score dibatasi untuk admin; Kepala Unit menyimpan melalui RPC tervalidasi.

## Uji aman terlebih dahulu
Gunakan data simulasi. Buat penugasan simulasi Guru Tahfidz dan Musyrif untuk orang yang sama, lalu pastikan dua penugasan menghasilkan review terpisah. Uji akun Kepala Unit dan Pimpinan untuk memastikan batas akses bekerja. Jangan gunakan NIK atau biodata nyata untuk pengujian modul penilaian.

## Batasan
- Paket ini belum menjalankan migrasi terhadap proyek Supabase pengguna dan belum diuji langsung pada akun tersebut.
- Modul belum mengirim notifikasi otomatis dan belum mengekspor PDF/Excel laporan penilaian.
- Data kehadiran tidak otomatis menjadi nilai kinerja; kedisiplinan dinilai dengan bukti dan konteks penugasan.
