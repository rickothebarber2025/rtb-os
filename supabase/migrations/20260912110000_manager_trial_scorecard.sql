-- Trackable Operations Manager trial scorecard.
-- Uses persisted RTB OS records as source of truth and exposes a stable API via RPC/REST.

create table if not exists public.manager_trial_assignments (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  role_title text not null default 'Operations Manager',
  trial_start date not null,
  trial_end date not null,
  weekly_bonus numeric(10,2) not null default 50,
  status text not null default 'active' check (status in ('active','passed','extended','ended')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_unit_id, staff_id, trial_start)
);

alter table public.manager_trial_assignments enable row level security;

create policy "manager trial readable by business access"
on public.manager_trial_assignments for select to authenticated
using (private.can_access_business_module(business_unit_id,'performance','view'));

create policy "manager trial editable by performance editors"
on public.manager_trial_assignments for all to authenticated
using (private.can_access_business_module(business_unit_id,'performance','edit'))
with check (private.can_access_business_module(business_unit_id,'performance','edit'));

create or replace function public.manager_trial_scorecard(p_assignment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,private
as $$
declare
  a public.manager_trial_assignments%rowtype;
  v jsonb;
begin
  select * into a from public.manager_trial_assignments where id=p_assignment_id;
  if not found then raise exception 'Manager trial assignment not found'; end if;
  if not private.can_access_business_module(a.business_unit_id,'performance','view') then
    raise exception 'Not authorized';
  end if;

  select jsonb_build_object(
    'assignment_id',a.id,
    'staff_id',a.staff_id,
    'role_title',a.role_title,
    'trial_start',a.trial_start,
    'trial_end',a.trial_end,
    'status',a.status,
    'weekly_bonus',a.weekly_bonus,
    'tracked',jsonb_build_object(
      'checklist_runs',count(*) filter(where c.id is not null),
      'checklists_completed',count(*) filter(where c.status='completed'),
      'avg_checklist_completion',coalesce(round(avg(c.completion_percent),1),0),
      'openings_completed',count(*) filter(where c.checklist_type='opening' and c.status='completed'),
      'closings_completed',count(*) filter(where c.checklist_type='closing' and c.status='completed'),
      'manager_approvals',count(*) filter(where c.manager_approved_by is not null)
    ),
    'staff_tasks',(
      select jsonb_build_object(
        'created',count(*) filter(where t.created_by=s.user_id),
        'assigned',count(*) filter(where t.staff_id=a.staff_id),
        'completed_assigned',count(*) filter(where t.staff_id=a.staff_id and t.status='completed')
      ) from public.staff_tasks t left join public.staff s on s.id=a.staff_id
      where t.business_unit_id=a.business_unit_id and t.created_at::date between a.trial_start and a.trial_end
    ),
    'operations_requests',(
      select jsonb_build_object(
        'created',count(*) filter(where r.created_by=s.user_id),
        'assigned',count(*) filter(where r.assigned_to=a.staff_id),
        'resolved_assigned',count(*) filter(where r.assigned_to=a.staff_id and r.status in ('resolved','completed','closed'))
      ) from public.staff_operations_requests r left join public.staff s on s.id=a.staff_id
      where r.business_unit_id=a.business_unit_id and r.created_at::date between a.trial_start and a.trial_end
    ),
    'warnings',(
      select jsonb_build_object(
        'issued',count(*) filter(where w.issued_by=s.user_id),
        'resolved',count(*) filter(where w.resolved_by=s.user_id)
      ) from public.staff_warnings w left join public.staff s on s.id=a.staff_id
      where w.business_unit_id=a.business_unit_id and w.created_at::date between a.trial_start and a.trial_end
    ),
    'announcements_authored',(
      select count(*) from public.staff_announcements n join public.staff s on s.id=a.staff_id
      where n.business_unit_id=a.business_unit_id and n.created_by=s.user_id and n.created_at::date between a.trial_start and a.trial_end
    ),
    'attendance',(
      select jsonb_build_object(
        'scheduled_shifts',count(*),
        'late_shifts',count(*) filter(where coalesce(sr.late_minutes,0)>0),
        'missed_shifts',count(*) filter(where coalesce(sr.missed_shift,false)),
        'missed_checkouts',count(*) filter(where coalesce(sr.missed_checkout,false))
      ) from public.staff_shift_records sr
      where sr.staff_id=a.staff_id and sr.shift_date between a.trial_start and a.trial_end
    ),
    'generated_at',now()
  ) into v
  from public.operation_checklist_runs c
  where c.staff_id=a.staff_id and c.business_unit_id=a.business_unit_id and c.run_date between a.trial_start and a.trial_end;

  return v;
end;
$$;

grant execute on function public.manager_trial_scorecard(uuid) to authenticated;

comment on function public.manager_trial_scorecard(uuid) is
'API scorecard for an Operations Manager trial. Available through Supabase RPC REST endpoint /rest/v1/rpc/manager_trial_scorecard and uses persisted RTB OS records.';
