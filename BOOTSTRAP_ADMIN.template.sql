-- TEMPLATE: isi email admin pertama di tempat yang ditandai sebelum menjalankan.
-- Jangan menyimpan password atau service-role key di file SQL.
-- Jalankan hanya setelah migrasi keamanan dan akun Auth admin dibuat.

insert into public.user_profiles (id, employee_id, display_name, is_active, must_change_password)
select id, null, 'Sekjen / Admin SDM', true, false
from auth.users
where lower(email) = lower('GANTI_DENGAN_EMAIL_ADMIN@example.com')
on conflict (id) do update
set display_name = excluded.display_name,
    is_active = true,
    must_change_password = false;

insert into public.user_roles (user_id, role)
select id, 'sekjen'
from auth.users
where lower(email) = lower('GANTI_DENGAN_EMAIL_ADMIN@example.com')
on conflict (user_id, role) do nothing;

select u.id, u.email, p.display_name, p.is_active, r.role
from auth.users u
left join public.user_profiles p on p.id = u.id
left join public.user_roles r on r.user_id = u.id
where lower(u.email) = lower('GANTI_DENGAN_EMAIL_ADMIN@example.com');
