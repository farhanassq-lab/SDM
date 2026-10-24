-- RQ SDM Tahap 12: Form Izin / Ketidakhadiran tanpa akun SDM
-- Jalankan satu kali di Supabase SQL Editor setelah skema awal RQ SDM tersedia.
begin;

create table if not exists public.absence_submissions (
  id uuid primary key default gen_random_uuid(),
  request_code text not null unique default (
    'KTH-' || to_char(now(), 'YYYY') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
  ),
  submitter_name text not null check (length(trim(submitter_name)) between 2 and 120),
  phone text not null check (length(regexp_replace(phone, '[^0-9]', '', 'g')) between 8 and 15),
  unit_id uuid not null references public.units(id) on delete restrict,
  assignment_title text not null check (length(trim(assignment_title)) between 2 and 120),
  request_type text not null check (request_type in ('tidak_hadir', 'sakit', 'izin', 'cuti', 'terlambat', 'pulang_awal', 'dinas_luar')),
  start_date date not null,
  end_date date not null,
  shift_code text not null default 'REGULAR' check (length(trim(shift_code)) between 2 and 24),
  reason text not null check (length(trim(reason)) between 5 and 600),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  linked_assignment_id uuid references public.employee_assignments(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date),
  check (end_date <= start_date + 31)
);

create index if not exists absence_submissions_unit_status_created_idx
  on public.absence_submissions (unit_id, status, created_at desc);
create index if not exists absence_submissions_phone_idx
  on public.absence_submissions (phone, created_at desc);

alter table public.absence_submissions enable row level security;
revoke all on public.absence_submissions from public, anon;
revoke insert, update, delete on public.absence_submissions from authenticated;
grant select on public.absence_submissions to authenticated;
grant select, insert, update on public.absence_submissions to service_role;

drop policy if exists absence_submissions_read_unit_head_or_admin on public.absence_submissions;
create policy absence_submissions_read_unit_head_or_admin
on public.absence_submissions for select to authenticated
using (
  exists (select 1 from public.user_profiles up where up.id = auth.uid() and up.is_active)
  and (
    public.is_hr_admin()
    or exists (
    select 1 from public.user_unit_access a
    where a.user_id = auth.uid()
      and a.unit_id = absence_submissions.unit_id
      and a.access_role = 'kepala_unit'
    )
  )
);


-- Enable live inbox updates when the Supabase Realtime publication is available.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'absence_submissions'
     ) then
    execute 'alter publication supabase_realtime add table public.absence_submissions';
  end if;
end;
$$;

-- Store only a hash of the caller IP for coarse anti-spam rate limiting.
create table if not exists public.public_form_rate_limits (
  ip_hash text primary key,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now()
);
alter table public.public_form_rate_limits enable row level security;
revoke all on public.public_form_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.public_form_rate_limits to service_role;

create or replace function public.consume_absence_form_rate_limit(p_ip_hash text, p_now timestamptz default now())
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_ip_hash is null or length(p_ip_hash) < 32 then
    return false;
  end if;
  insert into public.public_form_rate_limits (ip_hash, window_started_at, request_count, updated_at)
  values (p_ip_hash, p_now, 1, p_now)
  on conflict (ip_hash) do update
    set window_started_at = case
          when public.public_form_rate_limits.window_started_at <= p_now - interval '1 hour' then p_now
          else public.public_form_rate_limits.window_started_at
        end,
        request_count = case
          when public.public_form_rate_limits.window_started_at <= p_now - interval '1 hour' then 1
          else public.public_form_rate_limits.request_count + 1
        end,
        updated_at = p_now
  returning request_count into v_count;
  return v_count <= 5;
end;
$$;
revoke all on function public.consume_absence_form_rate_limit(text, timestamptz) from public, anon, authenticated;
grant execute on function public.consume_absence_form_rate_limit(text, timestamptz) to service_role;

-- The review function validates unit authority, records an audit entry, and optionally writes
-- approved full-day absences into the roster only for scheduled shifts. Existing attendance is never overwritten.
create or replace function public.review_absence_submission(
  p_request_id uuid,
  p_decision text,
  p_linked_assignment_id uuid default null,
  p_review_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_request public.absence_submissions%rowtype;
  v_assignment public.employee_assignments%rowtype;
  v_attendance_status text;
  v_work_date date;
  v_inserted integer := 0;
  v_rows integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Login diperlukan untuk memproses pengajuan.';
  end if;
  if not exists (select 1 from public.user_profiles up where up.id = auth.uid() and up.is_active) then
    raise exception 'Akun tidak aktif atau belum memiliki profil. Hubungi Sekjen.';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Keputusan tidak valid.';
  end if;
  if p_review_note is not null and length(trim(p_review_note)) > 600 then
    raise exception 'Catatan keputusan maksimal 600 karakter.';
  end if;

  select * into v_request
  from public.absence_submissions
  where id = p_request_id
  for update;
  if not found then raise exception 'Pengajuan tidak ditemukan.'; end if;
  if not public.can_manage_unit(v_request.unit_id) then
    raise exception 'Akun ini tidak berwenang memproses pengajuan unit tersebut.';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'Pengajuan ini sudah diproses.';
  end if;

  if p_linked_assignment_id is not null then
    select * into v_assignment
    from public.employee_assignments ea
    where ea.id = p_linked_assignment_id
      and ea.unit_id = v_request.unit_id
      and ea.status = 'active'
      and ea.start_date <= v_request.end_date
      and (ea.end_date is null or ea.end_date >= v_request.start_date);
    if not found then
      raise exception 'Penugasan tidak aktif atau tidak sesuai dengan unit pengajuan.';
    end if;
  end if;

  update public.absence_submissions
  set status = p_decision,
      linked_assignment_id = coalesce(p_linked_assignment_id, linked_assignment_id),
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = nullif(trim(coalesce(p_review_note, '')), ''),
      updated_at = now()
  where id = p_request_id;

  if p_decision = 'approved'
     and p_linked_assignment_id is not null
     and v_request.request_type in ('tidak_hadir', 'sakit', 'izin', 'cuti', 'dinas_luar') then
    v_attendance_status := case
      when v_request.request_type = 'sakit' then 'sick'
      when v_request.request_type = 'cuti' then 'leave'
      else 'excused'
    end;

    for v_work_date in
      select generate_series(v_request.start_date, v_request.end_date, interval '1 day')::date
    loop
      if exists (
        select 1 from public.work_schedules ws
        where ws.assignment_id = p_linked_assignment_id
          and ws.weekday = extract(dow from v_work_date)::smallint
          and ws.shift_code = v_request.shift_code
          and ws.is_working_day = true
          and ws.effective_from <= v_work_date
          and (ws.effective_to is null or ws.effective_to >= v_work_date)
      ) then
        insert into public.attendance_records (
          assignment_id, work_date, shift_code, status, notes, source, entered_by
        ) values (
          p_linked_assignment_id, v_work_date, v_request.shift_code, v_attendance_status,
          'Dari pengajuan ' || v_request.request_code, 'manual', auth.uid()
        ) on conflict (assignment_id, work_date, shift_code) do nothing;
        get diagnostics v_rows = row_count;
        v_inserted := v_inserted + v_rows;
      end if;
    end loop;
  end if;

  insert into public.audit_logs (actor_user_id, action, table_name, record_id, before_data, after_data, created_at)
  values (
    auth.uid(),
    case when p_decision = 'approved' then 'approve_absence_submission' else 'reject_absence_submission' end,
    'absence_submissions',
    p_request_id::text,
    jsonb_build_object('status', v_request.status, 'request_code', v_request.request_code),
    jsonb_build_object('status', p_decision, 'request_code', v_request.request_code,
      'linked_assignment_id', p_linked_assignment_id, 'attendance_rows_created', v_inserted,
      'review_note', nullif(trim(p_review_note), '')),
    now()
  );

  return jsonb_build_object(
    'request_code', v_request.request_code,
    'status', p_decision,
    'attendance_rows_created', v_inserted,
    'attendance_note', case
      when p_decision = 'rejected' then 'Absensi tidak diubah karena pengajuan ditolak.'
      when p_linked_assignment_id is null then 'Keputusan tersimpan. Pilih penugasan di roster jika absensi perlu dicatat.'
      when v_request.request_type in ('terlambat', 'pulang_awal') then 'Keputusan tersimpan. Catatan keterlambatan/pulang awal tetap perlu dicatat sesuai waktu aktual.'
      when v_inserted = 0 then 'Keputusan tersimpan. Tidak ada baris absensi baru karena jadwal tidak cocok atau catatan sudah tersedia.'
      else 'Absensi tercatat pada jadwal aktif yang cocok; catatan yang sudah ada tidak ditimpa.'
    end
  );
end;
$$;
revoke all on function public.review_absence_submission(uuid, text, uuid, text) from public, anon;
grant execute on function public.review_absence_submission(uuid, text, uuid, text) to authenticated;

commit;
