# RTB OS Mobile Navigation Review — July 30, 2026

## Scope reviewed

- `src/pages/DashboardPage.jsx`
- `src/pages/StaffHubPage.jsx`
- Mobile tab patches from commits `3c8a7f08de03e724904a2e9b868af62140c73715` and `5dc0389ec600fdec0ad3b8b9cc47b0d2ce314d39`
- RTB Owner Operations Manual, Volume 1

## Confirmed problems on `main`

### Dashboard

1. The current mobile tab list only includes `Overview`, `Actions`, and `Payroll`.
2. `appointmentSummary` is still calculated, but there is no mobile `Appointments` destination or appointment snapshot section in the current component.
3. Performance and roster sections are grouped under `payroll`, which makes the navigation label misleading.
4. Tabs use `aria-current="page"` instead of tab semantics.
5. The selected mobile tab is lost after refresh and cannot be deep-linked.
6. Action counts are visible in the page but not in the mobile navigation.

### Staff Hub

1. The old `.staff-hub-tabs-panel` markup remains in the component while a second `.staff-hub-sticky-tabs` navigation is also rendered.
2. The old panel is hidden by CSS, leaving duplicated DOM and duplicated controls for assistive technology.
3. Buttons inside the tablist do not have `role="tab"`, `aria-controls`, or roving `tabIndex`.
4. Tab panels do not have matching `role="tabpanel"` and IDs.
5. The selected section is not preserved in the URL.
6. Inline calls to `setActiveTab(...)` do not consistently move the user to the beginning of the newly selected content.
7. The sticky CSS uses duplicate `top` declarations; the latter overrides the former.
8. Eight Staff Hub tabs are crowded on mobile. They need prioritization or a controlled horizontal strip with clear active-state visibility.

## Required Dashboard adjustment

Use these groups:

- `overview`: workspace, priority board, KPI strip, Instagram, business profile, operations checks
- `actions`: Action Center snapshot
- `appointments`: Booksy/Square appointment snapshot when appointment data exists
- `team`: performance leaderboard and roster/commission profile
- `finance`: payroll and booth-rent information when permitted

Implementation requirements:

- Build the available tabs from the content actually available to the current user.
- Validate `?section=` against available tab IDs.
- Preserve the active section with `window.history.replaceState` or the app router.
- Use `role="tablist"`, `role="tab"`, `aria-selected`, `aria-controls`, and `role="tabpanel"`.
- Use roving `tabIndex` and support Left/Right arrow navigation.
- Add an action-count badge only when there are open actions.
- When a tab changes on mobile, scroll the tab bar/content start into view without moving desktop users.
- Desktop must continue showing all sections at once.

## Required Staff Hub adjustment

- Delete the obsolete `.staff-hub-tabs-panel` JSX rather than only hiding it.
- Keep one navigation source: `.staff-hub-sticky-tabs`.
- Route every tab change through one helper, for example `selectStaffHubTab(tabId, { scroll: true })`.
- Preserve the active tab with `?section=`.
- Validate URL values against `TABS` and the current user's permissions.
- Add complete accessible tab semantics and matching tabpanel IDs.
- Use `top: max(0px, env(safe-area-inset-top));` or the app's header-offset variable, not two `top` declarations.
- Ensure selected tabs scroll into view horizontally.
- On mobile, prioritize: `Today`, `Daily Ops`, `Earnings`, `Schedule`, `Performance`, with Updates/Tips/More still reachable in the same horizontal strip.

## Regression checks

Test at widths 390px, 768px, 901px, and desktop.

Confirm:

- No dashboard sections disappear on desktop.
- Each mobile dashboard section is reachable.
- Appointment data is reachable when present.
- Users without payroll permission do not see a dead Finance tab.
- Refreshing preserves the selected section.
- Browser back/forward behaviour remains predictable.
- Keyboard users can switch tabs.
- Screen readers announce one tablist, not two.
- Staff Hub sticky navigation remains inside the actual `.content` scroll container.
- Production build, lint, and configured tests pass.

## Product priority after navigation

The next RTB OS build phase should implement the staff lifecycle from the Owner Operations Manual:

`candidate → interview → practical assessment → onboarding → probation → active → suspended/offboarding → former`

Start with onboarding checklists, 30/60/90-day reviews, discipline records, and offboarding/client reassignment before adding more dashboard cards.
