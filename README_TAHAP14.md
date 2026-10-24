# RQ SDM Tahap 14 — Unggah Bukti Kegiatan

Tahap ini mengganti input tautan bukti kegiatan dengan unggahan file langsung ke Supabase Storage privat. Foto dan PDF tidak menjadi file publik; akses file mengikuti RLS unit.

## Isi paket
- `frontend/src/ActivityMonitoringModule.tsx` — formulir perkembangan dengan unggah bukti.
- `frontend/src/ActivityMonitoringModule.css` — gaya input file dan tautan bukti.
- `14_activity_evidence_storage.sql` — bucket privat dan kebijakan akses Storage.

## Pemasangan aman
1. Cadangkan `D:\RQ_SDM\src\ActivityMonitoringModule.tsx` dan `ActivityMonitoringModule.css`.
2. Buka Supabase SQL Editor pada proyek RQ SDM yang benar. Jalankan isi `14_activity_evidence_storage.sql` satu kali. Pastikan migrasi Tahap 13 sudah berjalan karena SQL ini memakai tabel dan helper `can_view_unit_activity`, `can_manage_unit_activity`, dan `can_delete_unit_activity`.
3. Dari folder `frontend/src` di paket, salin hanya `ActivityMonitoringModule.tsx` dan `ActivityMonitoringModule.css` ke `D:\RQ_SDM\src`. Jangan mengganti `App.tsx`, `.env.local`, `package.json`, atau modul lain.
4. Jalankan `npm run dev`. Tidak perlu deploy Edge Function dan tidak perlu Docker untuk migrasi SQL atau unggah file dari frontend.

## Penggunaan
1. Login sebagai Sekjen, Kepala Unit, atau Operator SDM yang punya akses mengelola unit.
2. Buka Monitoring Aktivitas Unit dan pilih program yang menjadi tanggung jawab unit.
3. Klik `Catat Perkembangan`, isi ringkasan, lalu pilih foto JPG/PNG/WEBP atau PDF maksimal 10 MB.
4. Simpan. File diunggah ke bucket privat `rq-activity-evidence`; path file disimpan di `unit_activity_updates.evidence_url`.
5. Pada riwayat, klik `Buka bukti kegiatan`. Aplikasi membuat signed URL sementara 5 menit. Pengguna Pimpinan yang hanya membaca unit dapat membuka bukti, tetapi tidak mengunggah.

## Keamanan dan kompatibilitas
- Bucket bersifat privat, bukan public. Jangan mengubahnya menjadi public.
- RLS Storage membatasi akses berdasarkan unit dan program.
- Jenis file yang diterima: JPEG, PNG, WEBP, PDF; maksimum 10 MB.
- URL eksternal yang disimpan pada data lama tetap dapat dibuka.
- Jika file berhasil diunggah tetapi catatan database gagal disimpan, kode mencoba menghapus file sementara tersebut.
- Paket ini belum diuji pada database milik pengguna. Uji dengan data simulasi dan dua akun berbeda unit.
