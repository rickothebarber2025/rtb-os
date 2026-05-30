function toDateInputValue(date) {
  const copy = new Date(date);
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().slice(0, 10);
}

export function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function getWeekStart(date = new Date()) {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = copy.getDate() - day + (day === 0 ? -6 : 1);
  copy.setDate(diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function getDefaultPayrollWeek() {
  const start = getWeekStart();
  const end = addDays(start, 6);
  return {
    week_end: toDateInputValue(end),
    week_label: buildWeekLabel(start, end),
    week_start: toDateInputValue(start),
  };
}

export function buildWeekLabel(startValue, endValue) {
  const start = new Date(startValue);
  const end = new Date(endValue);
  const formatter = new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
  });
  return `${formatter.format(start)} - ${formatter.format(end)}`;
}
