# RQ SDM Tahap 15: absensi bulanan, hotfix audit, foto masjid senja

## Cara memasang (urutan penting)

1. **Supabase SQL Editor**: jalankan `15_attendance_monthly_summary.sql` sekali. File yang sama ada di `supabase/migrations/20261024000400_attendance_monthly_summary.sql`. Aman dijalankan ulang. Tabel absensi harian dan jadwal lama tidak dihapus.
2. **Edge function**: deploy ulang `public-absence-submission` (perbaikan tanggal WIB).
   `supabase functions deploy public-absence-submission`
3. **Frontend**: `npm install`, `npm run build`, lalu deploy ke Vercel seperti biasa.
4. Ganti email di `BOOTSTRAP_ADMIN.sql` hanya bila Anda membuat admin baru (email sudah diganti placeholder).

## Yang berubah

### Absensi menjadi rekap bulanan
- Menu **Rekap Absensi Bulanan** menggantikan grid harian. Satu baris = satu penugasan untuk satu bulan:
  hari wajib, hadir, hadir terlambat, izin, sakit, cuti, alpa, total menit terlambat, catatan.
- Hari wajib default dihitung otomatis (semua hari kecuali Minggu) dan bisa diubah. Tombol **Terapkan ke semua** dan **Isi sisa hari sebagai Hadir** mempercepat input.
- Validasi: total hari tidak boleh melebihi hari wajib; kolom **Sisa** menunjukkan hari yang belum terisi.
- Pengajuan izin yang sudah disetujui muncul sebagai petunjuk di bawah nama (hari kalender); klik **pakai** untuk mengisi Izin/Sakit/Cuti.
- Impor Excel: unduh template, isi, impor, periksa di tabel, lalu simpan.
- Status **Draft** dan **Final**. Final hanya oleh Kepala Unit atau Sekjen, lalu terkunci untuk petugas absensi. Kepala Unit/Sekjen dapat **Buka kembali**. Semua perubahan masuk `audit_logs`.
- Laporan (layar, Excel, PDF cetak) membaca rekap bulanan. Persentase hadir sekarang = hari hadir dibagi total hari wajib. Penugasan yang belum diinput tetap tampil sebagai "Belum diinput". Laporan memberi peringatan bila masih ada rekap Draft.
- Jadwal kerja mingguan tidak lagi dipakai di antarmuka. Tabel `work_schedules` dan RPC-nya tetap ada di database.

### Hotfix dari audit
- Tanggal "hari ini" memakai WIB (aplikasi dan edge function), bukan UTC.
- Data SDM dan penugasan dibaca per halaman (tidak terpotong di 1.000 baris). Laporan juga.
- Hitungan pengajuan (menunggu/disetujui/ditolak) diambil dari server, bukan dari 250 baris terakhir.
- Nilai kinerja hanya terbaca oleh Sekjen/Super Admin, Pimpinan, dan Kepala Unit terkait (RLS dan antarmuka laporan).
- Penilaian kinerja tidak lagi diisi default 3; penilai wajib memilih nilai.
- Akun nonaktif langsung dikeluarkan dari sesi.
- Akun baru wajib mengganti kata sandi sementara sebelum masuk (`must_change_password` sekarang benar-benar dibaca).
- `created_by` program aktivitas diisi server.
- `vercel.json` menambahkan header keamanan dasar.

### Tampilan
- Foto masjid senja dipakai di halaman masuk (hero), kartu sambutan beranda, dan header form izin publik. Foto masjid siang tetap di sidebar dan topbar.

## Belum dikerjakan (saran berikutnya)
- Pembatasan laju (rate limit) pada pencarian nama di form publik.
- CSP (Content-Security-Policy) dan `supabase/config.toml`.
- Pemecahan `App.tsx` menjadi halaman dengan router, dan tes otomatis (Vitest, Playwright) serta CI.
- Pembaruan paket `xlsx` ke versi yang bebas kerentanan.
