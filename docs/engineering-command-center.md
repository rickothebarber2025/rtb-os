# RTB OS Engineering Command Centre

Owner: Ricko
Repository: rickothebarber2025/rtb-os
Supabase: qbeficojfoqgzjxrzxyg
Timezone: America/Toronto

## Mission
RTB OS is the operating system for RTB Lounge and RTB Beauty Lounge. Engineering decisions must reduce owner workload, improve accountability, improve customer experience, improve management visibility, protect data, or improve reliability.

## Development rule
Understand -> Audit -> Plan -> Branch -> Fix -> Test -> Review -> Merge.

## Current audit baseline
- Private JavaScript/React repository on main.
- Supabase project is ACTIVE_HEALTHY.
- Vite + React + Capacitor iOS + Supabase stack.
- Recent development is concentrated around Ada control, staff communication, time-off handling, mobile navigation, notifications, finance, and operational automation.
- The migration history contains many iterative correction/hardening migrations, so schema drift and duplicated behavior require active review.
- package.json still uses multiple `latest` dependency ranges. Dependency reproducibility is a stability risk and should be corrected deliberately.
- App.jsx is a central routing/orchestration file and should be watched for excessive coupling as modules continue to grow.

## Backlog order

### P0 - Critical
- Security/privacy leaks.
- RLS or authorization bypass.
- Data corruption or destructive sync behavior.
- Auth/session failures.
- Production crashes blocking owner or staff operation.

### P1 - Broken
- Staff add/upload crashes.
- Navigation routes that are visible but not wired.
- Forms/actions that appear successful but do not persist.
- Frontend/backend mismatches.
- Ada actions that are read-only when an approved write path is required.
- Owner/staff reply or notification loops that do not close.

### P2 - Operational
- Staff onboarding lifecycle.
- Attendance and Square clock-in reconciliation.
- Payroll draft/finalization integrity.
- Opening/closing/cleaning workflows.
- Time-off and availability.
- Requests/messages/tasks.
- Booking and staff schedule operations.

### P3 - Simplification
- Reduce duplicate Hub tabs.
- Consolidate repeated workflows.
- Make owner dashboard exception-driven.
- Standardize loading/error/success states.
- Improve mobile navigation consistency.
- Reduce App.jsx coupling where justified.

### P4 - Intelligence
- Ada/Arvis action layer.
- Behavior-based UX insights.
- Operational recommendations.
- Business summaries and exception detection.
- Safe automations with explicit permissions and audit logs.

## Active engineering risks
1. Dependency drift from `latest` package ranges.
2. Large and iterative Supabase migration history.
3. Rapid feature growth increasing frontend/backend coupling.
4. Multiple integrations and agent paths creating potential duplicate sources of truth.
5. Owner, manager, contractor, cleaning, and staff role boundaries require continuous regression testing.

## Definition of done
A feature is done only when:
- the UI is usable on desktop and mobile;
- backend persistence works;
- permissions/RLS are correct;
- loading/error/empty/success states are present;
- create/update/delete or full lifecycle behavior is complete where applicable;
- tests cover the regression-sensitive path;
- no unrelated feature changed;
- source-of-truth behavior is documented if non-obvious.

## Change discipline
Use focused branches. Do not make broad production schema changes merely because they are convenient. Do not solve broken authorization by weakening security. Consolidate repeated fixes when the same subsystem needs recurring patches.
