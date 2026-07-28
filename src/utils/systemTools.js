import { getProfileRoleTitle, hasModulePermission } from '../lib/permissions.js';

const BACKUP_VERSION = 'rtb-os-backup-v1';

export function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

export function toCsv(rows) {
  if (!rows.length) return '';
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return [
    columns.map(csvEscape).join(','),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(',')),
  ].join('\n');
}

export function slug(value) {
  return String(value || 'rtb-os')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function flattenPayrollEntries(payrollRuns = []) {
  return payrollRuns.flatMap((run) =>
    (run.payroll_entries || []).map((entry) => ({
      applied_commission_rate: entry.applied_commission_rate,
      deduction: entry.deduction,
      fixed_rate: entry.fixed_rate_snapshot,
      net_sales: entry.net_sales,
      payroll_status: run.status,
      run_created_at: run.created_at,
      run_week: run.week_label,
      staff_name: entry.staff_name_snapshot,
      take_home: entry.take_home,
      tips: entry.tips,
    })),
  );
}

export function createBackupSnapshot({
  accessProfile,
  boothRent = [],
  businessUnit,
  businessUnits = [],
  masterDashboard,
  masterDashboardUpdatedAt,
  monthlyPerformanceSummary = [],
  payrollRuns = [],
  performanceSummary = [],
  squareStatus,
  staff = [],
  user,
  warnings = [],
}) {
  return {
    exportedAt: new Date().toISOString(),
    exportedBy: {
      email: user?.email || null,
      role: getProfileRoleTitle(accessProfile),
    },
    kind: BACKUP_VERSION,
    selectedBusiness: businessUnit?.name || null,
    summary: {
      activeStaff: staff.filter((member) => member.active).length,
      boothRentRecords: boothRent.length,
      businessUnits: businessUnits.length,
      monthlyPerformanceRows: monthlyPerformanceSummary.length,
      payrollRuns: payrollRuns.length,
      performanceRows: performanceSummary.length,
      warnings: warnings.length,
    },
    tables: {
      appointmentDashboard: masterDashboard || null,
      appointmentDashboardUpdatedAt: masterDashboardUpdatedAt || null,
      boothRent,
      businessUnits,
      monthlyPerformanceSummary,
      payrollEntries: flattenPayrollEntries(payrollRuns),
      payrollRuns,
      performanceSummary,
      squareStatus: squareStatus || null,
      staff,
    },
  };
}

function daysSince(value, now = new Date()) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.floor((now.getTime() - parsed.getTime()) / (24 * 60 * 60 * 1000));
}

function addCheck(checks, check) {
  checks.push({
    action: null,
    detail: '',
    tone: 'muted',
    ...check,
  });
}

export function buildSystemChecks({
  accessProfile,
  boothRent = [],
  businessUnit,
  masterDashboard,
  masterDashboardUpdatedAt,
  payrollRuns = [],
  squareStatus,
  staff = [],
  warnings = [],
  now = new Date(),
}) {
  const checks = [];
  const activeStaff = staff.filter((member) => member.active);
  const openBoothRent = boothRent.filter((record) => !record.paid);
  const probationStaff = activeStaff.filter((member) => member.tier === 'probation');
  const overdueProbation = probationStaff.filter((member) => {
    const start = member.probation_start_date || member.start_date;
    const age = daysSince(start, now);
    return age !== null && age > 90;
  });

  addCheck(checks, {
    action: 'dashboard',
    detail: warnings.length
      ? `${warnings.length} data warning${warnings.length === 1 ? '' : 's'} needs review`
      : 'All core data loaded',
    label: 'Live data',
    tone: warnings.length ? 'warning' : 'success',
  });

  addCheck(checks, {
    action: 'staff',
    detail: activeStaff.length ? `${activeStaff.length} active staff profiles` : 'No active staff saved',
    label: 'Roster',
    tone: activeStaff.length ? 'success' : 'danger',
  });

  addCheck(checks, {
    action: 'staff',
    detail: overdueProbation.length
      ? `${overdueProbation.length} probation profile${overdueProbation.length === 1 ? '' : 's'} overdue`
      : probationStaff.length
        ? `${probationStaff.length} staff on probation`
        : 'No active probation profiles',
    label: 'Probation',
    tone: overdueProbation.length ? 'warning' : 'success',
  });

  if (hasModulePermission(accessProfile, 'payroll', 'view')) {
    const latestRun = payrollRuns[0];
    addCheck(checks, {
      action: 'payroll',
      detail: latestRun
        ? `${latestRun.week_label} is ${latestRun.status}`
        : 'No payroll runs saved yet',
      label: 'Payroll',
      tone: latestRun ? 'success' : 'warning',
    });
  }

  addCheck(checks, {
    action: 'booth-rent',
    detail: openBoothRent.length
      ? `${openBoothRent.length} open rent record${openBoothRent.length === 1 ? '' : 's'}`
      : 'No open rent records',
    label: 'Booth rent',
    tone: openBoothRent.length ? 'warning' : 'success',
  });

  addCheck(checks, {
    action: 'operations',
    detail: 'SOPs, forms, training, and change log available',
    label: 'Operations',
    tone: 'success',
  });

  addCheck(checks, {
    action: 'system',
    detail: 'Download JSON or CSV backups anytime',
    label: 'Backup tools',
    tone: 'success',
  });

  return checks;
}

export function buildSupportSummary(snapshot, checks) {
  return [
    `RTB OS support bundle`,
    `Exported: ${snapshot.exportedAt}`,
    `Business: ${snapshot.selectedBusiness || 'Not selected'}`,
    `User role: ${snapshot.exportedBy.role || 'unknown'}`,
    `Active staff: ${snapshot.summary.activeStaff}`,
    `Payroll runs: ${snapshot.summary.payrollRuns}`,
    `Booth rent records: ${snapshot.summary.boothRentRecords}`,
    `Performance rows: ${snapshot.summary.performanceRows}`,
    `Warnings: ${snapshot.summary.warnings}`,
    '',
    'System checks:',
    ...checks.map((check) => `- ${check.label}: ${check.detail} (${check.tone})`),
  ].join('\n');
}
