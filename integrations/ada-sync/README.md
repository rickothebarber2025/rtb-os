# Ada Actionable Message Cloud Sync

This integration mirrors **only actionable Ada messages** from Ricko's local Mac archive into the existing RTB OS Supabase table `public.ada_inbox_items` so the cloud-based RTB Owner Morning CEO Brief can read them when `127.0.0.1` is not reachable from ChatGPT.

## Privacy model

Default behavior is intentionally restrictive:

- Reads only the owner-authorized local endpoint:
  `http://127.0.0.1:8790/api/messages/archive?sort=priority`
- Syncs a record only when Ada explicitly marks it actionable **or** links it to a task.
- Ordinary private conversation is not synced.
- Stores the concise local summary as `message_text` by default instead of the full original message.
- Stores locally inferred topic/priority, original message date, task due date, and resolution status needed by the CEO brief.
- Does not send replies, create tasks, approve anything, or trigger external actions.
- Uses `source=ada-local` and a stable source key so existing items are updated instead of duplicated.

If Ada's archive does not currently expose an explicit actionable flag/task signal, nothing is synced by default. `ADA_SYNC_ALLOW_INFERRED=1` can be enabled later, but should only be used after confirming the local archive's classification schema is safe.

## Files

- `sync_ada_archive.py` — dependency-free Python sync worker.
- `run.sh` — loads local secrets/config and runs one sync.
- `com.rtb.ada-sync.plist` — launchd job, every 5 minutes.
- `install_launch_agent.sh` — validates config, runs a test sync, and installs the launch agent.

## One-time Mac setup

From `~/Documents/rtb-os` after this branch/PR is merged:

```bash
/bin/zsh integrations/ada-sync/install_launch_agent.sh
```

On the first run, the installer creates:

```text
~/.config/rtb/ada-sync.env
```

with mode `600`, then stops so the Supabase service-role key can be added locally. The service-role key must **never** be committed to GitHub.

After adding the key, run the installer again:

```bash
/bin/zsh integrations/ada-sync/install_launch_agent.sh
```

The installer performs a live test against the local Ada archive before loading launchd.

## Config

```bash
SUPABASE_URL=https://qbeficojfoqgzjxrzxyg.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
ADA_ARCHIVE_URL=http://127.0.0.1:8790/api/messages/archive?sort=priority
ADA_SYNC_FULL_TEXT=0
ADA_SYNC_ALLOW_INFERRED=0
ADA_SYNC_TIMEOUT_SECONDS=8
```

Recommended production values are the defaults above.

## Logs

```bash
tail -f /tmp/rtb-ada-sync.log
tail -f /tmp/rtb-ada-sync.err
```

Successful runs print a compact JSON summary such as:

```json
{"archive_items":12,"actionable_items":3,"inserted":2,"updated":1,"failed":0,"privacy_mode":"summary_only"}
```

## Verification

Cloud mirror check:

```sql
select sender_name, category, priority, status, summary, message_at,
       metadata->>'task_due_date' as task_due_date
from public.ada_inbox_items
where source = 'ada-local'
order by message_at desc;
```

Once rows appear, the RTB Owner Morning CEO Brief can use the cloud mirror automatically whenever the Mac localhost archive is inaccessible.
