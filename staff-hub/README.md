# RTB Staff Hub

The Staff Hub is now merged into the main RTB OS React app.

## Current location

- Page: `src/pages/StaffHubPage.jsx`
- Navigation: `src/utils/constants.js`
- Permissions: `src/lib/permissions.js`

## Scope

The merged Staff Hub gives staff a focused workspace for their assigned business:

- weekly earnings from payroll entries linked to their staff profile
- personal performance summary
- role and profile details
- common shortcuts into allowed RTB OS modules

It reuses the existing RTB OS Supabase auth, permissions, business scoping, and RLS model.
