drop policy if exists deny_client_access on private.performance_history_duplicate_archive;
create policy deny_client_access
on private.performance_history_duplicate_archive
for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists deny_client_access on public.integration_credentials;
create policy deny_client_access
on public.integration_credentials
for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists deny_client_access on public.rtb_automation_log;
create policy deny_client_access
on public.rtb_automation_log
for all
to anon, authenticated
using (false)
with check (false);
