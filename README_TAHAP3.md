# RQ SDM — Tahap 3: Identitas Visual & Pengelolaan Data SDM

Paket ini memperbarui frontend React + TypeScript agar menggunakan logo resmi Dayah Ruhul Qurani, palet biru laut-ke-langit, penjelasan filosofi logo, serta modul awal Direktori SDM.

## Makna desain
- Biru tua mewakili laut dan fondasi awal perjalanan.
- Gradasi biru menuju cyan mewakili langit dan cita-cita luhur.
- Narasi **"Dari laut menuju langit"** menjelaskan perjalanan spiritual dan intelektual yang berlandaskan Al-Qur'an.
- Logo asli digunakan apa adanya sebagai aset identitas, bukan digambar ulang.

## Isi paket
- `frontend/src/App.tsx`: login, dashboard, struktur unit, direktori SDM, tambah/edit profil, dan tambah penugasan tambahan.
- `frontend/src/App.css`: desain responsif dengan palet biru logo.
- `frontend/src/lib/supabase.ts`: client Supabase menggunakan publishable key.
- `frontend/public/rq-logo.png`: logo yang dikirim pengguna.
- `frontend/index.html`: judul aplikasi, deskripsi, warna tema, dan favicon.
- `.env.example`: contoh konfigurasi tanpa kredensial asli.
- `03_employee_creation_rpc.sql`: fungsi PostgreSQL transaksional untuk membuat profil pegawai beserta penugasan utama.

## Sebelum memasang
Paket ini mengasumsikan database Supabase sudah menjalankan skema awal RQ SDM dan migrasi unit Madrasah Aliyah/Madrasah Tsanawiyah. Jika belum, jalankan skema dan migrasi yang sesuai terlebih dahulu.

## Cara memasang di `D:\RQ_SDM`
1. Buat cadangan folder proyek saat ini.
2. Salin `frontend/src/App.tsx` ke `D:\RQ_SDM\src\App.tsx`.
3. Salin `frontend/src/App.css` ke `D:\RQ_SDM\src\App.css`.
4. Salin `frontend/src/lib/supabase.ts` ke `D:\RQ_SDM\src\lib\supabase.ts`.
5. Salin `frontend/public/rq-logo.png` ke `D:\RQ_SDM\public\rq-logo.png`. Buat folder `public` jika belum ada.
6. Ganti `D:\RQ_SDM\index.html` dengan `frontend/index.html` dari paket.
7. Pertahankan file `.env.local` yang sudah ada. Jangan menggantinya dengan `.env.example` dan jangan mengunggah `.env.local` ke GitHub.
8. Di Supabase Dashboard → SQL Editor, jalankan `03_employee_creation_rpc.sql` dari paket ini. Fungsi ini memastikan pembuatan profil dan penugasan utama berlangsung dalam satu transaksi.
9. Jalankan `npm run dev` di terminal proyek.

## Modul SDM yang tersedia pada tahap ini
- Direktori pegawai dengan pencarian nama/kode dan filter unit.
- Membuat profil SDM dan penugasan utama melalui fungsi database transaksional.
- Mengubah data induk SDM (nama, kode, tanggal bergabung, status).
- Menambahkan penugasan tambahan untuk pegawai yang sama.
- Mendukung MA dan MTs sebagai unit operasional yang berbeda; Market dan Laundry tetap subunit BUD_RQ.
- Data ditarik langsung dari tabel `employees`, `employee_assignments`, `units`, `positions`, `user_roles`, dan `user_unit_access`.

## Batasan dan catatan keamanan
- Modul ini tidak membuat atau menjalankan payroll.
- Akun Sekjen/Super Admin dapat membuat dan mengubah data induk pegawai. Kepala unit hanya dapat menambahkan penugasan dalam unit yang diberikan aksesnya, sesuai kebijakan RLS yang ada.
- Petugas absensi dan pimpinan tidak otomatis diberi izin mengubah data induk.
- RLS database tetap menjadi sumber otoritatif untuk hak akses; menyembunyikan tombol di frontend bukan pengganti RLS.
- Data pegawai hanya terlihat sesuai kebijakan RLS. Jika suatu akun tidak memiliki unit/role yang tepat, beberapa daftar mungkin kosong atau menghasilkan pesan error.
- Fungsi `create_employee_with_primary_assignment` memerlukan login dan peran Sekjen/Super Admin; fungsi tidak dapat digunakan oleh akun anonim.
- Uji terlebih dahulu dengan data simulasi pada proyek development. Jangan masukkan data pegawai asli sampai hak akses, RLS, dan backup sudah diverifikasi.

## Filosofi logo yang ditampilkan
Huruf Ro (ر) dan Qof (ق) membentuk identitas Ruhul Qurani. Biru tua melambangkan laut, sedangkan gradasi biru muda melambangkan langit. Perjalanan dari laut menuju langit menggambarkan proses spiritual dan intelektual untuk menggapai cita-cita luhur dengan nilai-nilai Al-Qur'an sebagai landasan.
