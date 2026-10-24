-- RQ SDM - Initial Supabase schema
-- Run this in Supabase Dashboard > SQL Editor > New query.
-- Intended for a NEW project. No payroll tables are created.

begin;

-- 1. Core organization tables
create table if not exists public.units (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  parent_unit_id uuid references public.units(id) on delete restrict,
  unit_type text not null default 'operational' check (unit_type in ('group', 'operational')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.positions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  employee_code text unique,
  full_name text not null,
  employment_status text not null default 'active'
    check (employment_status in ('active', 'inactive', 'on_leave')),
  start_date date,
  end_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);

-- Contact details are stored separately so attendance clerks do not automatically see them.
create table if not exists public.employee_private_details (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  phone text,
  email text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A login account is created in Supabase Auth. This table links it to an employee.
create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  display_name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('super_admin', 'sekjen', 'kepala_unit', 'petugas_absensi', 'pimpinan')),
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

-- Unit-scoped access for heads and attendance clerks.
create table if not exists public.user_unit_access (
  user_id uuid not null references auth.users(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  access_role text not null check (access_role in ('kepala_unit', 'petugas_absensi')),
  created_at timestamptz not null default now(),
  primary key (user_id, unit_id, access_role)
);

-- One employee can have multiple assignments in different units/positions.
create table if not exists public.employee_assignments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete restrict,
  unit_id uuid not null references public.units(id) on delete restrict,
  position_id uuid references public.positions(id) on delete set null,
  assignment_title text,
  is_primary boolean not null default false,
  status text not null default 'active' check (status in ('active', 'inactive')),
  start_date date not null default current_date,
  end_date date,
  work_arrangement text not null default 'other'
    check (work_arrangement in ('monthly', 'hourly', 'session', 'shift', 'other')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);

create unique index if not exists employee_assignments_one_active_primary
  on public.employee_assignments(employee_id)
  where is_primary = true and status = 'active' and end_date is null;

-- 2. Schedules and attendance
-- weekday uses PostgreSQL convention: Sunday=0, Monday=1, ..., Saturday=6.
-- Keep old schedule rows; add a new row with a new effective_from when a schedule changes.
create table if not exists public.work_schedules (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.employee_assignments(id) on delete restrict,
  weekday smallint not null check (weekday between 0 and 6),
  shift_code text not null default 'REGULAR',
  is_working_day boolean not null default true,
  start_time time,
  end_time time,
  effective_from date not null,
  effective_to date,
  notes text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from),
  check (not is_working_day or (start_time is not null and end_time is not null))
);

create table if not exists public.attendance_import_batches (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  file_name text,
  status text not null default 'staging'
    check (status in ('staging', 'validated', 'imported', 'failed')),
  rows_seen integer not null default 0 check (rows_seen >= 0),
  rows_imported integer not null default 0 check (rows_imported >= 0),
  validation_summary jsonb not null default '{}'::jsonb,
  imported_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (period_end >= period_start)
);

-- One attendance row per assignment, work date, and shift.
create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.employee_assignments(id) on delete restrict,
  work_date date not null,
  shift_code text not null default 'REGULAR',
  status text not null check (status in ('present', 'late', 'sick', 'leave', 'excused', 'alpha', 'holiday')),
  check_in time,
  check_out time,
  late_minutes integer not null default 0 check (late_minutes >= 0),
  notes text,
  source text not null default 'manual' check (source in ('manual', 'import')),
  import_batch_id uuid references public.attendance_import_batches(id) on delete set null,
  entered_by uuid references auth.users(id) on delete set null default auth.uid(),
  verified_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, work_date, shift_code)
);

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete restrict,
  unit_id uuid not null references public.units(id) on delete restrict,
  assignment_id uuid references public.employee_assignments(id) on delete set null,
  leave_type text not null check (leave_type in ('cuti', 'sakit', 'izin', 'izin_pribadi', 'tanpa_upah', 'lainnya')),
  start_date date not null,
  end_date date not null,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by uuid references auth.users(id) on delete set null default auth.uid(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);

-- 3. Work programs, tasks, and activity reports
create table if not exists public.work_programs (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id) on delete restrict,
  title text not null,
  description text,
  start_date date,
  end_date date,
  owner_assignment_id uuid references public.employee_assignments(id) on delete set null,
  status text not null default 'planned' check (status in ('planned', 'active', 'completed', 'cancelled')),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id) on delete restrict,
  program_id uuid references public.work_programs(id) on delete set null,
  assigned_assignment_id uuid references public.employee_assignments(id) on delete set null,
  title text not null,
  description text,
  start_date date,
  due_date date,
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'pending_review', 'revision', 'completed', 'cancelled')),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_date is null or start_date is null or due_date >= start_date)
);

create table if not exists public.activity_reports (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id) on delete restrict,
  assignment_id uuid not null references public.employee_assignments(id) on delete restrict,
  task_id uuid references public.tasks(id) on delete set null,
  report_date date not null default current_date,
  summary text not null,
  blockers text,
  follow_up text,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'revision')),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 4. Performance evaluation
create table if not exists public.performance_indicators (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  scope text not null check (scope in ('global', 'unit', 'position')),
  unit_id uuid references public.units(id) on delete cascade,
  position_id uuid references public.positions(id) on delete cascade,
  weight numeric(5,2) not null default 0 check (weight >= 0 and weight <= 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (scope = 'global' and unit_id is null and position_id is null) or
    (scope = 'unit' and unit_id is not null and position_id is null) or
    (scope = 'position' and position_id is not null)
  )
);

create table if not exists public.performance_reviews (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete restrict,
  assignment_id uuid not null references public.employee_assignments(id) on delete restrict,
  unit_id uuid not null references public.units(id) on delete restrict,
  period_type text not null check (period_type in ('monthly', 'quarterly', 'semester', 'annual')),
  period_start date not null,
  period_end date not null,
  reviewer_user_id uuid not null references auth.users(id) on delete restrict default auth.uid(),
  status text not null default 'draft' check (status in ('draft', 'final')),
  overall_score numeric(3,2) check (overall_score is null or (overall_score >= 1 and overall_score <= 5)),
  comments text,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start),
  unique (assignment_id, period_type, period_start, period_end)
);

create table if not exists public.performance_review_scores (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.performance_reviews(id) on delete cascade,
  indicator_id uuid not null references public.performance_indicators(id) on delete restrict,
  score numeric(2,1) not null check (score >= 1 and score <= 5),
  comments text,
  evidence_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (review_id, indicator_id)
);

-- Audit log is read-only to app users. Write automation will be added in a later step.
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  table_name text not null,
  record_id text,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

-- 5. Seed the unit structure. Market and Laundry are children of BUD_RQ.
insert into public.units (code, name, unit_type) values
  ('PENGASUHAN', 'Pengasuhan', 'operational'),
  ('TAHFIDZ', 'Tahfidz', 'operational'),
  ('MADRASAH', 'Madrasah', 'group'),
  ('LPP', 'LPP', 'operational'),
  ('BUD_RQ', 'BUD_RQ', 'group'),
  ('KEAMANAN', 'Keamanan', 'operational'),
  ('KEBERSIHAN', 'Kebersihan', 'operational'),
  ('KLINIK', 'Klinik', 'operational'),
  ('PERPUSTAKAAN', 'Perpustakaan', 'operational'),
  ('DAPUR', 'Dapur', 'operational')
on conflict (code) do update set name = excluded.name, unit_type = excluded.unit_type, is_active = true, updated_at = now();

insert into public.units (code, name, parent_unit_id, unit_type)
select 'BUD_RQ_MARKET', 'Market', id, 'operational' from public.units where code = 'BUD_RQ'
on conflict (code) do update set name = excluded.name, parent_unit_id = excluded.parent_unit_id, unit_type = excluded.unit_type, is_active = true, updated_at = now();

insert into public.units (code, name, parent_unit_id, unit_type)
select 'BUD_RQ_LAUNDRY', 'Laundry', id, 'operational' from public.units where code = 'BUD_RQ'
on conflict (code) do update set name = excluded.name, parent_unit_id = excluded.parent_unit_id, unit_type = excluded.unit_type, is_active = true, updated_at = now();

insert into public.units (code, name, parent_unit_id, unit_type)
select 'MADRASAH_ALIYAH', 'Madrasah Aliyah', id, 'operational' from public.units where code = 'MADRASAH'
on conflict (code) do update set name = excluded.name, parent_unit_id = excluded.parent_unit_id, unit_type = excluded.unit_type, is_active = true, updated_at = now();

insert into public.units (code, name, parent_unit_id, unit_type)
select 'MADRASAH_TSANAWIYAH', 'Madrasah Tsanawiyah', id, 'operational' from public.units where code = 'MADRASAH'
on conflict (code) do update set name = excluded.name, parent_unit_id = excluded.parent_unit_id, unit_type = excluded.unit_type, is_active = true, updated_at = now();

insert into public.positions (code, name) values
  ('KEPALA_UNIT', 'Kepala Unit'),
  ('GURU', 'Guru'),
  ('USTAZ_TAHFIDZ', 'Ustaz Tahfidz'),
  ('MUSYRIF', 'Musyrif/Musyrifah'),
  ('PELATIH_EKSKUL', 'Pelatih Ekstrakurikuler'),
  ('PETUGAS_KEAMANAN', 'Petugas Keamanan'),
  ('CLEANING_SERVICE', 'Cleaning Service'),
  ('PETUGAS_KLINIK', 'Petugas Klinik'),
  ('PUSTAKAWAN', 'Petugas Perpustakaan'),
  ('PETUGAS_DAPUR', 'Petugas Dapur'),
  ('STAF_MARKET', 'Staf Market'),
  ('STAF_LAUNDRY', 'Staf Laundry')
on conflict (code) do update set name = excluded.name, is_active = true, updated_at = now();

-- 6. Helper functions used by Row Level Security (RLS).
create or replace function public.has_app_role(_role text)
returns boolean
language sql stable security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = _role
  );
$$;

create or replace function public.is_hr_admin()
returns boolean
language sql stable security definer
set search_path = public, auth
as $$
  select public.has_app_role('super_admin') or public.has_app_role('sekjen');
$$;

create or replace function public.can_view_unit(_unit_id uuid)
returns boolean
language sql stable security definer
set search_path = public, auth
as $$
  select
    public.has_app_role('super_admin')
    or public.has_app_role('sekjen')
    or public.has_app_role('pimpinan')
    or exists (
      select 1 from public.user_unit_access a
      where a.user_id = auth.uid() and a.unit_id = _unit_id
    );
$$;

create or replace function public.can_manage_unit(_unit_id uuid)
returns boolean
language sql stable security definer
set search_path = public, auth
as $$
  select
    public.is_hr_admin()
    or exists (
      select 1 from public.user_unit_access a
      where a.user_id = auth.uid()
        and a.unit_id = _unit_id
        and a.access_role = 'kepala_unit'
    );
$$;

create or replace function public.can_manage_attendance_unit(_unit_id uuid)
returns boolean
language sql stable security definer
set search_path = public, auth
as $$
  select
    public.is_hr_admin()
    or exists (
      select 1 from public.user_unit_access a
      where a.user_id = auth.uid()
        and a.unit_id = _unit_id
        and a.access_role in ('kepala_unit', 'petugas_absensi')
    );
$$;

create or replace function public.can_access_assignment(_assignment_id uuid)
returns boolean
language sql stable security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.employee_assignments ea
    where ea.id = _assignment_id
      and (
        public.can_view_unit(ea.unit_id)
        or exists (
          select 1 from public.user_profiles up
          where up.id = auth.uid() and up.employee_id = ea.employee_id
        )
      )
  );
$$;

create or replace function public.can_manage_employee(_employee_id uuid)
returns boolean
language sql stable security definer
set search_path = public, auth
as $$
  select public.is_hr_admin() or exists (
    select 1 from public.employee_assignments ea
    where ea.employee_id = _employee_id and public.can_manage_unit(ea.unit_id)
  );
$$;

create or replace function public.can_access_employee(_employee_id uuid)
returns boolean
language sql stable security definer
set search_path = public, auth
as $$
  select
    public.has_app_role('super_admin')
    or public.has_app_role('sekjen')
    or public.has_app_role('pimpinan')
    or exists (
      select 1 from public.user_profiles up
      where up.id = auth.uid() and up.employee_id = _employee_id
    )
    or exists (
      select 1 from public.employee_assignments ea
      where ea.employee_id = _employee_id and public.can_view_unit(ea.unit_id)
    );
$$;

create or replace function public.can_manage_assignment(_assignment_id uuid)
returns boolean
language sql stable security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from public.employee_assignments ea
    where ea.id = _assignment_id and public.can_manage_unit(ea.unit_id)
  );
$$;

create or replace function public.can_manage_attendance_assignment(_assignment_id uuid)
returns boolean
language sql stable security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from public.employee_assignments ea
    where ea.id = _assignment_id and public.can_manage_attendance_unit(ea.unit_id)
  );
$$;

create or replace function public.can_access_review(_review_id uuid)
returns boolean
language sql stable security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from public.performance_reviews r
    where r.id = _review_id and public.can_view_unit(r.unit_id)
  );
$$;

create or replace function public.can_manage_review(_review_id uuid)
returns boolean
language sql stable security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from public.performance_reviews r
    where r.id = _review_id and public.can_manage_unit(r.unit_id)
  );
$$;

create or replace function public.set_updated_at()
returns trigger language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Prevent an attendance clerk from approving/verifying their own import or attendance rows.
create or replace function public.guard_attendance_verification()
returns trigger language plpgsql security definer
set search_path = public, auth
as $$
begin
  if tg_op = 'INSERT' then
    if (new.verified_by is not null or new.verified_at is not null)
       and not public.can_manage_assignment(new.assignment_id) then
      raise exception 'Only a head of unit or HR admin can verify attendance.';
    end if;
  elsif (new.verified_by is distinct from old.verified_by or new.verified_at is distinct from old.verified_at)
       and not public.can_manage_assignment(new.assignment_id) then
    raise exception 'Only a head of unit or HR admin can change attendance verification.';
  end if;
  return new;
end;
$$;

-- Updated-at triggers
 drop trigger if exists trg_units_updated_at on public.units;
create trigger trg_units_updated_at before update on public.units for each row execute function public.set_updated_at();
drop trigger if exists trg_positions_updated_at on public.positions;
create trigger trg_positions_updated_at before update on public.positions for each row execute function public.set_updated_at();
drop trigger if exists trg_employees_updated_at on public.employees;
create trigger trg_employees_updated_at before update on public.employees for each row execute function public.set_updated_at();
drop trigger if exists trg_employee_private_details_updated_at on public.employee_private_details;
create trigger trg_employee_private_details_updated_at before update on public.employee_private_details for each row execute function public.set_updated_at();
drop trigger if exists trg_user_profiles_updated_at on public.user_profiles;
create trigger trg_user_profiles_updated_at before update on public.user_profiles for each row execute function public.set_updated_at();
drop trigger if exists trg_assignments_updated_at on public.employee_assignments;
create trigger trg_assignments_updated_at before update on public.employee_assignments for each row execute function public.set_updated_at();
drop trigger if exists trg_schedules_updated_at on public.work_schedules;
create trigger trg_schedules_updated_at before update on public.work_schedules for each row execute function public.set_updated_at();
drop trigger if exists trg_attendance_updated_at on public.attendance_records;
create trigger trg_attendance_updated_at before update on public.attendance_records for each row execute function public.set_updated_at();
drop trigger if exists trg_leave_requests_updated_at on public.leave_requests;
create trigger trg_leave_requests_updated_at before update on public.leave_requests for each row execute function public.set_updated_at();
drop trigger if exists trg_work_programs_updated_at on public.work_programs;
create trigger trg_work_programs_updated_at before update on public.work_programs for each row execute function public.set_updated_at();
drop trigger if exists trg_tasks_updated_at on public.tasks;
create trigger trg_tasks_updated_at before update on public.tasks for each row execute function public.set_updated_at();
drop trigger if exists trg_activity_reports_updated_at on public.activity_reports;
create trigger trg_activity_reports_updated_at before update on public.activity_reports for each row execute function public.set_updated_at();
drop trigger if exists trg_performance_indicators_updated_at on public.performance_indicators;
create trigger trg_performance_indicators_updated_at before update on public.performance_indicators for each row execute function public.set_updated_at();
drop trigger if exists trg_performance_reviews_updated_at on public.performance_reviews;
create trigger trg_performance_reviews_updated_at before update on public.performance_reviews for each row execute function public.set_updated_at();
drop trigger if exists trg_review_scores_updated_at on public.performance_review_scores;
create trigger trg_review_scores_updated_at before update on public.performance_review_scores for each row execute function public.set_updated_at();

drop trigger if exists trg_attendance_verification_guard on public.attendance_records;
create trigger trg_attendance_verification_guard before insert or update on public.attendance_records
for each row execute function public.guard_attendance_verification();

-- 7. Enable RLS on every table.
alter table public.units enable row level security;
alter table public.positions enable row level security;
alter table public.employees enable row level security;
alter table public.employee_private_details enable row level security;
alter table public.user_profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.user_unit_access enable row level security;
alter table public.employee_assignments enable row level security;
alter table public.work_schedules enable row level security;
alter table public.attendance_import_batches enable row level security;
alter table public.attendance_records enable row level security;
alter table public.leave_requests enable row level security;
alter table public.work_programs enable row level security;
alter table public.tasks enable row level security;
alter table public.activity_reports enable row level security;
alter table public.performance_indicators enable row level security;
alter table public.performance_reviews enable row level security;
alter table public.performance_review_scores enable row level security;
alter table public.audit_logs enable row level security;

-- 8. Policies. Drop first so this script can be re-run in a development project.
-- Units and positions: visible to authenticated users; configuration restricted to HR admins.
drop policy if exists units_read_authenticated on public.units;
create policy units_read_authenticated on public.units for select to authenticated using (true);
drop policy if exists units_admin_insert on public.units;
create policy units_admin_insert on public.units for insert to authenticated with check (public.is_hr_admin());
drop policy if exists units_admin_update on public.units;
create policy units_admin_update on public.units for update to authenticated using (public.is_hr_admin()) with check (public.is_hr_admin());
drop policy if exists units_admin_delete on public.units;
create policy units_admin_delete on public.units for delete to authenticated using (public.is_hr_admin());

drop policy if exists positions_read_authenticated on public.positions;
create policy positions_read_authenticated on public.positions for select to authenticated using (true);
drop policy if exists positions_admin_insert on public.positions;
create policy positions_admin_insert on public.positions for insert to authenticated with check (public.is_hr_admin());
drop policy if exists positions_admin_update on public.positions;
create policy positions_admin_update on public.positions for update to authenticated using (public.is_hr_admin()) with check (public.is_hr_admin());
drop policy if exists positions_admin_delete on public.positions;
create policy positions_admin_delete on public.positions for delete to authenticated using (public.is_hr_admin());

-- Employee roster is visible within authorized units. Private contact details are restricted to HR admins/unit heads.
drop policy if exists employees_read_scoped on public.employees;
create policy employees_read_scoped on public.employees for select to authenticated
using (public.can_access_employee(id));
drop policy if exists employees_admin_insert on public.employees;
create policy employees_admin_insert on public.employees for insert to authenticated with check (public.is_hr_admin());
drop policy if exists employees_admin_update on public.employees;
create policy employees_admin_update on public.employees for update to authenticated using (public.is_hr_admin()) with check (public.is_hr_admin());
drop policy if exists employees_admin_delete on public.employees;
create policy employees_admin_delete on public.employees for delete to authenticated using (public.is_hr_admin());

drop policy if exists employee_private_details_read_scoped on public.employee_private_details;
create policy employee_private_details_read_scoped on public.employee_private_details for select to authenticated using (public.can_manage_employee(employee_id));
drop policy if exists employee_private_details_insert_scoped on public.employee_private_details;
create policy employee_private_details_insert_scoped on public.employee_private_details for insert to authenticated with check (public.can_manage_employee(employee_id));
drop policy if exists employee_private_details_update_scoped on public.employee_private_details;
create policy employee_private_details_update_scoped on public.employee_private_details for update to authenticated using (public.can_manage_employee(employee_id)) with check (public.can_manage_employee(employee_id));
drop policy if exists employee_private_details_delete_admin on public.employee_private_details;
create policy employee_private_details_delete_admin on public.employee_private_details for delete to authenticated using (public.is_hr_admin());

drop policy if exists profiles_read_self_or_admin on public.user_profiles;
create policy profiles_read_self_or_admin on public.user_profiles for select to authenticated
using (id = auth.uid() or public.is_hr_admin());
drop policy if exists profiles_admin_insert on public.user_profiles;
create policy profiles_admin_insert on public.user_profiles for insert to authenticated with check (public.is_hr_admin());
drop policy if exists profiles_admin_update on public.user_profiles;
create policy profiles_admin_update on public.user_profiles for update to authenticated using (public.is_hr_admin()) with check (public.is_hr_admin());
drop policy if exists profiles_admin_delete on public.user_profiles;
create policy profiles_admin_delete on public.user_profiles for delete to authenticated using (public.is_hr_admin());

drop policy if exists user_roles_read_self_or_admin on public.user_roles;
create policy user_roles_read_self_or_admin on public.user_roles for select to authenticated
using (user_id = auth.uid() or public.is_hr_admin());
drop policy if exists user_roles_admin_insert on public.user_roles;
create policy user_roles_admin_insert on public.user_roles for insert to authenticated with check (public.is_hr_admin());
drop policy if exists user_roles_admin_update on public.user_roles;
create policy user_roles_admin_update on public.user_roles for update to authenticated using (public.is_hr_admin()) with check (public.is_hr_admin());
drop policy if exists user_roles_admin_delete on public.user_roles;
create policy user_roles_admin_delete on public.user_roles for delete to authenticated using (public.is_hr_admin());

drop policy if exists unit_access_read_self_or_admin on public.user_unit_access;
create policy unit_access_read_self_or_admin on public.user_unit_access for select to authenticated
using (user_id = auth.uid() or public.is_hr_admin());
drop policy if exists unit_access_admin_insert on public.user_unit_access;
create policy unit_access_admin_insert on public.user_unit_access for insert to authenticated with check (public.is_hr_admin());
drop policy if exists unit_access_admin_update on public.user_unit_access;
create policy unit_access_admin_update on public.user_unit_access for update to authenticated using (public.is_hr_admin()) with check (public.is_hr_admin());
drop policy if exists unit_access_admin_delete on public.user_unit_access;
create policy unit_access_admin_delete on public.user_unit_access for delete to authenticated using (public.is_hr_admin());

-- Assignments: unit heads can manage assignments within their own unit; only HR admins manage employee master data.
drop policy if exists assignments_read_scoped on public.employee_assignments;
create policy assignments_read_scoped on public.employee_assignments for select to authenticated using (public.can_access_assignment(id));
drop policy if exists assignments_insert_scoped on public.employee_assignments;
create policy assignments_insert_scoped on public.employee_assignments for insert to authenticated with check (public.can_manage_unit(unit_id));
drop policy if exists assignments_update_scoped on public.employee_assignments;
create policy assignments_update_scoped on public.employee_assignments for update to authenticated using (public.can_manage_unit(unit_id)) with check (public.can_manage_unit(unit_id));
drop policy if exists assignments_delete_scoped on public.employee_assignments;
create policy assignments_delete_scoped on public.employee_assignments for delete to authenticated using (public.is_hr_admin());

-- Schedules can be read by the relevant unit; only unit heads/HR admins change schedules.
drop policy if exists schedules_read_scoped on public.work_schedules;
create policy schedules_read_scoped on public.work_schedules for select to authenticated using (public.can_access_assignment(assignment_id));
drop policy if exists schedules_insert_scoped on public.work_schedules;
create policy schedules_insert_scoped on public.work_schedules for insert to authenticated with check (public.can_manage_assignment(assignment_id));
drop policy if exists schedules_update_scoped on public.work_schedules;
create policy schedules_update_scoped on public.work_schedules for update to authenticated using (public.can_manage_assignment(assignment_id)) with check (public.can_manage_assignment(assignment_id));
drop policy if exists schedules_delete_scoped on public.work_schedules;
create policy schedules_delete_scoped on public.work_schedules for delete to authenticated using (public.can_manage_assignment(assignment_id));

-- Attendance imports and records.
drop policy if exists attendance_batches_read_scoped on public.attendance_import_batches;
create policy attendance_batches_read_scoped on public.attendance_import_batches for select to authenticated using (public.can_view_unit(unit_id));
drop policy if exists attendance_batches_insert_scoped on public.attendance_import_batches;
create policy attendance_batches_insert_scoped on public.attendance_import_batches for insert to authenticated with check (public.can_manage_attendance_unit(unit_id));
drop policy if exists attendance_batches_update_scoped on public.attendance_import_batches;
create policy attendance_batches_update_scoped on public.attendance_import_batches for update to authenticated using (public.can_manage_attendance_unit(unit_id)) with check (public.can_manage_attendance_unit(unit_id));
drop policy if exists attendance_batches_delete_admin on public.attendance_import_batches;
create policy attendance_batches_delete_admin on public.attendance_import_batches for delete to authenticated using (public.is_hr_admin());

drop policy if exists attendance_read_scoped on public.attendance_records;
create policy attendance_read_scoped on public.attendance_records for select to authenticated using (public.can_access_assignment(assignment_id));
drop policy if exists attendance_insert_scoped on public.attendance_records;
create policy attendance_insert_scoped on public.attendance_records for insert to authenticated with check (public.can_manage_attendance_assignment(assignment_id));
drop policy if exists attendance_update_scoped on public.attendance_records;
create policy attendance_update_scoped on public.attendance_records for update to authenticated using (public.can_manage_attendance_assignment(assignment_id)) with check (public.can_manage_attendance_assignment(assignment_id));
drop policy if exists attendance_delete_admin on public.attendance_records;
create policy attendance_delete_admin on public.attendance_records for delete to authenticated using (public.is_hr_admin());

-- Leave requests are recorded/reviewed by authorized unit staff in this initial version.
drop policy if exists leave_requests_read_scoped on public.leave_requests;
create policy leave_requests_read_scoped on public.leave_requests for select to authenticated
using (public.can_view_unit(unit_id) or public.can_access_employee(employee_id));
drop policy if exists leave_requests_insert_scoped on public.leave_requests;
create policy leave_requests_insert_scoped on public.leave_requests for insert to authenticated with check (public.can_manage_unit(unit_id));
drop policy if exists leave_requests_update_scoped on public.leave_requests;
create policy leave_requests_update_scoped on public.leave_requests for update to authenticated using (public.can_manage_unit(unit_id)) with check (public.can_manage_unit(unit_id));
drop policy if exists leave_requests_delete_admin on public.leave_requests;
create policy leave_requests_delete_admin on public.leave_requests for delete to authenticated using (public.is_hr_admin());

-- Work programs, tasks, and activity reports.
drop policy if exists programs_read_scoped on public.work_programs;
create policy programs_read_scoped on public.work_programs for select to authenticated using (public.can_view_unit(unit_id));
drop policy if exists programs_insert_scoped on public.work_programs;
create policy programs_insert_scoped on public.work_programs for insert to authenticated with check (public.can_manage_unit(unit_id));
drop policy if exists programs_update_scoped on public.work_programs;
create policy programs_update_scoped on public.work_programs for update to authenticated using (public.can_manage_unit(unit_id)) with check (public.can_manage_unit(unit_id));
drop policy if exists programs_delete_admin on public.work_programs;
create policy programs_delete_admin on public.work_programs for delete to authenticated using (public.is_hr_admin());

drop policy if exists tasks_read_scoped on public.tasks;
create policy tasks_read_scoped on public.tasks for select to authenticated using (public.can_view_unit(unit_id));
drop policy if exists tasks_insert_scoped on public.tasks;
create policy tasks_insert_scoped on public.tasks for insert to authenticated with check (public.can_manage_unit(unit_id));
drop policy if exists tasks_update_scoped on public.tasks;
create policy tasks_update_scoped on public.tasks for update to authenticated using (public.can_manage_unit(unit_id)) with check (public.can_manage_unit(unit_id));
drop policy if exists tasks_delete_admin on public.tasks;
create policy tasks_delete_admin on public.tasks for delete to authenticated using (public.is_hr_admin());

drop policy if exists activity_reports_read_scoped on public.activity_reports;
create policy activity_reports_read_scoped on public.activity_reports for select to authenticated using (public.can_view_unit(unit_id));
drop policy if exists activity_reports_insert_scoped on public.activity_reports;
create policy activity_reports_insert_scoped on public.activity_reports for insert to authenticated with check (public.can_manage_unit(unit_id));
drop policy if exists activity_reports_update_scoped on public.activity_reports;
create policy activity_reports_update_scoped on public.activity_reports for update to authenticated using (public.can_manage_unit(unit_id)) with check (public.can_manage_unit(unit_id));
drop policy if exists activity_reports_delete_admin on public.activity_reports;
create policy activity_reports_delete_admin on public.activity_reports for delete to authenticated using (public.is_hr_admin());

-- Performance indicators and reviews.
drop policy if exists indicators_read_authenticated on public.performance_indicators;
create policy indicators_read_authenticated on public.performance_indicators for select to authenticated using (true);
drop policy if exists indicators_admin_insert on public.performance_indicators;
create policy indicators_admin_insert on public.performance_indicators for insert to authenticated with check (public.is_hr_admin());
drop policy if exists indicators_admin_update on public.performance_indicators;
create policy indicators_admin_update on public.performance_indicators for update to authenticated using (public.is_hr_admin()) with check (public.is_hr_admin());
drop policy if exists indicators_admin_delete on public.performance_indicators;
create policy indicators_admin_delete on public.performance_indicators for delete to authenticated using (public.is_hr_admin());

drop policy if exists reviews_read_scoped on public.performance_reviews;
create policy reviews_read_scoped on public.performance_reviews for select to authenticated using (public.can_view_unit(unit_id));
drop policy if exists reviews_insert_scoped on public.performance_reviews;
create policy reviews_insert_scoped on public.performance_reviews for insert to authenticated with check (public.can_manage_unit(unit_id));
drop policy if exists reviews_update_scoped on public.performance_reviews;
create policy reviews_update_scoped on public.performance_reviews for update to authenticated using (public.can_manage_unit(unit_id)) with check (public.can_manage_unit(unit_id));
drop policy if exists reviews_delete_admin on public.performance_reviews;
create policy reviews_delete_admin on public.performance_reviews for delete to authenticated using (public.is_hr_admin());

drop policy if exists review_scores_read_scoped on public.performance_review_scores;
create policy review_scores_read_scoped on public.performance_review_scores for select to authenticated using (public.can_access_review(review_id));
drop policy if exists review_scores_insert_scoped on public.performance_review_scores;
create policy review_scores_insert_scoped on public.performance_review_scores for insert to authenticated with check (public.can_manage_review(review_id));
drop policy if exists review_scores_update_scoped on public.performance_review_scores;
create policy review_scores_update_scoped on public.performance_review_scores for update to authenticated using (public.can_manage_review(review_id)) with check (public.can_manage_review(review_id));
drop policy if exists review_scores_delete_admin on public.performance_review_scores;
create policy review_scores_delete_admin on public.performance_review_scores for delete to authenticated using (public.is_hr_admin());

-- Audit logs are visible to HR admins only; clients cannot insert/update/delete them directly.
drop policy if exists audit_logs_read_admin on public.audit_logs;
create policy audit_logs_read_admin on public.audit_logs for select to authenticated using (public.is_hr_admin());

-- Restrict helper functions to authenticated users; RLS policies call these functions.
revoke all on function public.has_app_role(text) from public;
revoke all on function public.is_hr_admin() from public;
revoke all on function public.can_view_unit(uuid) from public;
revoke all on function public.can_manage_unit(uuid) from public;
revoke all on function public.can_manage_attendance_unit(uuid) from public;
revoke all on function public.can_access_assignment(uuid) from public;
revoke all on function public.can_access_employee(uuid) from public;
revoke all on function public.can_manage_employee(uuid) from public;
revoke all on function public.can_manage_assignment(uuid) from public;
revoke all on function public.can_manage_attendance_assignment(uuid) from public;
revoke all on function public.can_access_review(uuid) from public;
revoke all on function public.can_manage_review(uuid) from public;
grant execute on function public.has_app_role(text) to authenticated;
grant execute on function public.is_hr_admin() to authenticated;
grant execute on function public.can_view_unit(uuid) to authenticated;
grant execute on function public.can_manage_unit(uuid) to authenticated;
grant execute on function public.can_manage_attendance_unit(uuid) to authenticated;
grant execute on function public.can_access_assignment(uuid) to authenticated;
grant execute on function public.can_access_employee(uuid) to authenticated;
grant execute on function public.can_manage_employee(uuid) to authenticated;
grant execute on function public.can_manage_assignment(uuid) to authenticated;
grant execute on function public.can_manage_attendance_assignment(uuid) to authenticated;
grant execute on function public.can_access_review(uuid) to authenticated;
grant execute on function public.can_manage_review(uuid) to authenticated;

-- Explicit table grants. RLS still decides which rows each authenticated user can access.
grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.units, public.positions, public.employees, public.employee_private_details, public.user_profiles, public.user_roles,
  public.user_unit_access, public.employee_assignments, public.work_schedules,
  public.attendance_import_batches, public.attendance_records, public.leave_requests,
  public.work_programs, public.tasks, public.activity_reports, public.performance_indicators,
  public.performance_reviews, public.performance_review_scores
  to authenticated;
grant select on public.audit_logs to authenticated;

commit;

-- IMPORTANT NEXT STEP:
-- Create a user in Supabase Authentication, then assign the first admin role from SQL Editor.
-- Do not put a service_role/secret key in the frontend. The app should use the publishable/anon key with RLS.
