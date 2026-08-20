-- Bank imports are reconciliation evidence, not a second source of operating revenue.
-- Keep recurring-pattern forecasting expense-only so projected inflow comes from
-- operational sources such as Square rather than duplicated bank deposits.
delete from public.finance_recurring_patterns where direction = 'income';
delete from public.finance_calendar_events where source_type = 'recurring_pattern' and direction = 'income';
