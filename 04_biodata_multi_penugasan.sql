-- RQ SDM Tahap 4
-- Biodata pegawai lengkap, tanpa kode nomor SDM dan tanpa hierarki penugasan utama/sampingan.
-- Jalankan pada proyek Supabase RQ SDM yang sudah memiliki skema awal + migrasi MA/MTs.

begin;

-- Hapus RPC lama yang bergantung pada employee_code dan is_primary.
drop function if exists public.create_employee_with_primary_assignment(text, text, text, date, uuid, uuid, text, text);
drop index if exists public.employee_assignments_one_active_primary;

-- Tidak ada konsep penugasan utama/sampingan. Setiap baris assignment adalah peran mandiri.
alter table public.employee_assignments drop column if exists is_primary;

-- Dayah tidak menggunakan nomor/kode SDM. Hapus kolom lama hanya jika kosong agar tidak
-- membuang data tanpa sengaja. Jika masih ada kode terisi, migrasi berhenti dan perlu ditinjau dulu.
do $$
declare
  v_has_codes boolean := false;
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'employees' and column_name = 'employee_code') then
    execute $q$select exists (select 1 from public.employees where nullif(trim(employee_code), '') is not null)$q$ into v_has_codes;
    if v_has_codes then
      raise exception 'Kolom employee_code masih berisi nilai. Ekspor/periksa nilai tersebut terlebih dahulu; migrasi dihentikan agar tidak kehilangan data.';
    end if;
    alter table public.employees drop column employee_code;
  end if;
end $$;

create table if not exists public.employee_biodata (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  nik text not null unique check (nik ~ '^[0-9]{16}$'),
  gender text not null check (gender in ('L', 'P')),
  place_of_birth text not null,
  date_of_birth date not null,
  religion text,
  marital_status text not null check (marital_status in ('belum_menikah', 'menikah', 'cerai_hidup', 'cerai_mati')),
  education_level text not null,
  address text not null,
  phone text not null,
  email text,
  emergency_contact_name text,
  emergency_contact_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(place_of_birth)) > 0),
  check (length(trim(address)) > 0),
  check (length(trim(phone)) > 0),
  check (length(trim(education_level)) > 0)
);

alter table public.employee_biodata enable row level security;

drop policy if exists employee_biodata_select_hr_admin on public.employee_biodata;
create policy employee_biodata_select_hr_admin
  on public.employee_biodata for select to authenticated
  using (public.is_hr_admin());

drop policy if exists employee_biodata_insert_hr_admin on public.employee_biodata;
create policy employee_biodata_insert_hr_admin
  on public.employee_biodata for insert to authenticated
  with check (public.is_hr_admin());

drop policy if exists employee_biodata_update_hr_admin on public.employee_biodata;
create policy employee_biodata_update_hr_admin
  on public.employee_biodata for update to authenticated
  using (public.is_hr_admin()) with check (public.is_hr_admin());

drop policy if exists employee_biodata_delete_hr_admin on public.employee_biodata;
create policy employee_biodata_delete_hr_admin
  on public.employee_biodata for delete to authenticated
  using (public.is_hr_admin());

drop trigger if exists trg_employee_biodata_updated_at on public.employee_biodata;
create trigger trg_employee_biodata_updated_at
  before update on public.employee_biodata
  for each row execute function public.set_updated_at();

grant select, insert, update, delete on public.employee_biodata to authenticated;

-- Helper validations shared by both RPCs.
create or replace function public.create_employee_with_assignment(
  p_full_name text,
  p_employment_status text,
  p_start_date date,
  p_nik text,
  p_gender text,
  p_place_of_birth text,
  p_date_of_birth date,
  p_religion text,
  p_marital_status text,
  p_education_level text,
  p_address text,
  p_phone text,
  p_email text,
  p_emergency_contact_name text,
  p_emergency_contact_phone text,
  p_unit_id uuid,
  p_position_id uuid,
  p_assignment_title text,
  p_work_arrangement text
)
returns uuid
language plpgsql
set search_path = public, auth
as $$
declare
  v_employee_id uuid;
begin
  if auth.uid() is null or not public.is_hr_admin() then
    raise exception 'Hanya Sekjen atau Super Admin yang dapat membuat profil SDM.' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_full_name, '')), '') is null then raise exception 'Nama lengkap wajib diisi.' using errcode = '22023'; end if;
  if coalesce(p_nik, '') !~ '^[0-9]{16}$' then raise exception 'NIK harus tepat 16 digit angka.' using errcode = '22023'; end if;
  if p_gender not in ('L', 'P') then raise exception 'Jenis kelamin tidak valid.' using errcode = '22023'; end if;
  if nullif(trim(coalesce(p_place_of_birth, '')), '') is null or p_date_of_birth is null or p_date_of_birth > current_date then raise exception 'Tempat/tanggal lahir wajib valid.' using errcode = '22023'; end if;
  if p_marital_status not in ('belum_menikah', 'menikah', 'cerai_hidup', 'cerai_mati') then raise exception 'Status perkawinan tidak valid.' using errcode = '22023'; end if;
  if nullif(trim(coalesce(p_education_level, '')), '') is null or nullif(trim(coalesce(p_address, '')), '') is null or nullif(trim(coalesce(p_phone, '')), '') is null then raise exception 'Pendidikan, alamat, dan nomor HP wajib diisi.' using errcode = '22023'; end if;
  if p_employment_status not in ('active', 'inactive', 'on_leave') then raise exception 'Status kepegawaian tidak valid.' using errcode = '22023'; end if;
  if p_work_arrangement not in ('monthly', 'hourly', 'session', 'shift', 'other') then raise exception 'Pola kerja tidak valid.' using errcode = '22023'; end if;
  if not exists (select 1 from public.units u where u.id = p_unit_id and u.is_active and u.unit_type = 'operational') then raise exception 'Unit harus aktif dan merupakan unit operasional.' using errcode = '22023'; end if;
  if p_position_id is not null and not exists (select 1 from public.positions p where p.id = p_position_id and p.is_active) then raise exception 'Jabatan tidak aktif atau tidak ditemukan.' using errcode = '22023'; end if;

  insert into public.employees (full_name, employment_status, start_date)
  values (trim(p_full_name), p_employment_status, p_start_date)
  returning id into v_employee_id;

  insert into public.employee_biodata (
    employee_id, nik, gender, place_of_birth, date_of_birth, religion, marital_status,
    education_level, address, phone, email, emergency_contact_name, emergency_contact_phone
  ) values (
    v_employee_id, trim(p_nik), p_gender, trim(p_place_of_birth), p_date_of_birth,
    nullif(trim(coalesce(p_religion, '')), ''), p_marital_status, trim(p_education_level),
    trim(p_address), trim(p_phone), nullif(trim(coalesce(p_email, '')), ''),
    nullif(trim(coalesce(p_emergency_contact_name, '')), ''),
    nullif(trim(coalesce(p_emergency_contact_phone, '')), '')
  );

  insert into public.employee_assignments (
    employee_id, unit_id, position_id, assignment_title, status, start_date, work_arrangement
  ) values (
    v_employee_id, p_unit_id, p_position_id, nullif(trim(coalesce(p_assignment_title, '')), ''),
    'active', coalesce(p_start_date, current_date), p_work_arrangement
  );
  return v_employee_id;
end;
$$;

create or replace function public.update_employee_profile(
  p_employee_id uuid,
  p_full_name text,
  p_employment_status text,
  p_start_date date,
  p_nik text,
  p_gender text,
  p_place_of_birth text,
  p_date_of_birth date,
  p_religion text,
  p_marital_status text,
  p_education_level text,
  p_address text,
  p_phone text,
  p_email text,
  p_emergency_contact_name text,
  p_emergency_contact_phone text
)
returns void
language plpgsql
set search_path = public, auth
as $$
begin
  if auth.uid() is null or not public.is_hr_admin() then
    raise exception 'Hanya Sekjen atau Super Admin yang dapat mengubah biodata lengkap.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.employees e where e.id = p_employee_id) then raise exception 'Profil SDM tidak ditemukan.' using errcode = '22023'; end if;
  if nullif(trim(coalesce(p_full_name, '')), '') is null then raise exception 'Nama lengkap wajib diisi.' using errcode = '22023'; end if;
  if coalesce(p_nik, '') !~ '^[0-9]{16}$' then raise exception 'NIK harus tepat 16 digit angka.' using errcode = '22023'; end if;
  if p_gender not in ('L', 'P') then raise exception 'Jenis kelamin tidak valid.' using errcode = '22023'; end if;
  if nullif(trim(coalesce(p_place_of_birth, '')), '') is null or p_date_of_birth is null or p_date_of_birth > current_date then raise exception 'Tempat/tanggal lahir wajib valid.' using errcode = '22023'; end if;
  if p_marital_status not in ('belum_menikah', 'menikah', 'cerai_hidup', 'cerai_mati') then raise exception 'Status perkawinan tidak valid.' using errcode = '22023'; end if;
  if nullif(trim(coalesce(p_education_level, '')), '') is null or nullif(trim(coalesce(p_address, '')), '') is null or nullif(trim(coalesce(p_phone, '')), '') is null then raise exception 'Pendidikan, alamat, dan nomor HP wajib diisi.' using errcode = '22023'; end if;
  if p_employment_status not in ('active', 'inactive', 'on_leave') then raise exception 'Status kepegawaian tidak valid.' using errcode = '22023'; end if;

  update public.employees set
    full_name = trim(p_full_name), employment_status = p_employment_status,
    start_date = p_start_date, updated_at = now()
  where id = p_employee_id;

  insert into public.employee_biodata (
    employee_id, nik, gender, place_of_birth, date_of_birth, religion, marital_status,
    education_level, address, phone, email, emergency_contact_name, emergency_contact_phone
  ) values (
    p_employee_id, trim(p_nik), p_gender, trim(p_place_of_birth), p_date_of_birth,
    nullif(trim(coalesce(p_religion, '')), ''), p_marital_status, trim(p_education_level),
    trim(p_address), trim(p_phone), nullif(trim(coalesce(p_email, '')), ''),
    nullif(trim(coalesce(p_emergency_contact_name, '')), ''),
    nullif(trim(coalesce(p_emergency_contact_phone, '')), '')
  )
  on conflict (employee_id) do update set
    nik = excluded.nik, gender = excluded.gender, place_of_birth = excluded.place_of_birth,
    date_of_birth = excluded.date_of_birth, religion = excluded.religion,
    marital_status = excluded.marital_status, education_level = excluded.education_level,
    address = excluded.address, phone = excluded.phone, email = excluded.email,
    emergency_contact_name = excluded.emergency_contact_name,
    emergency_contact_phone = excluded.emergency_contact_phone, updated_at = now();
end;
$$;

revoke all on function public.create_employee_with_assignment(text,text,date,text,text,text,date,text,text,text,text,text,text,text,text,uuid,uuid,text,text) from public;
revoke all on function public.create_employee_with_assignment(text,text,date,text,text,text,date,text,text,text,text,text,text,text,text,uuid,uuid,text,text) from anon;
grant execute on function public.create_employee_with_assignment(text,text,date,text,text,text,date,text,text,text,text,text,text,text,text,uuid,uuid,text,text) to authenticated;
revoke all on function public.update_employee_profile(uuid,text,text,date,text,text,text,date,text,text,text,text,text,text,text,text) from public;
revoke all on function public.update_employee_profile(uuid,text,text,date,text,text,text,date,text,text,text,text,text,text,text,text) from anon;
grant execute on function public.update_employee_profile(uuid,text,text,date,text,text,text,date,text,text,text,text,text,text,text,text) to authenticated;

commit;
