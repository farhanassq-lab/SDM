-- RQ SDM Tahap 3: atomic creation of an employee profile and primary assignment.
-- Run this in Supabase SQL Editor after the initial schema and Madrasah migration.
-- This function does not implement payroll.

begin;

create or replace function public.create_employee_with_primary_assignment(
  p_employee_code text,
  p_full_name text,
  p_employment_status text,
  p_start_date date,
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

  if nullif(trim(coalesce(p_full_name, '')), '') is null then
    raise exception 'Nama lengkap wajib diisi.' using errcode = '22023';
  end if;

  if p_employment_status is null or p_employment_status not in ('active', 'inactive', 'on_leave') then
    raise exception 'Status kepegawaian tidak valid.' using errcode = '22023';
  end if;

  if p_work_arrangement is null or p_work_arrangement not in ('monthly', 'hourly', 'session', 'shift', 'other') then
    raise exception 'Pola kerja tidak valid.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.units u
    where u.id = p_unit_id and u.is_active = true and u.unit_type = 'operational'
  ) then
    raise exception 'Unit penugasan tidak aktif atau bukan unit operasional.' using errcode = '22023';
  end if;

  if p_position_id is not null and not exists (
    select 1 from public.positions p where p.id = p_position_id and p.is_active = true
  ) then
    raise exception 'Jabatan tidak aktif atau tidak ditemukan.' using errcode = '22023';
  end if;

  insert into public.employees (employee_code, full_name, employment_status, start_date)
  values (nullif(trim(coalesce(p_employee_code, '')), ''), trim(p_full_name), p_employment_status, p_start_date)
  returning id into v_employee_id;

  insert into public.employee_assignments (
    employee_id, unit_id, position_id, assignment_title, is_primary,
    status, start_date, work_arrangement
  ) values (
    v_employee_id, p_unit_id, p_position_id,
    nullif(trim(coalesce(p_assignment_title, '')), ''), true,
    'active', coalesce(p_start_date, current_date), p_work_arrangement
  );

  return v_employee_id;
end;
$$;

revoke all on function public.create_employee_with_primary_assignment(text, text, text, date, uuid, uuid, text, text) from public;
revoke all on function public.create_employee_with_primary_assignment(text, text, text, date, uuid, uuid, text, text) from anon;
grant execute on function public.create_employee_with_primary_assignment(text, text, text, date, uuid, uuid, text, text) to authenticated;

commit;
