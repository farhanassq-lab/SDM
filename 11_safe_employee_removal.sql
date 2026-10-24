-- RQ SDM — safe employee removal
-- Run this migration once in Supabase SQL Editor on the existing project.
-- Records with operational history are archived; only records without history are permanently removed.

begin;

create or replace function public.remove_employee_safely(p_employee_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_employee record;
  v_has_history boolean := false;
  v_assignment_count integer := 0;
  v_mode text;
begin
  if auth.uid() is null or not public.is_hr_admin() then
    raise exception 'Akses ditolak. Hanya Sekjen atau Super Admin yang dapat menghapus atau mengarsipkan SDM.'
      using errcode = '42501';
  end if;

  select e.id, e.full_name, e.employment_status, e.start_date, e.end_date
    into v_employee
  from public.employees e
  where e.id = p_employee_id
  for update;

  if not found then
    raise exception 'Data SDM tidak ditemukan.' using errcode = 'P0002';
  end if;

  select count(*)::integer
    into v_assignment_count
  from public.employee_assignments ea
  where ea.employee_id = p_employee_id;

  -- Preserve records referenced by other modules or linked to a login account.
  select
    exists (
      select 1 from public.user_profiles up
      where up.employee_id = p_employee_id
    )
    or exists (
      select 1 from public.leave_requests lr
      where lr.employee_id = p_employee_id
    )
    or exists (
      select 1
      from public.employee_assignments ea
      where ea.employee_id = p_employee_id
        and (
          exists (select 1 from public.work_schedules ws where ws.assignment_id = ea.id)
          or exists (select 1 from public.attendance_records ar where ar.assignment_id = ea.id)
          or exists (select 1 from public.activity_reports act where act.assignment_id = ea.id)
          or exists (select 1 from public.performance_reviews pr where pr.assignment_id = ea.id)
          or exists (select 1 from public.tasks t where t.assigned_assignment_id = ea.id)
          or exists (select 1 from public.work_programs wp where wp.owner_assignment_id = ea.id)
        )
    )
  into v_has_history;

  if v_has_history then
    update public.employee_assignments ea
    set status = 'inactive',
        end_date = greatest(coalesce(ea.end_date, current_date), ea.start_date),
        updated_at = now()
    where ea.employee_id = p_employee_id;

    update public.employees e
    set employment_status = 'inactive',
        end_date = greatest(coalesce(e.end_date, current_date), coalesce(e.start_date, current_date)),
        updated_at = now()
    where e.id = p_employee_id;

    v_mode := 'archived';

    insert into public.audit_logs (
      actor_user_id, action, table_name, record_id, before_data, after_data
    ) values (
      auth.uid(),
      'ARCHIVE_EMPLOYEE',
      'employees',
      p_employee_id::text,
      jsonb_build_object(
        'full_name', v_employee.full_name,
        'employment_status', v_employee.employment_status,
        'assignment_count', v_assignment_count
      ),
      jsonb_build_object(
        'employment_status', 'inactive',
        'reason', 'Historical records or linked account retained'
      )
    );

    return jsonb_build_object(
      'ok', true,
      'mode', v_mode,
      'message', format(
        'SDM %s memiliki riwayat atau akun terkait. Data telah diarsipkan dan riwayat tetap dipertahankan.',
        v_employee.full_name
      )
    );
  end if;

  -- No historical references exist, so removing assignments and the employee is safe.
  delete from public.employee_assignments
  where employee_id = p_employee_id;

  delete from public.employees
  where id = p_employee_id;

  insert into public.audit_logs (
    actor_user_id, action, table_name, record_id, before_data, after_data
  ) values (
    auth.uid(),
    'DELETE_EMPLOYEE',
    'employees',
    p_employee_id::text,
    jsonb_build_object(
      'full_name', v_employee.full_name,
      'employment_status', v_employee.employment_status,
      'assignment_count', v_assignment_count
    ),
    jsonb_build_object('deleted', true)
  );

  return jsonb_build_object(
    'ok', true,
    'mode', 'deleted',
    'message', format('Data SDM %s berhasil dihapus permanen karena belum memiliki riwayat terkait.', v_employee.full_name)
  );
end;
$$;

revoke all on function public.remove_employee_safely(uuid) from public, anon;
grant execute on function public.remove_employee_safely(uuid) to authenticated;


-- Prevent a Sekjen account from granting, changing, or removing Super Admin.
drop policy if exists user_roles_admin_insert on public.user_roles;
create policy user_roles_admin_insert
  on public.user_roles for insert to authenticated
  with check (
    public.is_hr_admin()
    and (role <> 'super_admin' or public.has_app_role('super_admin'))
  );

drop policy if exists user_roles_admin_update on public.user_roles;
create policy user_roles_admin_update
  on public.user_roles for update to authenticated
  using (
    public.is_hr_admin()
    and (role <> 'super_admin' or public.has_app_role('super_admin'))
  )
  with check (
    public.is_hr_admin()
    and (role <> 'super_admin' or public.has_app_role('super_admin'))
  );

drop policy if exists user_roles_admin_delete on public.user_roles;
create policy user_roles_admin_delete
  on public.user_roles for delete to authenticated
  using (
    public.is_hr_admin()
    and (role <> 'super_admin' or public.has_app_role('super_admin'))
  );

commit;
