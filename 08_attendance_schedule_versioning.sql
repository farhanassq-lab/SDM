-- RQ SDM Tahap 7: versioned schedule writes.
-- Requires existing tables: employee_assignments, work_schedules, attendance_records,
-- attendance_import_batches and helper function public.can_manage_assignment(uuid).
-- This migration does not delete or rewrite existing attendance records.

begin;

do $$
begin
  if to_regclass('public.employee_assignments') is null
     or to_regclass('public.work_schedules') is null
     or to_regclass('public.attendance_records') is null
     or to_regclass('public.attendance_import_batches') is null then
    raise exception 'Skema absensi belum lengkap. Pastikan tabel employee_assignments, work_schedules, attendance_records, dan attendance_import_batches sudah tersedia.';
  end if;
  if to_regprocedure('public.can_manage_assignment(uuid)') is null then
    raise exception 'Fungsi public.can_manage_assignment(uuid) belum tersedia. Jalankan skema awal RQ SDM terlebih dahulu.';
  end if;
end $$;

create or replace function public.save_assignment_schedule_version(
  p_assignment_id uuid,
  p_weekday smallint,
  p_shift_code text,
  p_is_working_day boolean,
  p_start_time time,
  p_end_time time,
  p_effective_from date,
  p_effective_to date default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_id uuid;
  v_next_start date;
  v_final_end date;
  v_shift text;
begin
  if auth.uid() is null then
    raise exception 'Login diperlukan.' using errcode = '42501';
  end if;
  if not public.can_manage_assignment(p_assignment_id) then
    raise exception 'Hanya Sekjen atau Kepala Unit terkait yang dapat mengubah jadwal.' using errcode = '42501';
  end if;
  if p_weekday is null or p_weekday < 0 or p_weekday > 6 then
    raise exception 'Hari harus bernilai 0 sampai 6 (Minggu sampai Sabtu).' using errcode = '22023';
  end if;
  v_shift := upper(trim(coalesce(p_shift_code, '')));
  if v_shift = '' then
    raise exception 'Kode shift wajib diisi.' using errcode = '22023';
  end if;
  if p_effective_from is null or (p_effective_to is not null and p_effective_to < p_effective_from) then
    raise exception 'Rentang tanggal jadwal tidak valid.' using errcode = '22023';
  end if;
  if coalesce(p_is_working_day, true) and (p_start_time is null or p_end_time is null or p_start_time = p_end_time) then
    raise exception 'Jadwal kerja harus memiliki jam mulai dan selesai yang berbeda.' using errcode = '22023';
  end if;

  -- Lock the assignment row so two schedule edits for the same assignment do not race.
  perform 1 from public.employee_assignments where id = p_assignment_id for update;
  if not found then
    raise exception 'Penugasan tidak ditemukan.' using errcode = '22023';
  end if;

  -- A later schedule version defines the upper bound of this version.
  select min(s.effective_from) into v_next_start
  from public.work_schedules s
  where s.assignment_id = p_assignment_id
    and s.weekday = p_weekday
    and upper(s.shift_code) = v_shift
    and s.effective_from > p_effective_from;

  v_final_end := p_effective_to;
  if v_next_start is not null and (v_final_end is null or v_final_end >= v_next_start) then
    v_final_end := v_next_start - 1;
  end if;
  if v_final_end is not null and v_final_end < p_effective_from then
    raise exception 'Jadwal bertabrakan dengan versi berikutnya. Periksa tanggal berlaku.' using errcode = '22023';
  end if;

  -- Close any earlier version that overlaps this new effective date.
  update public.work_schedules
  set effective_to = p_effective_from - 1,
      updated_at = now()
  where assignment_id = p_assignment_id
    and weekday = p_weekday
    and upper(shift_code) = v_shift
    and effective_from < p_effective_from
    and (effective_to is null or effective_to >= p_effective_from);

  -- If the exact effective date already exists, update it rather than duplicate it.
  select s.id into v_id
  from public.work_schedules s
  where s.assignment_id = p_assignment_id
    and s.weekday = p_weekday
    and upper(s.shift_code) = v_shift
    and s.effective_from = p_effective_from
  order by s.created_at desc
  limit 1
  for update;

  if v_id is not null then
    update public.work_schedules
    set is_working_day = coalesce(p_is_working_day, true),
        start_time = p_start_time,
        end_time = p_end_time,
        effective_to = v_final_end,
        notes = nullif(trim(coalesce(p_notes, '')), ''),
        updated_at = now()
    where id = v_id;
  else
    insert into public.work_schedules (
      assignment_id, weekday, shift_code, is_working_day, start_time, end_time,
      effective_from, effective_to, notes, created_by
    ) values (
      p_assignment_id, p_weekday, v_shift, coalesce(p_is_working_day, true),
      p_start_time, p_end_time, p_effective_from, v_final_end,
      nullif(trim(coalesce(p_notes, '')), ''), auth.uid()
    ) returning id into v_id;
  end if;

  if to_regclass('public.audit_logs') is not null then
    insert into public.audit_logs(actor_user_id, action, table_name, record_id, after_data)
    values (auth.uid(), 'SAVE_ASSIGNMENT_SCHEDULE_VERSION', 'work_schedules', v_id::text,
      jsonb_build_object('assignment_id', p_assignment_id, 'weekday', p_weekday,
        'shift_code', v_shift, 'effective_from', p_effective_from, 'effective_to', v_final_end));
  end if;
  return v_id;
end;
$$;

revoke all on function public.save_assignment_schedule_version(uuid, smallint, text, boolean, time, time, date, date, text) from public, anon;
grant execute on function public.save_assignment_schedule_version(uuid, smallint, text, boolean, time, time, date, date, text) to authenticated;

commit;

select to_regprocedure('public.save_assignment_schedule_version(uuid,smallint,text,boolean,time,time,date,date,text)') as schedule_version_function;
