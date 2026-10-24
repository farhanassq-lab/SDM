# RQ SDM Tahap 2 — Madrasah Aliyah & Tsanawiyah

## Struktur unit baru
- `MADRASAH` adalah grup induk (bukan unit operasional absensi).
- `MADRASAH_ALIYAH` adalah unit operasional di bawah grup Madrasah.
- `MADRASAH_TSANAWIYAH` adalah unit operasional di bawah grup Madrasah.
- `BUD_RQ` adalah grup induk; `BUD_RQ_MARKET` dan `BUD_RQ_LAUNDRY` adalah unit operasional.
- Unit lain tetap operasional.

## Pilih salah satu cara database
### A. Jika SQL awal sudah dijalankan di Supabase
1. Buka `02_migration_madrasah_ma_mts.sql`.
2. Jalankan seluruh SQL tersebut di Supabase SQL Editor.
3. Periksa hasil query verifikasi di bagian akhir.
4. Jika `assignments_still_on_madrasah_group` lebih dari 0, jangan pindahkan otomatis. Konfirmasi satu per satu apakah pegawai bertugas di MA atau MTs, lalu ubah assignment ke unit yang benar.

### B. Jika SQL awal belum pernah dijalankan
Gunakan `01_initial_schema_fresh_project.sql` pada proyek Supabase kosong. Jangan menjalankan SQL awal lama kemudian menjalankan skrip initial ini di proyek yang sudah terisi. Skrip initial ditujukan untuk database baru.

## Memperbarui frontend
1. Salin `frontend/src/App.tsx` ke `D:\RQ_SDM\src\App.tsx`.
2. Salin `frontend/src/App.css` ke `D:\RQ_SDM\src\App.css`.
3. Tidak perlu mengganti `src/lib/supabase.ts` jika sudah terpasang dari paket tahap sebelumnya.
4. Pastikan migration atau initial schema sudah berhasil dijalankan terlebih dahulu karena frontend sekarang membaca kolom `unit_type`.
5. Mulai ulang Vite dengan `Ctrl+C`, lalu `npm run dev`.

## Keamanan
- Jangan menaruh service role key atau secret key di frontend.
- Jangan unggah `.env.local` ke GitHub.
- Migration ini tidak memindahkan assignment pegawai secara otomatis, karena sekolah tempat bertugas harus dipastikan oleh pihak dayah.
