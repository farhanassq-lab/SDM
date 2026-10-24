-- RQ SDM migration: split Madrasah into Madrasah Aliyah and Madrasah Tsanawiyah.
-- Run this ONLY if you have already run RQ_SDM_supabase_initial.sql.
-- Safe to re-run. It does not move existing employee assignments automatically.

begin;

alter table public.units
  add column if not exists unit_type text not null default 'operational';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'units_unit_type_check'
      and conrelid = 'public.units'::regclass
  ) then
    alter table public.units
      add constraint units_unit_type_check
      check (unit_type in ('group', 'operational'));
  end if;
end $$;

-- These rows are organizational containers, not units for direct attendance entry.
update public.units
set name = 'Madrasah', unit_type = 'group', is_active = true, updated_at = now()
where code = 'MADRASAH';

update public.units
set unit_type = 'group', is_active = true, updated_at = now()
where code = 'BUD_RQ';

-- Ensure existing operational units are classified correctly.
update public.units
set unit_type = 'operational', updated_at = now()
where code in (
  'PENGASUHAN', 'TAHFIDZ', 'LPP', 'KEAMANAN', 'KEBERSIHAN',
  'KLINIK', 'PERPUSTAKAAN', 'DAPUR', 'BUD_RQ_MARKET', 'BUD_RQ_LAUNDRY'
);

-- Create the two operational Madrasah units under the Madrasah grouping row.
insert into public.units (code, name, parent_unit_id, unit_type, is_active)
select 'MADRASAH_ALIYAH', 'Madrasah Aliyah', id, 'operational', true
from public.units where code = 'MADRASAH'
on conflict (code) do update
set name = excluded.name,
    parent_unit_id = excluded.parent_unit_id,
    unit_type = excluded.unit_type,
    is_active = true,
    updated_at = now();

insert into public.units (code, name, parent_unit_id, unit_type, is_active)
select 'MADRASAH_TSANAWIYAH', 'Madrasah Tsanawiyah', id, 'operational', true
from public.units where code = 'MADRASAH'
on conflict (code) do update
set name = excluded.name,
    parent_unit_id = excluded.parent_unit_id,
    unit_type = excluded.unit_type,
    is_active = true,
    updated_at = now();

create index if not exists units_parent_unit_id_idx on public.units(parent_unit_id);
create index if not exists units_unit_type_active_idx on public.units(unit_type, is_active);

commit;

-- Verification: expect Madrasah and BUD_RQ to be groups; MA/MTS and Market/Laundry operational.
select u.code, u.name, u.unit_type, p.code as parent_code, u.is_active
from public.units u
left join public.units p on p.id = u.parent_unit_id
where u.code in (
  'MADRASAH', 'MADRASAH_ALIYAH', 'MADRASAH_TSANAWIYAH',
  'BUD_RQ', 'BUD_RQ_MARKET', 'BUD_RQ_LAUNDRY'
)
order by coalesce(p.name, u.name), u.name;

-- If this count is greater than zero, manually review and reassign those old records
-- to Madrasah Aliyah or Madrasah Tsanawiyah after confirming the correct school.
select count(*) as assignments_still_on_madrasah_group
from public.employee_assignments a
join public.units u on u.id = a.unit_id
where u.code = 'MADRASAH';
