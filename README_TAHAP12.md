# RQ SDM Tahap 12 — Form Izin / Ketidakhadiran tanpa akun SDM

Paket ini menambahkan form publik sederhana untuk SDM, kotak masuk pengajuan untuk Sekjen/Kepala Unit, persetujuan dengan animasi stempel, dan pembukaan WhatsApp dengan pesan keputusan yang sudah disiapkan.

## Alur yang dibuat

1. SDM membuka tautan `/form-izin` atau `/?form=izin`. Tidak perlu login atau memiliki akun.
2. SDM mengisi nama, unit, penugasan, jenis pengajuan, tanggal/shift, alasan, dan nomor WhatsApp.
3. Pengajuan masuk ke tabel `absence_submissions`. Kotak masuk Kepala Unit diperbarui melalui Supabase Realtime bila publikasi Realtime tersedia.
4. Sekjen dapat melihat lintas unit. Kepala Unit hanya melihat unit yang tercantum pada `user_unit_access` dengan `access_role = 'kepala_unit'`.
5. Kepala Unit meninjau pengajuan lalu menekan **Setujui & Kirim WhatsApp** atau **Tolak & Kirim WhatsApp**. Animasi stempel tampil setelah keputusan berhasil disimpan.
6. Browser membuka WhatsApp dengan pesan yang telah disiapkan ke nomor yang dicantumkan di form. Kepala unit masih perlu menekan tombol **Kirim** di WhatsApp; pesan tidak dikirim diam-diam oleh aplikasi.
7. Jika pengajuan disetujui dan Kepala Unit mencocokkan penugasan yang benar, pengajuan penuh hari (tidak hadir, sakit, izin, cuti, dinas luar) membuat catatan absensi untuk tanggal yang cocok dengan jadwal aktif. Catatan absensi yang sudah ada tidak ditimpa. Izin terlambat/pulang awal tidak otomatis mengisi status absensi karena waktu aktual tetap perlu dicatat.

## 1. Cadangkan proyek

Di VS Code terminal:

```cmd
cd /d D:\RQ_SDM
mkdir backup-tahap12
xcopy src backup-tahap12\src /E /I /H
xcopy public backup-tahap12\public /E /I /H
```

Jika folder backup sudah ada, gunakan nama lain.

## 2. Pasang frontend

- Salin isi folder `frontend/src` ke `D:\RQ_SDM\src`, izinkan penggantian file dengan nama sama.
- Salin isi folder `frontend/public` ke `D:\RQ_SDM\public`.
- Salin `vercel.json` ke root `D:\RQ_SDM`.
- Pertahankan `.env.local`, `package.json`, `package-lock.json`, dan `node_modules` milik proyek.

Paket menggunakan baseline frontend RQ SDM dari perbaikan audit terakhir dan menambahkan `AbsenceRequestsModule.tsx`, `PublicAbsenceForm.tsx`, serta CSS-nya.

Jika proyek sudah mempunyai `vercel.json`, jangan timpa konfigurasi lain begitu saja; gabungkan rewrite berikut ke konfigurasi yang ada:

```json
{
  "rewrites": [
    { "source": "/form-izin", "destination": "/index.html" }
  ]
}
```

## 3. Jalankan migrasi SQL satu kali

Buka Supabase Dashboard → SQL Editor → New query. Salin seluruh isi file `12_absence_request_form.sql`, kemudian klik **Run**.

File yang sama juga disediakan di `supabase/migrations/20261024000200_absence_request_form.sql` untuk riwayat Git. **Jangan menjalankan kedua salinan**; cukup jalankan satu kali di SQL Editor.

Migrasi ini membuat:
- tabel pengajuan dengan RLS;
- perlindungan rate-limit sederhana (maksimal 5 pengajuan per jam per hash IP);
- fungsi keputusan yang memeriksa hak akses kepala unit/Sekjen;
- audit log keputusan;
- sinkronisasi absensi yang hanya menambahkan catatan pada jadwal yang cocok dan tidak menimpa catatan lama;
- pendaftaran tabel ke Supabase Realtime jika publikasi `supabase_realtime` tersedia.

## 4. Deploy Edge Function publik

Pastikan Supabase CLI sudah login dan proyek sudah terhubung. Jika belum:

```cmd
npx supabase login
npx supabase link --project-ref PROJECT_REF_MILIK_ANDA
```

Ganti `PROJECT_REF_MILIK_ANDA` dengan project ref Supabase sendiri. Lalu deploy fungsi publik:

```cmd
npx supabase functions deploy public-absence-submission --no-verify-jwt
```

Fungsi ini perlu `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY` tersedia sebagai environment/secret di sisi Supabase Edge Functions. Jangan pernah menaruh service-role key pada React, `.env.local` dengan awalan `VITE_`, GitHub, atau membagikannya di chat. Fungsi publik tidak menggunakan akun SDM; validasi dan rate-limit dilakukan di server.

## 5. Uji lokal

```cmd
npm run dev
```

- Portal internal: buka alamat localhost seperti biasa.
- Form publik: buka `http://localhost:5173/form-izin` atau `http://localhost:5173/?form=izin`.
- Jika form belum dapat memuat unit, pastikan migrasi dan Edge Function telah terpasang.
- Login dengan akun Sekjen atau akun Kepala Unit yang sudah diberi akses unit.
- Buka menu **Izin & Ketidakhadiran**. Pengajuan dari form akan tampil pada kotak masuk sesuai RLS.

## 6. Uji alur persetujuan

1. Kirim satu pengajuan uji dengan nomor WhatsApp milik sendiri.
2. Buka kotak masuk dari akun Kepala Unit yang sesuai.
3. Klik **Tinjau** dan cocokkan dengan penugasan terdaftar jika ingin menghubungkan absensi.
4. Klik **Setujui & Kirim WhatsApp**.
5. Pastikan stempel persetujuan tampil, keputusan tercatat, dan WhatsApp terbuka dengan pesan yang benar.
6. Di WhatsApp, periksa isi pesan terlebih dahulu lalu tekan **Kirim** secara manual.
7. Uji penolakan dan pastikan tidak ada catatan absensi yang ditambahkan.

## Catatan keamanan dan batasan

- Form publik tidak menampilkan daftar nama pegawai, NIK, atau biodata. Pengirim memasukkan nama dan penugasannya sendiri.
- Data pengajuan hanya dapat dibaca Sekjen/Super Admin dan Kepala Unit yang berwenang pada unit terkait. Petugas absensi biasa tidak mendapat akses kotak masuk pengajuan.
- Rate limit mengandalkan IP yang di-hash, bukan menyimpan IP mentah. Ini pengamanan dasar, bukan pengganti CAPTCHA untuk penggunaan publik berskala besar.
- Persetujuan bukan berarti WhatsApp sudah terkirim. Browser hanya membuka pesan yang sudah disiapkan; pengiriman dilakukan oleh kepala unit di WhatsApp.
- Jika penugasan tidak dicocokkan, keputusan tetap tersimpan dan WhatsApp dapat dibuka, tetapi catatan absensi tidak dibuat otomatis.
- Sinkronisasi absensi hanya berlaku untuk jenis ketidakhadiran penuh hari dan jadwal aktif yang shift-nya cocok. Jika sudah ada catatan absensi untuk tanggal/shift itu, sistem tidak menimpanya.
- Uji dengan data simulasi terlebih dahulu. SQL dan Edge Function belum dijalankan pada proyek Supabase milik pengguna.

## Pemeriksaan kode

Pemeriksaan TypeScript frontend (`tsc -b`) berhasil pada paket kerja. Build Vite penuh dan perilaku database belum diverifikasi pada Supabase/Vercel milik pengguna.
