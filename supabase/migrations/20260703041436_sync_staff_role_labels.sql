-- Keep staff role labels aligned with the actual roles used by each RTB business.
-- Historical payroll snapshots are intentionally left unchanged.

update public.staff as s
set role = 'Hairstylist'
from public.business_units as b
where b.id = s.business_unit_id
  and b.name = 'RTB Lounge'
  and lower(trim(s.role)) in ('stylist', 'hair stylist', 'hairstylist');

update public.staff as s
set role = 'Barber'
from public.business_units as b
where b.id = s.business_unit_id
  and b.name = 'RTB Lounge'
  and lower(trim(s.role)) in ('barber', 'master barber', 'apprentice barber');

update public.staff as s
set role = 'Nail Tech'
from public.business_units as b
where b.id = s.business_unit_id
  and b.name = 'RTB Beauty Lounge'
  and lower(trim(s.role)) in ('nail tech', 'nail technician');

update public.staff as s
set role = 'Lash Tech'
from public.business_units as b
where b.id = s.business_unit_id
  and b.name = 'RTB Beauty Lounge'
  and lower(trim(s.role)) in ('lash tech', 'lash technician', 'lash / brow');

update public.app_settings
set value = jsonb_set(
  jsonb_set(
    coalesce(value, '{}'::jsonb),
    '{RTB Lounge,staff_roles}',
    '["Barber","Hairstylist"]'::jsonb,
    true
  ),
  '{RTB Beauty Lounge,staff_roles}',
  '["Nail Tech","Lash Tech"]'::jsonb,
  true
)
where key = 'business_profiles';
