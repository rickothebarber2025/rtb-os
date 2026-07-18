-- public.touch_updated_at() existed in production before migrations were tracked here.
-- 20260618055312_production_hardening.sql hardens its search_path via `alter function`,
-- which requires the function to already exist, so a fresh database (e.g. a Supabase
-- preview branch) needs it created first.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;
