-- RQ SDM Tahap 6: safe NIK existence check for an authorized unit.
-- Returns only true/false; never returns employee name, NIK match details, or other units.
-- Run after migration 05_employee_intake_workflow_migration.sql.

begin;

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
    raise exception 'Akun ini tidak memiliki izin mengajukan SDM untuk unit tersebut.' using errcode = '42501';
  end if;
  if v_nik !~ '^[0-9]{16}$' then
    raise exception 'NIK harus terdiri dari tepat 16 digit angka.' using errcode = '22023';
  end if;

  return exists (
    select 1 from public.employee_biodata b where b.nik = v_nik
  ) or exists (
    select 1 from public.employee_intake_cases c
    where c.nik = v_nik and c.status = 'pending'
  );
end;
$$;

revoke all on function public.employee_nik_exists_for_unit(uuid, text) from public, anon;
grant execute on function public.employee_nik_exists_for_unit(uuid, text) to authenticated;

commit;
