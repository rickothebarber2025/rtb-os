-- Keep staff task constraints aligned with the categories/statuses emitted by RTB safe automations.
alter table public.staff_tasks drop constraint if exists staff_tasks_category_check;
alter table public.staff_tasks add constraint staff_tasks_category_check
  check (category = any (array[
    'cleaning'::text,
    'opening'::text,
    'closing'::text,
    'content'::text,
    'restocking'::text,
    'client_followup'::text,
    'general'::text,
    'attendance'::text,
    'operations'::text
  ]));

create or replace function public.run_rtb_safe_automations()
returns jsonb
language plpgsql
security definer
set search_path to 'public','private'
as $function$
declare
  v_today date := (now() at time zone 'America/Toronto')::date;
  v_created integer := 0;
  rec record;
  v_task_id uuid;
begin
  for rec in
    select sr.id, sr.business_unit_id, sr.staff_id, s.full_name, sr.shift_date
    from public.staff_shift_records sr
    join public.staff s on s.id = sr.staff_id
    where sr.shift_date <= v_today
      and sr.missed_shift is true
      and not exists (
        select 1 from public.rtb_automation_log l
        where l.automation_key = 'missed_shift_followup' and l.source_id = sr.id
      )
  loop
    insert into public.staff_tasks (staff_id, business_unit_id, title, category, details, due_date, status)
    values (
      rec.staff_id,
      rec.business_unit_id,
      'Follow up on missed shift',
      'attendance',
      format('RTB OS automatically flagged the missed scheduled shift on %s. Add a note or speak with management.', rec.shift_date),
      v_today + 1,
      'pending'
    ) returning id into v_task_id;

    insert into public.rtb_automation_log (business_unit_id, staff_id, automation_key, source_table, source_id, title, details, created_task_id)
    values (rec.business_unit_id, rec.staff_id, 'missed_shift_followup', 'staff_shift_records', rec.id,
      'Missed shift follow-up created', rec.full_name, v_task_id);
    v_created := v_created + 1;
  end loop;

  for rec in
    select sr.id, sr.business_unit_id, sr.staff_id, s.full_name, sr.shift_date
    from public.staff_shift_records sr
    join public.staff s on s.id = sr.staff_id
    where sr.shift_date <= v_today
      and sr.missed_checkout is true
      and not exists (
        select 1 from public.rtb_automation_log l
        where l.automation_key = 'missed_checkout_followup' and l.source_id = sr.id
      )
  loop
    insert into public.staff_tasks (staff_id, business_unit_id, title, category, details, due_date, status)
    values (
      rec.staff_id,
      rec.business_unit_id,
      'Fix missed checkout',
      'attendance',
      format('RTB OS detected that checkout was not completed for %s. Review the shift record and notify management if a correction is needed.', rec.shift_date),
      v_today + 1,
      'pending'
    ) returning id into v_task_id;

    insert into public.rtb_automation_log (business_unit_id, staff_id, automation_key, source_table, source_id, title, details, created_task_id)
    values (rec.business_unit_id, rec.staff_id, 'missed_checkout_followup', 'staff_shift_records', rec.id,
      'Missed checkout follow-up created', rec.full_name, v_task_id);
    v_created := v_created + 1;
  end loop;

  for rec in
    select r.id, r.business_unit_id, coalesce(r.assigned_to, r.staff_id) as staff_id,
           r.title, r.details, r.priority
    from public.staff_operations_requests r
    where r.status not in ('resolved','closed','done')
      and r.priority in ('high','urgent')
      and coalesce(r.assigned_to, r.staff_id) is not null
      and not exists (
        select 1 from public.rtb_automation_log l
        where l.automation_key = 'operations_issue_followup' and l.source_id = r.id
      )
  loop
    insert into public.staff_tasks (staff_id, business_unit_id, title, category, details, due_date, status)
    values (
      rec.staff_id,
      rec.business_unit_id,
      'Resolve: ' || rec.title,
      'operations',
      coalesce(rec.details, 'High-priority operations issue automatically routed by RTB OS.'),
      case when rec.priority = 'urgent' then v_today else v_today + 1 end,
      'pending'
    ) returning id into v_task_id;

    insert into public.rtb_automation_log (business_unit_id, staff_id, automation_key, source_table, source_id, title, details, created_task_id)
    values (rec.business_unit_id, rec.staff_id, 'operations_issue_followup', 'staff_operations_requests', rec.id,
      'Operations follow-up task created', rec.title, v_task_id);
    v_created := v_created + 1;
  end loop;

  return jsonb_build_object('created_tasks', v_created, 'ran_at', now());
end;
$function$;
