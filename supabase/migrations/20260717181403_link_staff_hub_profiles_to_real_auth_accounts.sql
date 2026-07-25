begin;

-- Link the 4 unambiguous staff matches: real auth account confirmed by
-- the name they entered at their own signup, single clear candidate each.

update public.hub_staff_profiles
set auth_user_id = '67aef20a-7b49-4689-9b22-d209d087a15b', email = 'daniel.ndayishiruye@gmail.com'
where id = '48ff840e-1687-4b92-8f6b-99f4b3d07291'; -- Daniel

update public.hub_staff_profiles
set auth_user_id = '5141c15c-3bd3-4226-bec0-2852bfb053a5', email = 'darrylachybrou@gmail.com'
where id = 'e3bea0a6-7d84-4418-84fa-61e76cf57855'; -- Darryl

update public.hub_staff_profiles
set auth_user_id = '6b4d00f2-0ec4-4464-802e-eaa933d50169', email = 'wavyboy2457@gmail.com'
where id = '8dbaad4f-4981-4d3d-bbd3-bb73bd681fec'; -- Josh

update public.hub_staff_profiles
set auth_user_id = '027a75cd-9068-43fc-bf05-43c4cbdae9c3', email = 'stephbelle2024@gmail.com'
where id = 'ecda3827-a9bc-458b-b602-c9c487c56c15'; -- Steph

commit;;
