-- RQ SDM Tahap 6A: input langsung tanpa antrean persetujuan unit.
-- Jalankan pada database RQ SDM yang sudah memiliki skema awal, Tahap 4, Tahap 5, dan fungsi employee_nik_exists_for_unit.
-- Tabel antrean lama dipertahankan untuk menghindari penghapusan data, tetapi tidak dipakai oleh frontend baru.

begin;

do $$
begin
  if to_regclass('public.employees') is null
     or to_regclass('public.employee_biodata') is null
     or to_regclass('public.employee_assignments') is null
     or to_regclass('public.user_unit_access') is null
     or to_regclass('public.employee_intake_cases') is null
     or to_regclass('public.employee_assignment_requests') is null then
    raise exception 'Skema dasar atau tabel legacy Tahap 5 belum tersedia. Periksa migrasi sebelumnya sebelum melanjutkan.';
  end if;
  if to_regprocedure('public.can_submit_employee_request(uuid)') is null then
    raise exception 'Fungsi izin unit belum tersedia. Jalankan migrasi Tahap 5 terlebih dahulu.';
  end if;
end $$;

create or replace function public.employee_nik_exists_for_unit(
  p_unit_id uuid,
  p_nik text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_nik text := trim(coalesce(p_nik, ''));
begin
  if auth.uid() is null then
    raise exception 'Silakan login terlebih dahulu.' using errcode = '42501';
  end if;
  if not public.can_submit_employee_request(p_unit_id) then
    raise exception 'Akun ini tidak memiliki izin mengelola SDM untuk unit tersebut.' using errcode = '42501';
  end if;
  if v_nik !~ '^[0-9]{16}$' then
    raise exception 'NIK harus terdiri dari tepat 16 digit angka.' using errcode = '22023';
  end if;
  return exists (select 1 from public.employee_biodata b where b.nik = v_nik)
      or exists (select 1 from public.employee_intake_cases c where c.nik = v_nik and c.status = 'pending');
end;
$$;

revoke all on function public.employee_nik_exists_for_unit(uuid, text) from public, anon;
grant execute on function public.employee_nik_exists_for_unit(uuid, text) to authenticated;

create or replace function public.register_employee_assignment_direct(
  p_unit_id uuid,
  p_nik text,
  p_full_name text,
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
  p_position_id uuid,
  p_assignment_title text,
  p_work_arrangement text,
  p_start_date date,
  p_end_date date,
  p_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_nik text := trim(coalesce(p_nik, ''));
  v_employee_id uuid;
  v_assignment_id uuid;
  v_start_date date := coalesce(p_start_date, current_date);
  v_existing boolean := false;
  v_case public.employee_intake_cases%rowtype;
  v_has_case boolean := false;
  v_outcome text;
  v_message text;
begin
  if auth.uid() is null then
    raise exception 'Silakan login terlebih dahulu.' using errcode = '42501';
  end if;
  if not public.can_submit_employee_request(p_unit_id) then
    raise exception 'Akun ini tidak memiliki izin mengelola SDM untuk unit tersebut.' using errcode = '42501';
  end if;
  if v_nik !~ '^[0-9]{16}$' then
    raise exception 'NIK harus terdiri dari tepat 16 digit angka.' using errcode = '22023';
  end if;
  if nullif(trim(coalesce(p_assignment_title, '')), '') is null then
    raise exception 'Jabatan atau nama tugas wajib diisi.' using errcode = '22023';
  end if;
  if coalesce(p_work_arrangement, 'other') not in ('monthly', 'hourly', 'session', 'shift', 'other') then
    raise exception 'Pola kerja tidak valid.' using errcode = '22023';
  end if;
  if p_end_date is not null and p_end_date < v_start_date then
    raise exception 'Tanggal akhir tidak boleh sebelum tanggal mulai.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.units u
    where u.id = p_unit_id and u.is_active = true and u.unit_type = 'operational'
  ) then
    raise exception 'Pilih unit operasional yang aktif.' using errcode = '22023';
  end if;
  if p_position_id is not null and not exists (
    select 1 from public.positions p where p.id = p_position_id and p.is_active = true
  ) then
    raise exception 'Jabatan tidak aktif atau tidak ditemukan.' using errcode = '22023';
  end if;

  -- Serialisasi berdasarkan NIK mencegah dua unit membuat profil bersamaan.
  perform pg_advisory_xact_lock(hashtextextended(v_nik, 0));

  select b.employee_id into v_employee_id
  from public.employee_biodata b
  where b.nik = v_nik
  limit 1
  for update;

  if v_employee_id is not null then
    v_existing := true;
    -- Bereskan kasus antrean lama yang mungkin menyimpan NIK yang sama.
    update public.employee_assignment_requests
       set status = 'cancelled', review_message = 'Dialihkan ke pencatatan langsung; input ulang tidak diperlukan.', updated_at = now()
     where intake_case_id in (select c.id from public.employee_intake_cases c where c.nik = v_nik and c.status = 'pending')
       and status = 'pending';
    update public.employee_intake_cases
       set status = 'rejected', nik = null, reviewed_by = auth.uid(), reviewed_at = now(),
           internal_review_note = 'Profil SDM dengan NIK ini sudah tersedia; kasus antrean lama ditutup.', updated_at = now()
     where nik = v_nik and status = 'pending';
  else
    -- Migrasikan kasus pending lama langsung ke profil induk, tanpa meminta pengajuan ulang.
    select c.* into v_case
    from public.employee_intake_cases c
    where c.nik = v_nik and c.status = 'pending'
    limit 1
    for update;
    v_has_case := found;

    if v_has_case then
      insert into public.employees(full_name, employment_status, start_date)
      values (v_case.full_name, 'active', v_start_date)
      returning id into v_employee_id;

      insert into public.employee_biodata (
        employee_id, nik, gender, place_of_birth, date_of_birth, religion,
        marital_status, education_level, address, phone, email,
        emergency_contact_name, emergency_contact_phone
      ) values (
        v_employee_id, v_nik, v_case.gender, v_case.place_of_birth, v_case.date_of_birth,
        v_case.religion, v_case.marital_status, v_case.education_level, v_case.address,
        v_case.phone, v_case.email, v_case.emergency_contact_name, v_case.emergency_contact_phone
      );

      update public.employee_assignment_requests
         set status = 'cancelled', review_message = 'Dialihkan ke pencatatan langsung; penugasan harus dicatat ulang jika belum aktif.', updated_at = now()
       where intake_case_id = v_case.id and status = 'pending';
      update public.employee_intake_cases
         set status = 'approved', approved_employee_id = v_employee_id, nik = null,
             reviewed_by = auth.uid(), reviewed_at = now(),
             internal_review_note = 'Profil dibuat melalui alur pencatatan langsung.', updated_at = now()
       where id = v_case.id;
      v_outcome := 'legacy_case_converted';
    else
      if nullif(trim(coalesce(p_full_name, '')), '') is null
        or p_gender is null or p_gender not in ('L', 'P')
        or nullif(trim(coalesce(p_place_of_birth, '')), '') is null
        or p_date_of_birth is null or p_date_of_birth > current_date
        or p_marital_status is null or p_marital_status not in ('belum_menikah', 'menikah', 'cerai_hidup', 'cerai_mati')
        or nullif(trim(coalesce(p_education_level, '')), '') is null
        or nullif(trim(coalesce(p_address, '')), '') is null
        or nullif(trim(coalesce(p_phone, '')), '') is null then
        raise exception 'NIK belum terdaftar. Lengkapi seluruh biodata wajib untuk membuat profil baru.' using errcode = '22023';
      end if;

      insert into public.employees(full_name, employment_status, start_date)
      values (trim(p_full_name), 'active', v_start_date)
      returning id into v_employee_id;

      insert into public.employee_biodata (
        employee_id, nik, gender, place_of_birth, date_of_birth, religion,
        marital_status, education_level, address, phone, email,
        emergency_contact_name, emergency_contact_phone
      ) values (
        v_employee_id, v_nik, p_gender, trim(p_place_of_birth), p_date_of_birth,
        nullif(trim(coalesce(p_religion, '')), ''), p_marital_status,
        trim(p_education_level), trim(p_address), trim(p_phone),
        nullif(trim(coalesce(p_email, '')), ''),
        nullif(trim(coalesce(p_emergency_contact_name, '')), ''),
        nullif(trim(coalesce(p_emergency_contact_phone, '')), '')
      );
      v_outcome := 'new_person';
    end if;
  end if;

  if exists (
    select 1 from public.employee_assignments a
    where a.employee_id = v_employee_id
      and a.unit_id = p_unit_id
      and a.status = 'active'
      and (a.end_date is null or a.end_date >= current_date)
      and a.position_id is not distinct from p_position_id
      and lower(trim(coalesce(a.assignment_title, ''))) = lower(trim(p_assignment_title))
  ) then
    raise exception 'Penugasan dengan unit dan jabatan yang sama sudah aktif.' using errcode = '23505';
  end if;

  insert into public.employee_assignments (
    employee_id, unit_id, position_id, assignment_title, status,
    start_date, end_date, work_arrangement, notes
  ) values (
    v_employee_id, p_unit_id, p_position_id, trim(p_assignment_title), 'active',
    v_start_date, p_end_date, coalesce(p_work_arrangement, 'other'),
    nullif(trim(coalesce(p_notes, '')), '')
  ) returning id into v_assignment_id;

  if v_outcome is null then
    v_outcome := case when v_existing then 'existing_person' else 'new_person' end;
  end if;
  v_message := case
    when v_existing then 'Penugasan berhasil disimpan ke profil SDM yang sudah ada. Tidak dibuat biodata ganda.'
    when v_outcome = 'legacy_case_converted' then 'Data antrean lama dikonversi dan penugasan berhasil disimpan langsung.'
    else 'Profil SDM dan penugasan baru berhasil disimpan langsung.'
  end;

  if to_regclass('public.audit_logs') is not null then
    insert into public.audit_logs(actor_user_id, action, table_name, record_id, after_data)
    values (auth.uid(), 'DIRECT_REGISTER_SDM_ASSIGNMENT', 'employee_assignments', v_assignment_id::text,
      jsonb_build_object('unit_id', p_unit_id, 'employee_id', v_employee_id, 'outcome', v_outcome));
  end if;

  return jsonb_build_object('outcome', v_outcome, 'message', v_message);
end;
$$;

revoke all on function public.register_employee_assignment_direct(uuid,text,text,text,text,date,text,text,text,text,text,text,text,text,uuid,text,text,date,date,text) from public, anon;
grant execute on function public.register_employee_assignment_direct(uuid,text,text,text,text,date,text,text,text,text,text,text,text,text,uuid,text,text,date,date,text) to authenticated;

-- Nonaktifkan fungsi antrean lama. Tabel lama dipertahankan, tidak dihapus.
revoke all on function public.submit_employee_assignment_request(uuid,text,text,text,text,date,text,text,text,text,text,text,text,text,uuid,text,text,date,date,text) from public, anon, authenticated;
revoke all on function public.review_employee_assignment_request(uuid,text,text) from public, anon, authenticated;
revoke all on table public.employee_intake_cases, public.employee_assignment_requests from public, anon, authenticated;

commit;

-- Verifikasi: fungsi input langsung tersedia.
select to_regprocedure('public.register_employee_assignment_direct(uuid,text,text,text,text,date,text,text,text,text,text,text,text,text,uuid,text,text,date,date,text)') as direct_save_function;
