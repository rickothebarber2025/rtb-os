# A.R.V.I.S. Unified Local Runtime

This folder is the consolidation point for the Mac-side RTB assistant runtime.

## Start everything

```bash
cd ~/Documents/rtb-os
/bin/zsh integrations/arvis/start.sh
```

The launcher:

1. Refreshes the protected A.R.V.I.S./Ada control bridge runtime.
2. Keeps the control API on localhost and optionally refreshes the private Tailscale Serve mapping.
3. Checks the Neural Workbench health endpoint.
4. Starts `~/Downloads/neural-workbench` with `npm run dev` only when it is offline.
5. Writes the Workbench log to `~/.local/state/rtb/neural-workbench.log`.

If the Google AI Studio export is moved, set:

```bash
export NEURAL_WORKBENCH_DIR="/absolute/path/to/neural-workbench"
/bin/zsh integrations/arvis/start.sh
```

## Current architecture boundary

RTB OS remains the source of truth. The Neural Workbench is currently a visual/intelligence layer and still contains local JSON/seed data paths in its exported source. Those data paths must not become authoritative.

The next consolidation phase is to replace Workbench business/staff reads with RTB OS/Supabase-backed adapters and remove hard-coded operational metrics before the integration branch is merged to production.
