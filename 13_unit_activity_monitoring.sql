-- RQ SDM Tahap 13: Monitoring Aktivitas Unit
-- Jalankan satu kali di Supabase SQL Editor pada proyek RQ SDM yang benar.
begin;

create table if not exists public.unit_activity_programs (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id) on delete restrict,
  title text not null check (length(trim(title)) between 3 and 180),
  category text not null default 'Program kerja' check (length(trim(category)) between 2 and 80),
  description text check (description is null or length(description) <= 2000),
  start_date date not null default current_date,
  target_date date,
  status text not null default 'planned' check (status in ('planned','in_progress','completed','blocked')),
  progress integer not null default 0 check (progress between 0 and 100),
  responsible_employee_id uuid references public.employees(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (target_date is null or target_date >= start_date),
  check (status <> 'completed' or progress = 100)
);

create table if not exists public.unit_activity_updates (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.unit_activity_programs(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete restrict,
  report_date date not null default current_date,
  summary text not null check (length(trim(summary)) between 5 and 2000),
  result text check (result is null or length(result) <= 2000),
  challenges text check (challenges is null or length(challenges) <= 1500),
  next_steps text check (next_steps is null or length(next_steps) <= 1500),
  evidence_url text check (evidence_url is null or (length(evidence_url) <= 2048 and evidence_url ~* '^https?://')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists unit_activity_programs_unit_created_idx on public.unit_activity_programs(unit_id, created_at desc);
create index if not exists unit_activity_programs_unit_status_idx on public.unit_activity_programs(unit_id, status, target_date);
create index if not exists unit_activity_updates_program_date_idx on public.unit_activity_updates(program_id, report_date desc);
create index if not exists unit_activity_updates_unit_date_idx on public.unit_activity_updates(unit_id, report_date desc);

create or replace function public.set_unit_activity_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists unit_activity_programs_updated_at on public.unit_activity_programs;
create trigger unit_activity_programs_updated_at before update on public.unit_activity_programs for each row execute function public.set_unit_activity_updated_at();

-- Helper functions avoid relying on client-side navigation for authorization.
create or replace function public.can_view_unit_activity(p_unit_id uuid)
returns boolean language sql stable security definer set search_path = public, auth as $$
  select auth.uid() is not null
    and exists (select 1 from public.user_profiles up where up.id = auth.uid() and up.is_active = true)
    and (
      exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role in ('super_admin','sekjen','pimpinan'))
      or exists (select 1 from public.user_unit_access ua where ua.user_id = auth.uid() and ua.unit_id = p_unit_id and ua.access_role in ('kepala_unit','operator_sdm','petugas_absensi'))
    );
$$;

create or replace function public.can_manage_unit_activity(p_unit_id uuid)
returns boolean language sql stable security definer set search_path = public, auth as $$
  select auth.uid() is not null
    and exists (select 1 from public.user_profiles up where up.id = auth.uid() and up.is_active = true)
    and (
      exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role in ('super_admin','sekjen'))
      or exists (select 1 from public.user_unit_access ua where ua.user_id = auth.uid() and ua.unit_id = p_unit_id and ua.access_role in ('kepala_unit','operator_sdm'))
    );
$$;

create or replace function public.can_delete_unit_activity(p_unit_id uuid)
returns boolean language sql stable security definer set search_path = public, auth as $$
  select auth.uid() is not null
    and exists (select 1 from public.user_profiles up where up.id = auth.uid() and up.is_active = true)
    and (
      exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role in ('super_admin','sekjen'))
    );
$$;

revoke all on function public.can_view_unit_activity(uuid) from public, anon;
revoke all on function public.can_manage_unit_activity(uuid) from public, anon;
revoke all on function public.can_delete_unit_activity(uuid) from public, anon;
grant execute on function public.can_view_unit_activity(uuid) to authenticated;
grant execute on function public.can_manage_unit_activity(uuid) to authenticated;
grant execute on function public.can_delete_unit_activity(uuid) to authenticated;

alter table public.unit_activity_programs enable row level security;
alter table public.unit_activity_updates enable row level security;
revoke all on public.unit_activity_programs from anon, public;
revoke all on public.unit_activity_updates from anon, public;
grant select, insert, update, delete on public.unit_activity_programs to authenticated;
grant select, insert, update, delete on public.unit_activity_updates to authenticated;

drop policy if exists unit_activity_programs_select on public.unit_activity_programs;
create policy unit_activity_programs_select on public.unit_activity_programs for select to authenticated using (public.can_view_unit_activity(unit_id));
drop policy if exists unit_activity_programs_insert on public.unit_activity_programs;
create policy unit_activity_programs_insert on public.unit_activity_programs for insert to authenticated with check (public.can_manage_unit_activity(unit_id) and (responsible_employee_id is null or exists (select 1 from public.employee_assignments ea where ea.employee_id = responsible_employee_id and ea.unit_id = unit_activity_programs.unit_id and ea.status = 'active')));
drop policy if exists unit_activity_programs_update on public.unit_activity_programs;
create policy unit_activity_programs_update on public.unit_activity_programs for update to authenticated using (public.can_manage_unit_activity(unit_id)) with check (public.can_manage_unit_activity(unit_id) and (responsible_employee_id is null or exists (select 1 from public.employee_assignments ea where ea.employee_id = responsible_employee_id and ea.unit_id = unit_activity_programs.unit_id and ea.status = 'active')));
drop policy if exists unit_activity_programs_delete on public.unit_activity_programs;
create policy unit_activity_programs_delete on public.unit_activity_programs for delete to authenticated using (public.can_delete_unit_activity(unit_id));

drop policy if exists unit_activity_updates_select on public.unit_activity_updates;
create policy unit_activity_updates_select on public.unit_activity_updates for select to authenticated using (public.can_view_unit_activity(unit_id));
drop policy if exists unit_activity_updates_insert on public.unit_activity_updates;
create policy unit_activity_updates_insert on public.unit_activity_updates for insert to authenticated with check (
  public.can_manage_unit_activity(unit_id)
  and exists (select 1 from public.unit_activity_programs p where p.id = program_id and p.unit_id = unit_activity_updates.unit_id)
);
drop policy if exists unit_activity_updates_update on public.unit_activity_updates;
create policy unit_activity_updates_update on public.unit_activity_updates for update to authenticated using (public.can_manage_unit_activity(unit_id)) with check (
  public.can_manage_unit_activity(unit_id)
  and exists (select 1 from public.unit_activity_programs p where p.id = program_id and p.unit_id = unit_activity_updates.unit_id)
);
drop policy if exists unit_activity_updates_delete on public.unit_activity_updates;
create policy unit_activity_updates_delete on public.unit_activity_updates for delete to authenticated using (public.can_delete_unit_activity(unit_id));

-- Record changes to program and progress history in the existing audit log.
create or replace function public.audit_unit_activity_change()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_id text;
  v_action text;
begin
  if tg_op = 'INSERT' then
    v_before := null;
    v_after := to_jsonb(new);
    v_id := new.id::text;
    v_action := 'insert_' || tg_table_name;
  elsif tg_op = 'UPDATE' then
    v_before := to_jsonb(old);
    v_after := to_jsonb(new);
    v_id := new.id::text;
    v_action := 'update_' || tg_table_name;
  else
    v_before := to_jsonb(old);
    v_after := null;
    v_id := old.id::text;
    v_action := 'delete_' || tg_table_name;
  end if;

  insert into public.audit_logs (actor_user_id, action, table_name, record_id, before_data, after_data, created_at)
  values (auth.uid(), v_action, tg_table_name, v_id, v_before, v_after, now());

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.audit_unit_activity_change() from public, anon, authenticated;

drop trigger if exists unit_activity_programs_audit on public.unit_activity_programs;
create trigger unit_activity_programs_audit after insert or update or delete on public.unit_activity_programs
for each row execute function public.audit_unit_activity_change();
drop trigger if exists unit_activity_updates_audit on public.unit_activity_updates;
create trigger unit_activity_updates_audit after insert or update or delete on public.unit_activity_updates
for each row execute function public.audit_unit_activity_change();

-- Keep program and update tables available to realtime if the publication exists.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'unit_activity_programs') then
      execute 'alter publication supabase_realtime add table public.unit_activity_programs';
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'unit_activity_updates') then
      execute 'alter publication supabase_realtime add table public.unit_activity_updates';
    end if;
  end if;
end $$;

commit;
