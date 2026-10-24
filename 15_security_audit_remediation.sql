-- RQ SDM Security Audit Remediation (2026-10-24)
-- Apply only after reviewing a backup and confirming the target project.
-- Does not delete existing HR records.
begin;

-- 1) Force first-login password changes server-side.
alter table public.user_profiles
  add column if not exists must_change_password boolean not null default false;
alter table public.user_profiles alter column is_active set default false;

update public.user_profiles up
set must_change_password = true
from auth.users u
where u.id = up.id
  and u.raw_user_meta_data->>'must_change_password' = 'true';

update public.user_profiles up
set is_active = false
where not exists (select 1 from public.user_roles ur where ur.user_id = up.id)
  and not exists (select 1 from public.user_unit_access ua where ua.user_id = up.id);

create or replace function public.is_app_user_active()
returns boolean
language sql stable security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1 from public.user_profiles up
    where up.id = auth.uid()
      and up.is_active = true
      and coalesce(up.must_change_password, false) = false
  );
$$;
revoke all on function public.is_app_user_active() from public, anon;
grant execute on function public.is_app_user_active() to authenticated;

-- Newly created Auth users get an inactive profile until the trusted admin-create-user function
-- explicitly assigns roles/access and activates it. Existing active flags are not overwritten.
create or replace function public.sync_auth_user_profile()
returns trigger
language plpgsql security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_display_name text;
  v_must_change boolean;
begin
  v_display_name := coalesce(
    nullif(trim(new.raw_user_meta_data->>'display_name'), ''),
    nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
    nullif(trim(new.raw_user_meta_data->>'name'), ''),
    nullif(split_part(coalesce(new.email, new.phone, ''), '@', 1), ''),
    'Pengguna ' || left(new.id::text, 8)
  );
  v_must_change := new.raw_user_meta_data->>'must_change_password' = 'true';

  insert into public.user_profiles (id, display_name, is_active, email, last_sign_in_at, must_change_password)
  values (new.id, v_display_name, false, new.email, new.last_sign_in_at, v_must_change)
  on conflict (id) do update
    set email = excluded.email,
        last_sign_in_at = excluded.last_sign_in_at,
        display_name = case
          when nullif(trim(public.user_profiles.display_name), '') is null then excluded.display_name
          else public.user_profiles.display_name
        end,
        must_change_password = case
          when new.raw_user_meta_data ? 'must_change_password' then v_must_change
          else public.user_profiles.must_change_password
        end,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_sync_auth_user_profile on auth.users;
create trigger trg_sync_auth_user_profile
after insert or update of email, raw_user_meta_data, last_sign_in_at on auth.users
for each row execute function public.sync_auth_user_profile();

-- 2) Protect Super Admin profiles from Sekjen-level profile UPDATE/DELETE.
create or replace function public.guard_super_admin_profile_mutation()
returns trigger
language plpgsql security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_target_id uuid;
begin
  v_target_id := old.id;
  if exists (select 1 from public.user_roles ur where ur.user_id = v_target_id and ur.role = 'super_admin')
     and auth.uid() is not null
     and not public.has_app_role('super_admin') then
    raise exception 'Profil Super Admin hanya dapat dikelola oleh Super Admin.' using errcode = '42501';
  end if;
  if tg_op = 'DELETE'
     and auth.uid() = old.id
     and exists (select 1 from public.user_roles ur where ur.user_id = old.id and ur.role = 'super_admin') then
    raise exception 'Super Admin tidak dapat menghapus profilnya sendiri.' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_super_admin_profile_mutation on public.user_profiles;
create trigger trg_guard_super_admin_profile_mutation
before update or delete on public.user_profiles
for each row execute function public.guard_super_admin_profile_mutation();

-- 3) Direct INSERT/UPDATE of employee_assignments is prohibited for unit users.
-- Existing scoped read remains; unit users must use validated SECURITY DEFINER RPCs.
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'employee_assignments'
  loop execute format('drop policy if exists %I on public.employee_assignments', p.policyname); end loop;
end $$;
alter table public.employee_assignments enable row level security;
create policy assignments_read_scoped on public.employee_assignments
  for select to authenticated using (public.can_access_assignment(id));
create policy assignments_insert_hr_admin_only on public.employee_assignments
  for insert to authenticated with check (public.is_hr_admin());
create policy assignments_update_hr_admin_only on public.employee_assignments
  for update to authenticated using (public.is_hr_admin()) with check (public.is_hr_admin());
create policy assignments_delete_hr_admin_only on public.employee_assignments
  for delete to authenticated using (public.is_hr_admin());

-- 4) Private access tokens replace public name-directory autocomplete for absence requests.
create table if not exists public.public_absence_access_tokens (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  token_hash text not null unique,
  created_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists public_absence_access_tokens_expiry_idx
  on public.public_absence_access_tokens (expires_at) where revoked_at is null;
alter table public.public_absence_access_tokens enable row level security;
revoke all on public.public_absence_access_tokens from public, anon, authenticated;
grant select, insert, update, delete on public.public_absence_access_tokens to service_role;

-- Rate-limit all public form actions with a configurable per-key limit and time window.
create or replace function public.consume_public_form_rate_limit(
  p_key_hash text,
  p_limit integer default 5,
  p_window_minutes integer default 60
)
returns boolean
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_count integer; v_now timestamptz := now();
begin
  if p_key_hash is null or length(p_key_hash) < 32 or length(p_key_hash) > 128
     or p_limit < 1 or p_limit > 1000 or p_window_minutes < 1 or p_window_minutes > 1440 then
    return false;
  end if;
  insert into public.public_form_rate_limits (ip_hash, window_started_at, request_count, updated_at)
  values (p_key_hash, v_now, 1, v_now)
  on conflict (ip_hash) do update set
    window_started_at = case
      when public.public_form_rate_limits.window_started_at <= v_now - make_interval(mins => p_window_minutes) then v_now
      else public.public_form_rate_limits.window_started_at end,
    request_count = case
      when public.public_form_rate_limits.window_started_at <= v_now - make_interval(mins => p_window_minutes) then 1
      else public.public_form_rate_limits.request_count + 1 end,
    updated_at = v_now
  returning request_count into v_count;
  return v_count <= p_limit;
end;
$$;
revoke all on function public.consume_public_form_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_public_form_rate_limit(text, integer, integer) to service_role;

create or replace function public.cleanup_public_form_rate_limits()
returns integer
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_deleted integer;
begin
  delete from public.public_form_rate_limits where updated_at < now() - interval '2 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
revoke all on function public.cleanup_public_form_rate_limits() from public, anon, authenticated;
grant execute on function public.cleanup_public_form_rate_limits() to service_role;

-- If pg_cron is already installed, schedule daily cleanup without requiring the extension.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      execute $cron$select cron.unschedule(jobid) from cron.job where jobname = 'rq_sdm_rate_limit_cleanup'$cron$;
    exception when others then null;
    end;
    begin
      execute $cron$select cron.schedule('rq_sdm_rate_limit_cleanup', '17 20 * * *', 'select public.cleanup_public_form_rate_limits();')$cron$;
    exception when others then null;
    end;
  end if;
end $$;

-- 5) Server-side actor stamping: never trust created_by / updated_by supplied by the browser.
create or replace function public.stamp_unit_activity_program_actor()
returns trigger
language plpgsql security definer
set search_path = public, auth, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.updated_by := auth.uid();
  elsif tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;
revoke all on function public.stamp_unit_activity_program_actor() from public, anon, authenticated;

create or replace function public.stamp_unit_activity_update_actor()
returns trigger
language plpgsql security definer
set search_path = public, auth, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  elsif tg_op = 'UPDATE' then
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;
revoke all on function public.stamp_unit_activity_update_actor() from public, anon, authenticated;

do $$
begin
  if to_regclass('public.unit_activity_programs') is not null then
    drop trigger if exists trg_stamp_unit_activity_program_actor on public.unit_activity_programs;
    create trigger trg_stamp_unit_activity_program_actor before insert or update on public.unit_activity_programs
      for each row execute function public.stamp_unit_activity_program_actor();
  end if;
  if to_regclass('public.unit_activity_updates') is not null then
    drop trigger if exists trg_stamp_unit_activity_update_actor on public.unit_activity_updates;
    create trigger trg_stamp_unit_activity_update_actor before insert or update on public.unit_activity_updates
      for each row execute function public.stamp_unit_activity_update_actor();
  end if;
end $$;

-- 6) The activity UI stores private Storage object paths, not public URLs. Allow only
-- valid Storage paths or trusted external URLs in the evidence field.
do $$
begin
  if to_regclass('public.unit_activity_updates') is not null then
    alter table public.unit_activity_updates drop constraint if exists unit_activity_updates_evidence_url_check;
    alter table public.unit_activity_updates add constraint unit_activity_updates_evidence_url_check
      check (evidence_url is null or (
        length(evidence_url) <= 2048 and (
          evidence_url ~* '^https?://' or
          evidence_url ~* '^[0-9a-f-]{36}/[0-9a-f-]{36}/[a-zA-Z0-9._-]{1,180}$'
        )
      ));
  end if;
end $$;

-- Restrict deletion of evidence files to HR admins. Program deletion must use the server function
-- admin-delete-activity-program so Storage files are removed before database rows cascade.
do $$
declare p record;
begin
  for p in select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and cmd in ('DELETE', 'ALL')
      and coalesce(qual, '') ilike '%rq-activity-evidence%'
  loop execute format('drop policy if exists %I on storage.objects', p.policyname); end loop;
end $$;
create policy rq_activity_evidence_delete_hr_admin
on storage.objects for delete to authenticated
using (bucket_id = 'rq-activity-evidence' and public.is_hr_admin());

commit;
