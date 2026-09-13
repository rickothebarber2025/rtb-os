# A.R.V.I.S. Unified Local Runtime

This folder is the consolidation point for the Mac-side RTB assistant runtime.

## Start everything

```bash
cd ~/Documents/rtb-os
/bin/zsh integrations/arvis/start.sh
```

The launcher now:

1. Verifies the Neural Workbench project exists.
2. Applies the idempotent RTB OS → Neural Workbench live-data bridge.
3. Refreshes the protected A.R.V.I.S./Ada control runtime.
4. Keeps the control API on localhost and optionally refreshes the private Tailscale Serve mapping.
5. Checks the Neural Workbench health endpoint.
6. Starts `~/Downloads/neural-workbench` with `npm run dev` only when it is offline.
7. Writes the Workbench log to `~/.local/state/rtb/neural-workbench.log`.

If the Google AI Studio export is moved, set:

```bash
export NEURAL_WORKBENCH_DIR="/absolute/path/to/neural-workbench"
/bin/zsh integrations/arvis/start.sh
```

## Live data bridge

When Neural Workbench is embedded inside **RTB OS → A.R.V.I.S. Control**, RTB OS sends an owner-scoped `RTB_OS_SNAPSHOT` message into the iframe. The Workbench patch receives that snapshot and updates its RTB local data store.

The snapshot includes the already-authorized RTB OS view of:

- business unit context
- staff roster
- performance summaries
- payroll run summaries
- Square connection/status data
- master dashboard data
- staff activity and portal summaries
- live RTB OS warnings

This deliberately avoids copying Supabase credentials or a service-role key into Neural Workbench.

RTB OS/Supabase remains the source of truth. Neural Workbench is an intelligence and interaction layer, not a second business database.

## Current migration boundary

The original Google AI Studio export still contains legacy local JSON, Firebase and baseline-data paths. The bridge now overrides the core staff/operations browser data while embedded, but those legacy paths still need to be removed module-by-module before this integration is considered production-complete.

The next consolidation step is to move morning briefings, anomaly detection and approval actions away from hard-coded/local telemetry and make them consume the RTB OS snapshot directly.
