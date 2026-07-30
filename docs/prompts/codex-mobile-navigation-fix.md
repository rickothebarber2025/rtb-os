# Codex Task: Fix RTB OS Mobile Navigation Drift

Review `docs/reviews/2026-07-30-mobile-navigation-adjustments.md` and implement every item marked as required for:

- `src/pages/DashboardPage.jsx`
- `src/pages/StaffHubPage.jsx`
- the relevant scoped rules in `src/styles/global.css`

Do not restore outdated code blindly from earlier commits. Preserve newer dashboard and Staff Hub functionality already on `main`.

Key outcomes:

1. Dashboard mobile tabs become Overview, Actions, Appointments when available, Team, and Finance when permitted.
2. Performance and roster move out of Payroll/Finance into Team.
3. Appointment information becomes reachable on mobile again.
4. Staff Hub renders one tablist only.
5. Both tab systems use complete accessible tab semantics.
6. Both preserve valid `?section=` deep links.
7. Mobile tab changes bring the beginning of the selected content into view.
8. Desktop continues showing all Dashboard sections.
9. Remove duplicate `top` declarations in sticky Staff Hub CSS.
10. Run the production build, lint, and configured tests; report results and changed files.

Test at 390px, 768px, 901px, and desktop widths. Do not merge if desktop sections disappear or users without payroll access see a dead Finance tab.
