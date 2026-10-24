# RQ SDM Tahap 13 — Monitoring Aktivitas Unit

Paket ini menambahkan modul Monitoring Aktivitas Unit ke baseline frontend Tahap 12 (form izin/ketidakhadiran) tanpa menghapus modul yang sudah ada.

## Fitur
- Program kerja per unit dengan kategori, uraian, tanggal mulai/target, penanggung jawab, status, dan progres.
- Catatan perkembangan berisi ringkasan, hasil, kendala, tindak lanjut, dan tautan bukti kegiatan.
- Filter pencarian, unit, dan status.
- Ringkasan jumlah program, program berjalan, selesai, dan terkendala.
- Hak akses berbasis Supabase RLS: Sekjen/Super Admin dapat mengelola semua unit; Kepala Unit dan Operator SDM mengelola unit yang ditugaskan; Pimpinan dapat melihat lintas unit; Petugas Absensi dapat melihat unit yang diberikan akses tanpa hak membuat atau mengubah program.
- Aktivitas dapat menjadi bahan evaluasi, tetapi tidak menggantikan absensi.

## Pemasangan
1. Buat backup proyek `D:\RQ_SDM`.
2. Salin isi folder `frontend/src` ke `D:\RQ_SDM\src` dan isi `frontend/public` ke `D:\RQ_SDM\public` sesuai struktur. Ini baseline yang memuat modul Tahap 12 serta modul baru. Pertahankan `.env.local`, `package.json`, `package-lock.json`, dan `node_modules` milikmu.
3. Buka Supabase SQL Editor pada proyek RQ SDM yang benar (project ref `kodmeuxktfmsaqinmfzk`) dan jalankan seluruh isi `13_unit_activity_monitoring.sql` satu kali. Jangan jalankan pada proyek Laundry_ERQI.
4. Jalankan `npm run dev`.
5. Login sebagai Sekjen, Kepala Unit, atau Pimpinan. Menu **Monitoring Aktivitas Unit** tampil sesuai kewenangan.

Tidak perlu menjalankan ulang migrasi Tahap 12 atau deploy ulang Edge Function izin.

## Uji coba yang disarankan
- Sekjen membuat program pada unit Tahfidz, mengisi target dan penanggung jawab, lalu menyimpan.
- Tambahkan catatan perkembangan dengan hasil dan kendala.
- Login sebagai Kepala Unit Tahfidz: program unit Tahfidz dapat dikelola, unit lain tidak dapat diakses.
- Login sebagai Pimpinan: program lintas unit dapat dibaca, tetapi tidak dapat dibuat/diubah.
- Login sebagai Operator SDM yang memiliki akses unit: dapat membuat dan memperbarui program unit tersebut.
- Pastikan akses langsung via Supabase ditolak RLS untuk unit yang tidak menjadi kewenangan pengguna.

## Catatan
- `evidence_url` adalah tautan URL bukti, bukan unggah file langsung. Integrasi Supabase Storage dapat ditambahkan setelah modul inti stabil.
- SQL membuat fungsi helper akses baru dan tabel baru. Jalankan sekali. Jika SQL berhenti karena nama constraint/kolom dari skema lokal berbeda, jangan menebak atau menghapus data; kirim pesan error SQL untuk disesuaikan.
- Kode belum diuji terhadap database aktual milik pengguna. Validasi migrasi dan uji menggunakan data simulasi terlebih dahulu.
