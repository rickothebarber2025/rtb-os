# RTB OS Staff Hub ↔ Dashboard Integration Audit

Date: 2026-07-31

## Scope

Audit the end-to-end communication between:

- Staff Hub
- My Workspace / owner dashboard
- Action Center
- Staff tasks
- Opening and closing checklists
- Shift records
- Shop status
- Notifications
- Staff and contractor profiles

## Immediate findings

### 1. Multiple task tables exist without one canonical task source

The production schema contains:

- `staff_tasks`
- `hub_tasks`
- `business_improvement_tasks`

At audit time, all three contained no active records. Features that read different tables can appear functional while not sharing the same task state.

**Required fix:** define `staff_tasks` as the canonical staff-facing task table and expose dashboard/action-center views from that source. Legacy tables should be migrated or treated as read-only compatibility sources.

### 2. Operations records are split across several event sources

Opening/closing information is stored in:

- `operation_checklist_runs`
- `operation_checklist_run_items`
- `staff_shift_records`
- `shop_status_events`
- `staff_operation_notifications`

Recent fixes now automatically finalize a shared opening/closing run and create its matching shop status event when all required checklist items are completed. The remaining audit must ensure every dashboard reads those records consistently.

### 3. Notification badges need a single read model

Staff announcements, operation notifications, tasks, and action-center items currently use separate tables and read states. Badge counts can remain visible when one source is deleted or acknowledged elsewhere.

**Required fix:** create one notification-feed query/view that returns stable IDs, source type, user, read state, business, and destination.

### 4. Profile identity is duplicated

Authentication and access rely on `user_profiles`, while operational assignments rely on `staff` and some older features reference `hub_staff_profiles`.

**Required fix:** use authentication user ID as the primary link wherever possible, with email fallback only for migration. Employees, contractors, vendors, and temporary workers must all resolve to a work profile without receiving unauthorized payroll access.

## Required integration contracts

### Task contract

Creating or assigning a task must immediately update:

1. Staff Hub task list
2. Owner dashboard priority count
3. Action Center
4. Notification badge for the assignee
5. Completion history and performance reporting

Completing a task must clear all corresponding open counts in the same transaction.

### Opening/closing contract

Completing every required checklist item must automatically:

1. Mark the run 100% complete
2. Record the responsible person and timestamp
3. Confirm the run without a second button
4. Create the matching open/closed shop-status event
5. Update My Workspace
6. Clear Action Center warnings
7. Add the verified record to Operations history
8. Generate owner/staff activity where appropriate

### Shift contract

Ending a shift must:

- use Toronto local date
- block an assigned closer with incomplete required tasks
- not require unrelated staff to complete opening/closing duties
- update dashboard staffing state immediately

### Notification contract

Every badge must be computed from unread records that still exist. Marking an item read in its destination must clear the corresponding badge source.

## Audit test matrix

- Employee scheduled today, no shop duty
- Employee off today
- Assigned opener completes all items
- Assigned closer attempts checkout with incomplete items
- Contractor completes assigned cleaning duties
- Task created by owner and assigned to one staff member
- Task completed by assignee
- Task overdue
- Announcement read and deleted
- User with all-business access versus single-business access
- Owner combined-business dashboard

## Current priority order

1. Canonical task and Action Center wiring
2. Unified notification feed and badge count
3. Dashboard queries sourced from canonical operations events
4. Identity linking across user/work profiles
5. End-to-end regression tests for each contract above
