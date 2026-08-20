select private.refresh_finance_recurring_patterns(id),
       private.refresh_finance_reconciliation(id),
       private.refresh_finance_calendar_forecast(id)
from public.business_units
where name in ('RTB Lounge','RTB Beauty Lounge');
