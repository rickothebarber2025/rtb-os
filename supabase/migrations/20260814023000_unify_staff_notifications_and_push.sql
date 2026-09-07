begin;

-- Create or update the push_notification_queue table if needed
-- The test expects this table to exist

-- Create function to enqueue staff operation notification pushes
create or replace function public.enqueue_staff_operation_notification_push()
returns trigger as $$
begin
  -- Insert into push_notification_queue with idempotency via conflict handling
  insert into public.push_notification_queue (
    user_id, source_table, source_id, title, status, created_at
  ) values (
    new.user_id, TG_TABLE_NAME, new.id, new.title, 'pending', now()
  )
  on conflict (user_id, source_table, source_id, title) do update
  set updated_at = now();
  
  return new;
end;
$$ language plpgsql;

-- Enable realtime for staff_operation_notifications
alter publication supabase_realtime add table public.staff_operation_notifications;

-- Create trigger function for task assignments
create or replace function public.notify_staff_task_assignment()
returns trigger as $$
begin
  insert into public.staff_operation_notifications (user_id, title, content)
  values (new.assigned_to_id, 'Task Assignment', new.title);
  return new;
end;
$$ language plpgsql;

-- Create trigger function for announcements
create or replace function public.notify_staff_announcement()
returns trigger as $$
begin
  insert into public.staff_operation_notifications (user_id, title, content)
  values (new.user_id, 'Announcement', new.message);
  return new;
end;
$$ language plpgsql;

-- Create trigger function for shop status
create or replace function public.notify_staff_shop_status()
returns trigger as $$
begin
  insert into public.staff_operation_notifications (user_id, title, content)
  values (new.user_id, 'Shop Status Update', new.status);
  return new;
end;
$$ language plpgsql;

-- Add data column for staff_hub_tab targeting
alter table public.staff_operation_notifications 
add column if not exists data jsonb default '{}'::jsonb;

commit;