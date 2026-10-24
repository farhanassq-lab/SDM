-- Run only after creating the first admin user in Supabase Authentication.
-- Replace the email and display name below. Do not paste passwords or API keys here.

insert into public.user_profiles (id, employee_id, display_name, is_active)
select id, null, 'Sekjen / Admin SDM', true
from auth.users
where lower(email) = lower('GANTI_DENGAN_EMAIL_ADMIN@contoh.com')
on conflict (id) do update
set display_name = excluded.display_name,
    is_active = true;

insert into public.user_roles (user_id, role)
select id, 'sekjen'
from auth.users
where lower(email) = lower('GANTI_DENGAN_EMAIL_ADMIN@contoh.com')
on conflict (user_id, role) do nothing;

-- Confirm the account was found and the role was assigned.
select u.id, u.email, p.display_name, p.is_active, r.role
from auth.users u
left join public.user_profiles p on p.id = u.id
left join public.user_roles r on r.user_id = u.id
where lower(u.email) = lower('GANTI_DENGAN_EMAIL_ADMIN@contoh.com');
