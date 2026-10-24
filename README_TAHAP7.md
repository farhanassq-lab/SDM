# RQ SDM Tahap 7 — Roster Absensi Bulanan, Jadwal Kerja, dan Impor Excel

Tahap ini menambahkan modul absensi pada frontend Tahap 6A. Modul menggunakan tabel yang sudah ada di skema awal: `work_schedules`, `attendance_records`, dan `attendance_import_batches`.

## Fitur
- Roster bulan penuh per unit dan per penugasan.
- Status hadir, terlambat, sakit, cuti, izin, alpa, dan libur.
- Setiap status disimpan berdasarkan penugasan + tanggal + shift.
- Pengaturan jadwal berulang per hari/shift dengan tanggal berlaku.
- Versi jadwal lama dipertahankan ketika jadwal baru diberlakukan.
- Shift `PAGI` dan `MALAM` dapat dibuat terpisah untuk Satpam.
- Jadwal mingguan dapat dibuat untuk pelatih LPP.
- Unduh template Excel dan impor `.xlsx`, `.xls`, atau `.csv` dengan pratinjau validasi.
- Import menolak seluruh file jika ada baris invalid atau duplikat dalam file, agar tidak terjadi impor parsial yang membingungkan.
- Pembatasan unit mengikuti RLS Supabase. Sekjen/Super Admin melihat seluruh unit; pimpinan dapat melihat; Kepala Unit dan Petugas Absensi mengelola absensi unit sesuai haknya.

## Prasyarat
1. Tabel `employee_assignments`, `work_schedules`, `attendance_records`, dan `attendance_import_batches` tersedia.
2. Kebijakan RLS skema awal sudah diterapkan.
3. `src/lib/supabase.ts` dan `.env.local` tetap benar.
4. Frontend Tahap 6A sudah termasuk dalam paket ini, tetapi SQL Tahap 6A harus sudah pernah dijalankan. Jika belum, ikuti urutan SQL di bawah.

## Cara memasang
1. Cadangkan `src/App.tsx` dan `src/App.css`.
2. Salin file di folder `frontend` ke proyek `D:\RQ_SDM` dengan mempertahankan struktur folder:
   - `frontend/src/App.tsx` -> `src/App.tsx`
   - `frontend/src/App.css` -> `src/App.css`
   - `frontend/src/AttendanceModule.tsx` -> `src/AttendanceModule.tsx`
   - `frontend/src/lib/supabase.ts` -> `src/lib/supabase.ts`
   - `frontend/public/rq-logo.png` -> `public/rq-logo.png`
3. Di terminal proyek, jalankan `npm install xlsx`.
4. Jika belum pernah memasang pemeriksaan NIK Tahap 6, jalankan `06_check_nik_rpc.sql` terlebih dahulu.
5. Jika belum pernah menjalankan input langsung Tahap 6A, jalankan `07_direct_input_no_unit_requests.sql`. Jika sudah pernah, jangan jalankan ulang tanpa kebutuhan.
6. Jalankan `08_attendance_schedule_versioning.sql`, lalu pastikan kolom hasil `schedule_version_function` tidak `NULL`.
7. Jalankan `npm run dev`.

## Uji dengan data simulasi
1. Login sebagai Sekjen atau Kepala Unit dan buka menu `Absensi Bulanan`.
2. Pilih unit, buka tab `Jadwal Kerja`, lalu tambahkan jadwal untuk satu penugasan simulasi.
3. Untuk Satpam, buat jadwal `PAGI` dan `MALAM` sesuai hari yang ditetapkan.
4. Untuk LPP, buat satu jadwal pada hari yang ditetapkan.
5. Kembali ke `Roster Bulanan`; hanya tanggal yang sesuai jadwal yang dapat diisi, kecuali jika tanggal sudah memiliki catatan absensi sebelumnya.
6. Pilih status kehadiran. Status tersimpan ke `attendance_records`.
7. Unduh template Excel, isi status, lalu unggah di tab `Impor Excel` untuk melihat hasil validasi sebelum impor.
8. Uji akun Petugas Absensi dan pastikan ia tidak bisa mengubah jadwal; uji akun Pimpinan dan pastikan hanya bisa melihat.

## Format Excel
Kolom yang dihasilkan template:
- `nama_lengkap`
- `jabatan`
- `tanggal` (YYYY-MM-DD)
- `shift_code` (contoh `REGULAR`, `PAGI`, `MALAM`)
- `status` (`present`, `late`, `sick`, `leave`, `excused`, `alpha`, `holiday`; label Indonesia juga diterima)
- `jam_masuk`
- `jam_keluar`
- `menit_terlambat`
- `catatan`

Nama lengkap + jabatan harus cocok secara unik dengan penugasan pada unit yang dipilih. Ini menghindari data tersimpan ke orang yang salah ketika nama sama. Status `late` membutuhkan `menit_terlambat` minimal 1 pada impor.

## Catatan keamanan dan batasan
- Jangan memasukkan NIK ke file impor absensi; pencocokan menggunakan nama dan jabatan dalam unit yang dipilih.
- Jangan masukkan `service_role` key ke frontend.
- Payroll belum termasuk dalam modul.
- Migrasi ini hanya menambahkan fungsi versi jadwal; tidak menghapus atau mengubah catatan absensi lama.
- Frontend dan SQL telah diperiksa secara statis untuk sintaks, tetapi belum bisa diuji terhadap database Supabase pengguna. Jalankan dahulu menggunakan data simulasi dan periksa kebijakan RLS sebelum data asli dipakai.
