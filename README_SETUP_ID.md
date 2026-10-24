# RQ SDM — Tahap Integrasi Supabase

## Isi paket
- `src/App.tsx`: login dan dashboard awal yang membaca unit, profil, dan peran dari Supabase.
- `src/App.css`: gaya responsif awal.
- `src/lib/supabase.ts`: inisialisasi Supabase client.
- `.env.example`: contoh variabel lingkungan.
- `BOOTSTRAP_ADMIN.sql`: memberi peran awal Sekjen kepada pengguna Auth yang sudah dibuat.

## Cara memasang
1. Pastikan proyek Vite React + TypeScript sudah ada di `D:\RQ_SDM`.
2. Di terminal proyek, jalankan `npm install @supabase/supabase-js` jika belum dilakukan.
3. Salin `src/App.tsx`, `src/App.css`, dan `src/lib/supabase.ts` dari paket ini ke lokasi yang sama di proyek lokal, mengganti file contoh Vite.
4. Buat file `.env.local` di root proyek, sejajar dengan `package.json`. Isi URL dan publishable key dari Supabase. Jangan mengunggah `.env.local` ke GitHub.
5. Pastikan `.gitignore` berisi `.env`, `.env.*`, dan `!.env.example`.
6. Buat pengguna pertama di Supabase Dashboard > Authentication > Users > Add user. Gunakan email admin yang memang dikelola dayah, kata sandi kuat, dan konfirmasi email sesuai opsi dashboard.
7. Buka Supabase SQL Editor. Salin isi `BOOTSTRAP_ADMIN.sql`, ganti `GANTI_DENGAN_EMAIL_ADMIN` dengan email yang sama, lalu jalankan. Query ini memberi role `sekjen` dan profil awal.
8. Hentikan Vite dengan `Ctrl+C`, kemudian jalankan `npm run dev` lagi agar `.env.local` terbaca.
9. Buka URL localhost, login dengan akun yang dibuat, dan periksa apakah dashboard menampilkan unit serta role `Sekjen / Admin SDM`.

## Keamanan
- Frontend hanya boleh memakai Supabase publishable key atau anon key lama.
- Jangan pernah memasukkan `service_role` atau secret key ke variabel `VITE_*`.
- Jangan menonaktifkan RLS untuk memperbaiki error.
- Jangan mengunggah `.env.local` ke GitHub.
- Dashboard ini adalah tahap koneksi awal, bukan modul SDM/absensi lengkap.
