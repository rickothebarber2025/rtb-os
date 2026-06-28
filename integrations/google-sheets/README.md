# RTB OS Google Sheets Payroll Sync

This Apps Script bridge keeps Google Sheets as the payroll calculation engine and sends finalized rows from `RTB_OS_EXPORT` into RTB OS.

## Sheet setup

Create a sheet named `RTB_OS_EXPORT` with one header row. Supported headers include:

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

## Apps Script setup

1. Open the payroll workbook.
2. Go to Extensions > Apps Script.
3. Paste `Code.gs` into the script editor.
4. Add the `appsscript.json` manifest contents.
5. Refresh the spreadsheet.
6. Use RTB OS > Configure sync.

Sync URL:

```text
https://qbeficojfoqgzjxrzxyg.supabase.co/functions/v1/google-sheets-payroll-sync
```

The sync secret must match the Supabase Edge Function secret named `GOOGLE_SHEETS_PAYROLL_SYNC_SECRET`.

## Supabase secret

Set the Edge Function shared secret without committing it:

```bash
npx supabase secrets set GOOGLE_SHEETS_PAYROLL_SYNC_SECRET=your-long-random-secret
```

The Edge Function rejects requests without this token.
