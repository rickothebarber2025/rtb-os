-- Keep the staff-facing checklist RPC private to signed-in RTB OS users.
revoke execute on function public.claim_my_operation_checklist(uuid,text,text) from public;
grant execute on function public.claim_my_operation_checklist(uuid,text,text) to authenticated;
grant execute on function public.claim_my_operation_checklist(uuid,text,text) to service_role;
