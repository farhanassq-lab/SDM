-- RQ SDM Tahap 15: absensi menjadi REKAP BULANAN per penugasan.
--
-- Absensi harian dikelola oleh sistem lain. RQ SDM hanya menerima ringkasan satu bulan
-- untuk setiap penugasan (hadir, terlambat, izin, sakit, cuti, alpa), sehingga petugas
-- cukup menginput sekali sebulan.
--
-- Aman dijalankan ulang. Tabel attendance_records, work_schedules, dan RPC jadwal lama
-- TIDAK dihapus atau diubah; riwayat lama tetap ada.
--
-- Sekaligus memperketat dua hal hasil audit:
--   1. Penilaian kinerja hanya terbaca oleh Sekjen/Super Admin, Pimpinan, dan Kepala Unit terkait.
--   2. created_by pada program aktivitas unit diisi server, bukan dari klien.
--
-- Prasyarat: 01_initial_schema_fresh_project.sql dan 13_unit_activity_monitoring.sql sudah dijalankan.

begin;

do $$
begin
  if to_regclass('public.employee_assignments') is null
     or to_regclass('public.audit_logs') is null then
    raise exception 'Skema dasar belum lengkap. Jalankan 01_initial_schema_fresh_project.sql terlebih dahulu.';
  end if;
  if to_regprocedure('public.can_manage_assignment(uuid)') is null
     or to_regprocedure('public.can_manage_attendance_assignment(uuid)') is null
     or to_regprocedure('public.can_manage_attendance_unit(uuid)') is null then
    raise exception 'Fungsi hak akses belum tersedia. Jalankan skema awal RQ SDM terlebih dahulu.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Tabel rekap bulanan
-- ---------------------------------------------------------------------------
create table if not exists public.attendance_monthly_summaries (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.employee_assignments(id) on delete restrict,
  period_month date not null check (extract(day from period_month) = 1),
  work_days smallint not null check (work_days between 0 and 31),
  present_days smallint not null default 0 check (present_days between 0 and 31),
  late_days smallint not null default 0 check (late_days between 0 and 31),
  late_minutes integer not null default 0 check (late_minutes between 0 and 99999),
  excused_days smallint not null default 0 check (excused_days between 0 and 31),
  sick_days smallint not null default 0 check (sick_days between 0 and 31),
  leave_days smallint not null default 0 check (leave_days between 0 and 31),
  alpha_days smallint not null default 0 check (alpha_days between 0 and 31),
  notes text check (notes is null or length(notes) <= 500),
  status text not null default 'draft' check (status in ('draft', 'final')),
  source text not null default 'manual' check (source in ('manual', 'import')),
  entered_by uuid references auth.users(id) on delete set null default auth.uid(),
  finalized_by uuid references auth.users(id) on delete set null,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, period_month),
  -- Hadir dan terlambat sama-sama dihitung hadir; jumlah semua status tidak boleh melebihi hari wajib.
  check (present_days + late_days + excused_days + sick_days + leave_days + alpha_days <= work_days),
  check (late_minutes = 0 or late_days > 0)
);

create index if not exists attendance_monthly_period_idx
  on public.attendance_monthly_summaries (period_month, assignment_id);

-- ---------------------------------------------------------------------------
-- 2. Penjaga: finalisasi hanya oleh Kepala Unit / Sekjen; rekap final terkunci.
-- ---------------------------------------------------------------------------
create or replace function public.guard_attendance_monthly()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if tg_op = 'INSERT' then
    new.entered_by := auth.uid();
    if new.status = 'final' then
      if not public.can_manage_assignment(new.assignment_id) then
        raise exception 'Hanya Sekjen atau Kepala Unit yang dapat memfinalkan rekap absensi.' using errcode = '42501';
      end if;
      new.finalized_by := auth.uid();
      new.finalized_at := now();
    end if;
    return new;
  end if;

  if new.assignment_id is distinct from old.assignment_id
     or new.period_month is distinct from old.period_month then
    raise exception 'Penugasan dan bulan rekap tidak dapat diubah.' using errcode = '22023';
  end if;

  if old.status = 'final' and not public.can_manage_assignment(new.assignment_id) then
    raise exception 'Rekap bulan ini sudah final. Minta Kepala Unit atau Sekjen membukanya kembali.' using errcode = '42501';
  end if;

  if new.status = 'final' and old.status <> 'final' then
    if not public.can_manage_assignment(new.assignment_id) then
      raise exception 'Hanya Sekjen atau Kepala Unit yang dapat memfinalkan rekap absensi.' using errcode = '42501';
    end if;
    new.finalized_by := auth.uid();
    new.finalized_at := now();
  elsif new.status = 'draft' and old.status = 'final' then
    new.finalized_by := null;
    new.finalized_at := null;
  end if;

  new.entered_by := coalesce(auth.uid(), old.entered_by);
  return new;
end;
$$;

drop trigger if exists trg_attendance_monthly_guard on public.attendance_monthly_summaries;
create trigger trg_attendance_monthly_guard
before insert or update on public.attendance_monthly_summaries
for each row execute function public.guard_attendance_monthly();

drop trigger if exists trg_attendance_monthly_updated_at on public.attendance_monthly_summaries;
create trigger trg_attendance_monthly_updated_at
before update on public.attendance_monthly_summaries
for each row execute function public.set_updated_at();

-- Jejak audit untuk setiap perubahan rekap.
create or replace function public.audit_attendance_monthly()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.audit_logs (actor_user_id, action, table_name, record_id, before_data, after_data)
  values (
    auth.uid(),
    'ATTENDANCE_MONTHLY_' || tg_op,
    'attendance_monthly_summaries',
    coalesce(new.id, old.id)::text,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_attendance_monthly_audit on public.attendance_monthly_summaries;
create trigger trg_attendance_monthly_audit
after insert or update or delete on public.attendance_monthly_summaries
for each row execute function public.audit_attendance_monthly();

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------
alter table public.attendance_monthly_summaries enable row level security;
revoke all on public.attendance_monthly_summaries from public, anon;
grant select, insert, update, delete on public.attendance_monthly_summaries to authenticated;

drop policy if exists attendance_monthly_read_scoped on public.attendance_monthly_summaries;
create policy attendance_monthly_read_scoped on public.attendance_monthly_summaries
  for select to authenticated using (public.can_access_assignment(assignment_id));

drop policy if exists attendance_monthly_insert_scoped on public.attendance_monthly_summaries;
create policy attendance_monthly_insert_scoped on public.attendance_monthly_summaries
  for insert to authenticated with check (public.can_manage_attendance_assignment(assignment_id));

drop policy if exists attendance_monthly_update_scoped on public.attendance_monthly_summaries;
create policy attendance_monthly_update_scoped on public.attendance_monthly_summaries
  for update to authenticated
  using (public.can_manage_attendance_assignment(assignment_id))
  with check (public.can_manage_attendance_assignment(assignment_id));

drop policy if exists attendance_monthly_delete_admin on public.attendance_monthly_summaries;
create policy attendance_monthly_delete_admin on public.attendance_monthly_summaries
  for delete to authenticated using (public.is_hr_admin());

-- ---------------------------------------------------------------------------
-- 4. Petunjuk pengisian dari pengajuan izin yang sudah disetujui (hanya bantuan, tidak otomatis).
--    Dihitung dalam hari kalender pada bulan terkait; petugas tetap menyesuaikan dengan hari kerja.
-- ---------------------------------------------------------------------------
create or replace function public.attendance_absence_hints(p_unit_id uuid, p_period date)
returns table (assignment_id uuid, sick_days integer, leave_days integer, excused_days integer)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_start date := date_trunc('month', p_period)::date;
  v_end date := (date_trunc('month', p_period) + interval '1 month - 1 day')::date;
begin
  if auth.uid() is null then
    raise exception 'Login diperlukan.' using errcode = '42501';
  end if;
  if not public.can_manage_attendance_unit(p_unit_id) then
    raise exception 'Akun ini tidak berwenang untuk unit tersebut.' using errcode = '42501';
  end if;

  return query
  select s.linked_assignment_id,
         coalesce(sum(s.n) filter (where s.request_type = 'sakit'), 0)::integer,
         coalesce(sum(s.n) filter (where s.request_type = 'cuti'), 0)::integer,
         coalesce(sum(s.n) filter (where s.request_type in ('tidak_hadir', 'izin', 'dinas_luar')), 0)::integer
  from (
    select a.linked_assignment_id, a.request_type,
           (least(a.end_date, v_end) - greatest(a.start_date, v_start) + 1) as n
    from public.absence_submissions a
    where a.unit_id = p_unit_id
      and a.status = 'approved'
      and a.linked_assignment_id is not null
      and a.request_type in ('sakit', 'cuti', 'tidak_hadir', 'izin', 'dinas_luar')
      and a.start_date <= v_end
      and a.end_date >= v_start
  ) s
  group by s.linked_assignment_id;
end;
$$;

revoke all on function public.attendance_absence_hints(uuid, date) from public, anon;
grant execute on function public.attendance_absence_hints(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Penilaian kinerja: baca hanya untuk Sekjen/Super Admin, Pimpinan, dan Kepala Unit terkait.
--    Petugas absensi dan operator SDM tidak lagi dapat membaca nilai.
-- ---------------------------------------------------------------------------
create or replace function public.can_access_review(_review_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from public.performance_reviews r
    where r.id = _review_id
      and (public.has_app_role('pimpinan') or public.can_manage_unit(r.unit_id))
  );
$$;

drop policy if exists reviews_read_scoped on public.performance_reviews;
create policy reviews_read_scoped on public.performance_reviews
  for select to authenticated
  using (public.has_app_role('pimpinan') or public.can_manage_unit(unit_id));

-- ---------------------------------------------------------------------------
-- 6. created_by program aktivitas diisi server (tidak dapat dipalsukan klien).
-- ---------------------------------------------------------------------------
create or replace function public.force_created_by()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.unit_activity_programs') is not null then
    drop trigger if exists trg_force_created_by on public.unit_activity_programs;
    create trigger trg_force_created_by before insert or update on public.unit_activity_programs
      for each row execute function public.force_created_by();
  end if;
  if to_regclass('public.unit_activity_updates') is not null then
    drop trigger if exists trg_force_created_by on public.unit_activity_updates;
    create trigger trg_force_created_by before insert or update on public.unit_activity_updates
      for each row execute function public.force_created_by();
  end if;
end $$;

commit;

select to_regclass('public.attendance_monthly_summaries') as monthly_table,
       to_regprocedure('public.attendance_absence_hints(uuid,date)') as hint_function;
