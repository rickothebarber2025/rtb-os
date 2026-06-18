export const PROBATION_DAYS = 90;
export const PROBATION_RATE = 50;
export const STANDARD_RTB_RATE = 60;
export const GRADUATION_SOON_DAYS = 14;

function pad(value) {
  return String(value).padStart(2, '0');
}

export function toDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return toDateKey(new Date());

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseDateKey(value) {
  if (!value) return null;
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

export function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function diffDays(start, end) {
  const startUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endUtc = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.floor((endUtc - startUtc) / 86400000);
}

export function isProbationStaff(member) {
  return member?.tier === 'probation';
}

export function getProbationStartDate(member) {
  return (
    parseDateKey(member?.probation_start_date) ||
    parseDateKey(member?.start_date) ||
    parseDateKey(member?.created_at) ||
    new Date()
  );
}

export function getProbationInfo(member, today = new Date()) {
  const startDate = getProbationStartDate(member);
  const endDate = addDays(startDate, PROBATION_DAYS);
  const elapsedDays = Math.max(0, diffDays(startDate, today));
  const daysLeft = diffDays(today, endDate);
  const progress = Math.min(100, Math.max(0, (elapsedDays / PROBATION_DAYS) * 100));
  const overdue = daysLeft < 0;
  const graduatingSoon = !overdue && daysLeft <= GRADUATION_SOON_DAYS;

  return {
    daysElapsed: elapsedDays,
    daysLeft,
    endDate,
    endDateKey: toDateKey(endDate),
    graduatingSoon,
    overdue,
    progress,
    startDate,
    startDateKey: toDateKey(startDate),
    tone: overdue ? 'danger' : graduatingSoon ? 'success' : 'gold',
  };
}

export function shouldAutoGraduate(member, today = new Date()) {
  if (!isProbationStaff(member) || !member?.active) return false;
  return getProbationInfo(member, today).daysLeft <= 0;
}

export function appendGraduationNote(notes, date = new Date()) {
  const stamp = `Graduated from probation on ${toDateKey(date)}.`;
  const current = String(notes || '').trim();
  if (current.includes(stamp)) return current;
  return current ? `${current}\n${stamp}` : stamp;
}

export function toGraduationPayload(member, date = new Date()) {
  return {
    ...member,
    commission_rate: STANDARD_RTB_RATE,
    fixed_rate: false,
    notes: appendGraduationNote(member.notes, date),
    tier: 'standard',
  };
}

export function toProbationPayload(member, startDate = toDateKey()) {
  return {
    ...member,
    commission_rate: PROBATION_RATE,
    fixed_rate: false,
    probation_start_date: startDate || toDateKey(),
    tier: 'probation',
  };
}
