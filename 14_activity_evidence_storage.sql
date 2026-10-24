-- RQ SDM Tahap 14: Bukti kegiatan di Supabase Storage (private)
-- Jalankan satu kali di SQL Editor proyek RQ SDM yang benar.
begin;

-- Pastikan bukti kegiatan tidak dapat diakses publik dan hanya file tertentu diizinkan.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'rq-activity-evidence',
  'rq-activity-evidence',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::text[]
)
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- File disimpan dengan pola: <unit_uuid>/<program_uuid>/<nama-file>
-- Kebijakan membaca memastikan pengguna punya akses melihat unit dan file terkait program yang benar.
drop policy if exists rq_activity_evidence_read_scoped on storage.objects;
create policy rq_activity_evidence_read_scoped
on storage.objects for select to authenticated
using (
  bucket_id = 'rq-activity-evidence'
  and public.can_view_unit_activity(((storage.foldername(name))[1])::uuid)
  and exists (
    select 1 from public.unit_activity_programs p
    where p.id = ((storage.foldername(name))[2])::uuid
      and p.unit_id = ((storage.foldername(name))[1])::uuid
  )
);

drop policy if exists rq_activity_evidence_insert_scoped on storage.objects;
create policy rq_activity_evidence_insert_scoped
on storage.objects for insert to authenticated
with check (
  bucket_id = 'rq-activity-evidence'
  and public.can_manage_unit_activity(((storage.foldername(name))[1])::uuid)
  and exists (
    select 1 from public.unit_activity_programs p
    where p.id = ((storage.foldername(name))[2])::uuid
      and p.unit_id = ((storage.foldername(name))[1])::uuid
  )
);

drop policy if exists rq_activity_evidence_delete_hr_admin on storage.objects;
create policy rq_activity_evidence_delete_hr_admin
on storage.objects for delete to authenticated
using (
  bucket_id = 'rq-activity-evidence'
  and (
    public.can_delete_unit_activity(((storage.foldername(name))[1])::uuid)
    or public.can_manage_unit_activity(((storage.foldername(name))[1])::uuid)
  )
  and exists (
    select 1 from public.unit_activity_programs p
    where p.id = ((storage.foldername(name))[2])::uuid
      and p.unit_id = ((storage.foldername(name))[1])::uuid
  )
);

-- Kolom ini sebelumnya hanya menerima URL eksternal. Sekarang menerima URL lama
-- atau path objek Storage privat untuk menjaga kompatibilitas data historis.
alter table public.unit_activity_updates
  drop constraint if exists unit_activity_updates_evidence_url_check;
alter table public.unit_activity_updates
  add constraint unit_activity_updates_evidence_url_check
  check (
    evidence_url is null
    or (
      length(evidence_url) <= 2048
      and (
        evidence_url ~* '^https?://'
        or evidence_url ~* '^[0-9a-f-]{36}/[0-9a-f-]{36}/[a-zA-Z0-9._-]{1,160}$'
      )
    )
  );

commit;
