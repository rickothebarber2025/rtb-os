const DAY_MS = 24 * 60 * 60 * 1000;

function startOfUtcDay(value) {
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function daysSince(value, now = new Date()) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.max(0, Math.floor((startOfUtcDay(now) - startOfUtcDay(parsed)) / DAY_MS));
}

export function buildOperationalChecks({
  activeStaffCount,
  appointmentUpdatedAt,
  businessUnitName,
  latestRun,
  payrollAllowed,
  squareStatus,
  now = new Date(),
}) {
  const checks = [];

  checks.push({
    action: 'staff',
    detail: activeStaffCount ? `${activeStaffCount} active staff profiles` : 'Add active staff',
    label: 'Roster',
    tone: activeStaffCount ? 'success' : 'danger',
  });

  if (payrollAllowed) {
    const payrollAge = daysSince(latestRun?.week_end, now);
    checks.push({
      action: 'payroll',
      detail: latestRun
        ? `${latestRun.week_label} · ${payrollAge === 0 ? 'current' : `${payrollAge} days since period end`}`
        : 'No payroll run saved',
      label: 'Payroll',
      tone: payrollAge === null ? 'danger' : payrollAge > 10 ? 'warning' : 'success',
    });
  }

  checks.push({
    action: 'operations',
    detail: 'SOPs, hiring workflows, forms, training, and change log',
    label: 'Operating system',
    tone: 'muted',
  });

  checks.push({
    action: 'system',
    detail: 'Health checks, backups, exports, and recovery shortcuts',
    label: 'System tools',
    tone: 'success',
  });

  return checks;
}
