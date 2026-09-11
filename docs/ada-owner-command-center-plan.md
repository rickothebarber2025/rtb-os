# Ada Owner Command Center

Goal: turn Ada from a passive dashboard into an actionable owner control surface.

## Phase 1
- Add real action controls to owner queue items: Approve, Reject, Open/Review.
- De-duplicate repeated queue items before rendering.
- Auto-resolve/read-only monitoring items so they do not require owner approval.
- Collapse routine monitoring into status, not approvals.

## Phase 2
- Surface safe Mac/ARVIS controls from the existing ada-control backend.
- Add service health, restart/reconnect actions, and failure inspection.
- Keep Tailscale as transport/infrastructure, not a user-facing task.

## Phase 3
- Telegram becomes escalation-only: critical alerts and actionable approvals, with cooldown/deduplication.
- Ada remains the source of truth for full queue and system state.

Tracked in issue #77.
