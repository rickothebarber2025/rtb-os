update public.user_profiles
set role = case permissions->>'role_template'
  when 'beauty_manager' then 'manager'
  when 'barbershop_manager' then 'manager'
  when 'full_admin' then 'admin'
  when 'owner' then 'admin'
  when 'operations_cleaning' then 'staff'
  when 'staff_portal' then 'staff'
  when 'payroll_assistant' then 'staff'
  when 'operations_assistant' then 'staff'
  when 'appointment_coordinator' then 'staff'
  when 'content_marketing' then 'staff'
  when 'view_only' then 'staff'
  else role
end,
updated_at = now()
where permissions->>'role_template' in (
  'beauty_manager','barbershop_manager','full_admin','operations_cleaning','staff_portal',
  'payroll_assistant','operations_assistant','appointment_coordinator','content_marketing','view_only'
)
and lower(coalesce(email,'')) <> 'rickothebarber@gmail.com';
