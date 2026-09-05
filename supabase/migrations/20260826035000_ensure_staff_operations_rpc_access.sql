revoke execute on function public.claim_my_operation_checklist(uuid,text,text) from public, anon;
revoke execute on function public.get_my_daily_operations(uuid) from public, anon;
revoke execute on function public.set_my_operation_item(uuid,text,text,text) from public, anon;
revoke execute on function public.confirm_operation_shift(uuid,text) from public, anon;
revoke execute on function public.start_my_shift(uuid,integer) from public, anon;
revoke execute on function public.end_my_shift(uuid,text) from public, anon;

grant execute on function public.claim_my_operation_checklist(uuid,text,text) to authenticated;
grant execute on function public.get_my_daily_operations(uuid) to authenticated;
grant execute on function public.set_my_operation_item(uuid,text,text,text) to authenticated;
grant execute on function public.confirm_operation_shift(uuid,text) to authenticated;
grant execute on function public.start_my_shift(uuid,integer) to authenticated;
grant execute on function public.end_my_shift(uuid,text) to authenticated;

notify pgrst, 'reload schema';
