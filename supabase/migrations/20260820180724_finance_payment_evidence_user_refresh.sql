create or replace function public.refresh_my_finance_payment_evidence(p_business_unit_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,auth,private,pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if private.permission_rank(private.module_permission('finance')) < private.permission_rank('edit') then
    raise exception 'Finance edit access required';
  end if;
  if not private.finance_business_allowed(p_business_unit_id) then
    raise exception 'Finance business access denied';
  end if;
  return public.refresh_finance_payment_evidence(p_business_unit_id);
end; $$;
revoke all on function public.refresh_my_finance_payment_evidence(uuid) from public,anon;
grant execute on function public.refresh_my_finance_payment_evidence(uuid) to authenticated;
