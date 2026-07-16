# RTB OS Google Sheets Payroll Sync

This Apps Script bridge keeps Google Sheets as the payroll calculation engine and sends finalized rows from `RTB_OS_EXPORT` into RTB OS.

For the current RTB setup, the Drive paystub folder (`RTB Pay Stubs`) stores generated PDF paystubs. The payroll source workbook is the Google Sheet named `commissions-revenue (RTB)`. Sync RTB OS from the workbook, not the PDF folder.

## Sheet setup

The Apps Script can create and refresh a sheet named `RTB_OS_EXPORT` from the workbook's `Pay History` tab. It also creates a hidden `RTB_OS_STAFF_MAP` sheet so staff can be mapped to the correct business before syncing.

Supported export headers include:

- `business`, `business_unit`, or `business_unit_id`
- `week_start`
- `week_end`
- `week_label`
- `staff_name`
- `net_sales`
- `tips`
- `commission_rate` or `base_commission_rate`
- `applied_commission_rate`
- `fixed_rate`
- `deduction`
- `take_home`
- `tier`
- `role`
- `notes`
- `owner_net_sales`
- `owner_tips`

Required fields per row are `business`/`business_unit`/`business_unit_id`, `week_start`, `week_end`, and `staff_name`. Use `RTB Lounge` for barbershop payroll rows and `RTB Beauty Lounge` for beauty payroll rows. Amount fields may be numbers or currency-formatted strings.

The Apps Script validates that every exported row has a business value before sending data to RTB OS. The Edge Function upserts by `business + week_start + week_end + staff_name`, so the same staff name can exist in both businesses without overwriting the other business.

## Current RTB workbook mapping

The script reads `Pay History` columns:

- `Week Start` -> `week_start`
- `Week End` -> `week_end`
- `Staff` -> `staff_name`
- `Revenue` -> `net_sales`
- `Commission %` -> `commission_rate` and `applied_commission_rate`
- `Deductions` -> `deduction`
- `Tips` -> `tips`
- `Net Pay` -> `take_home`
- `Payroll Status` -> `paystub_status`

It reads `Staff Directory` to seed `RTB_OS_STAFF_MAP`. Review the hidden mapping sheet after the first refresh and adjust any staff member whose business or role is wrong. New staff can be added there without changing the app.

## Apps Script setup

1. Open the payroll workbook.
2. Go to Extensions > Apps Script.
3. Paste `Code.gs` into the script editor.
4. Add the `appsscript.json` manifest contents.
5. Refresh the spreadsheet.
6. Use RTB OS > Configure sync.
7. Use RTB OS > Refresh export from Pay History.
8. Use RTB OS > Refresh + sync now.

Sync URL:

```text
https://qbeficojfoqgzjxrzxyg.supabase.co/functions/v1/google-sheets-payroll-sync
```

The sync secret must match the Supabase Edge Function secret named `GOOGLE_SHEETS_PAYROLL_SYNC_SECRET`.

## Automatic sync

After the sync URL and secret are configured, use:

```text
RTB OS > Turn on automatic sync
```

Choose how often the workbook should refresh `RTB_OS_EXPORT` and post finalized rows to RTB OS. The script uses upserts, so syncing the same payroll period again updates the same records instead of creating duplicates.

Use:

```text
RTB OS > Turn off automatic sync
```

to remove the scheduled trigger.

## Supabase secret

Set the Edge Function shared secret without committing it:

```bash
npx supabase secrets set GOOGLE_SHEETS_PAYROLL_SYNC_SECRET=your-long-random-secret
```

The Edge Function rejects requests without this token.
