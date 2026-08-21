function atNoon(year, month, day) {
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function nthWeekday(year, month, weekday, nth) {
  const first = atNoon(year, month, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return atNoon(year, month, 1 + offset + (nth - 1) * 7);
}

function lastWeekdayBefore(year, month, day, weekday) {
  const date = atNoon(year, month, day - 1);
  while (date.getDay() !== weekday) date.setDate(date.getDate() - 1);
  return date;
}

function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return atNoon(year, month, day);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function event(id, name, date, category, opportunity, leadDays = 21, businesses = 'both', source = 'Automatic Canadian date rule') {
  return { id, name, date, category, opportunity, leadDays, businesses, source };
}

function annualEvents(year) {
  const easter = easterSunday(year);
  const thanksgiving = nthWeekday(year, 10, 1, 2);
  const usThanksgiving = nthWeekday(year, 11, 4, 4);

  return [
    event('new-year', "New Year's Day", atNoon(year, 1, 1), 'holiday', 'Fresh-start / new-look campaign', 14),
    event('valentines', "Valentine's Day", atNoon(year, 2, 14), 'seasonal', 'Couples, self-care, date-night beauty and grooming', 21),
    event('family-day', 'Family Day', nthWeekday(year, 2, 1, 3), 'holiday', 'Family grooming / kids cuts / long-weekend bookings', 14),
    event('march-break', 'March Break', atNoon(year, 3, 15), 'school', 'Student cuts, braids, nails and family appointments', 21),
    event('good-friday', 'Good Friday', addDays(easter, -2), 'holiday', 'Long-weekend grooming and beauty demand', 14),
    event('easter', 'Easter Sunday', easter, 'holiday', 'Fresh look before family gatherings', 14),
    event('mothers-day', "Mother's Day", nthWeekday(year, 5, 0, 2), 'seasonal', 'Beauty packages, nails, lashes and gift cards', 28, 'beauty'),
    event('victoria-day', 'Victoria Day', lastWeekdayBefore(year, 5, 25, 1), 'holiday', 'Long-weekend grooming and beauty', 14),
    event('prom-season', 'Prom / graduation season', atNoon(year, 6, 1), 'seasonal', 'Cuts, braids, nails, lashes and event-ready packages', 30),
    event('fathers-day', "Father's Day", nthWeekday(year, 6, 0, 3), 'seasonal', 'Grooming, beard, haircut and gift-card campaigns', 21, 'lounge'),
    event('canada-day', 'Canada Day', atNoon(year, 7, 1), 'holiday', 'Long-weekend / event-ready bookings', 14),
    event('civic-holiday', 'Civic Holiday / Colonel By Day', nthWeekday(year, 8, 1, 1), 'holiday', 'Ottawa long-weekend bookings', 14),
    event('back-to-school-window', 'Back-to-school campaign window', atNoon(year, 8, 15), 'school', 'Start student, kids, braids and clean-up campaigns before school rush', 21),
    event('labour-day', 'Labour Day', nthWeekday(year, 9, 1, 1), 'holiday', 'Last summer weekend + school-ready bookings', 14),
    event('thanksgiving', 'Thanksgiving', thanksgiving, 'holiday', 'Family gathering / fall refresh bookings', 14),
    event('halloween', 'Halloween', atNoon(year, 10, 31), 'seasonal', 'Party-ready hair, nails, lashes and styling', 21),
    event('black-friday', 'Black Friday', addDays(usThanksgiving, 1), 'retail', 'Gift cards, prepaid packages and limited offers', 30),
    event('holiday-party', 'Holiday party season', atNoon(year, 12, 1), 'seasonal', 'Event-ready cuts, braids, nails and lashes', 30),
    event('christmas', 'Christmas Day', atNoon(year, 12, 25), 'holiday', 'Holiday appointments and gift cards', 28),
    event('boxing-day', 'Boxing Day', atNoon(year, 12, 26), 'retail', 'Gift-card / prepaid January offer', 21),
    event('new-years-eve', "New Year's Eve", atNoon(year, 12, 31), 'seasonal', 'Party-ready beauty and grooming', 21),
  ];
}

const OTTAWA_SCHOOL_2026_27 = [
  event('school-first-day-2026', 'Ottawa first day of school', atNoon(2026, 9, 1), 'school', 'High-priority back-to-school cuts, braids and family bookings', 28, 'both', 'OCDSB + OCSB approved 2026–2027 calendars'),
  event('school-labour-day-2026', 'Labour Day — schools closed', atNoon(2026, 9, 7), 'school', 'Long-weekend + school-ready overflow bookings', 10, 'both', 'OCDSB + OCSB approved 2026–2027 calendars'),
  event('school-thanksgiving-2026', 'Thanksgiving — schools closed', atNoon(2026, 10, 12), 'school', 'Family weekend campaign', 14, 'both', 'OCDSB + OCSB approved 2026–2027 calendars'),
  event('school-winter-break-2026', 'Ottawa winter school break starts', atNoon(2026, 12, 21), 'school', 'Holiday break grooming, braids and beauty', 28, 'both', 'OCDSB + OCSB approved 2026–2027 calendars'),
  event('school-return-2027', 'Return to school after winter break', atNoon(2027, 1, 4), 'school', 'New-year clean-up / school-ready bookings', 14, 'both', 'OCDSB + OCSB approved 2026–2027 calendars'),
  event('school-march-break-2027', 'Ottawa March Break starts', atNoon(2027, 3, 15), 'school', 'Kids, students, braids and family appointment push', 21, 'both', 'OCDSB + OCSB approved 2026–2027 calendars'),
  event('school-last-week-2027', 'Ottawa end-of-school / graduation window', atNoon(2027, 6, 17), 'school', 'Graduation, prom and summer-ready campaign', 30, 'both', 'OCDSB + OCSB approved 2026–2027 calendars'),
];

export function getMarketingCalendar(referenceDate = new Date()) {
  const startYear = referenceDate.getFullYear();
  const events = [
    ...annualEvents(startYear),
    ...annualEvents(startYear + 1),
    ...OTTAWA_SCHOOL_2026_27,
  ];

  const unique = new Map();
  events.forEach((item) => unique.set(`${item.id}:${item.date.toISOString().slice(0, 10)}`, item));

  return [...unique.values()]
    .map((item) => {
      const dayMs = 86400000;
      const daysUntil = Math.ceil((item.date.getTime() - referenceDate.getTime()) / dayMs);
      const launchDate = addDays(item.date, -item.leadDays);
      const launchDaysUntil = Math.ceil((launchDate.getTime() - referenceDate.getTime()) / dayMs);
      let status = 'later';
      if (daysUntil < 0) status = 'passed';
      else if (daysUntil <= 7) status = 'now';
      else if (launchDaysUntil <= 0) status = 'plan-now';
      else if (launchDaysUntil <= 14) status = 'prepare';
      return { ...item, daysUntil, launchDate, launchDaysUntil, status };
    })
    .filter((item) => item.daysUntil >= -2)
    .sort((a, b) => a.date - b.date);
}

export function formatMarketingDate(date) {
  return new Intl.DateTimeFormat('en-CA', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}
