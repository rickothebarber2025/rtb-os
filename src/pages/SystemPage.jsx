import { useMemo, useState } from 'react';
import {
  Activity,
  Archive,
  ClipboardCopy,
  Database,
  Download,
  FileSpreadsheet,
  RefreshCw,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import MetricCard from '../components/MetricCard';
import ClientErrorLog from '../components/ClientErrorLog';
import StatusBadge from '../components/StatusBadge';
import { isSupabaseConfigured } from '../lib/supabaseClient';
import { getProfileRoleTitle } from '../lib/permissions.js';
import { canAccessPage } from '../utils/access';
import { formatDateTime, formatNumber } from '../utils/formatters';
import {
  buildSupportSummary,
  buildSystemChecks,
  createBackupSnapshot,
  slug,
  toCsv,
} from '../utils/systemTools';

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function tableButtonLabel(label, count) {
  return `${label} (${formatNumber(count)})`;
}

export default function SystemPage({
  accessProfile,
  businessUnit,
  businessUnits,
  masterDashboard,
  masterDashboardUpdatedAt,
  monthlyPerformanceSummary,
  onRefresh,
  payrollRuns,
  performanceSummary,
  setActivePage,
  squareStatus,
  staff,
  user,
  warnings,
}) {
  const [notice, setNotice] = useState('');
  const [lastBackupAt, setLastBackupAt] = useState(() =>
    window.localStorage.getItem('rtb-os-last-backup-at'),
  );

  const snapshot = useMemo(
    () =>
      createBackupSnapshot({
        accessProfile,
        businessUnit,
        businessUnits,
        masterDashboard,
        masterDashboardUpdatedAt,
        monthlyPerformanceSummary,
        payrollRuns,
        performanceSummary,
        squareStatus,
        staff,
        user,
        warnings,
      }),
    [
      accessProfile,
      businessUnit,
      businessUnits,
      masterDashboard,
      masterDashboardUpdatedAt,
      monthlyPerformanceSummary,
      payrollRuns,
      performanceSummary,
      squareStatus,
      staff,
      user,
      warnings,
    ],
  );

  const checks = useMemo(
    () =>
      buildSystemChecks({
        accessProfile,
        businessUnit,
        masterDashboard,
        masterDashboardUpdatedAt,
        payrollRuns,
        squareStatus,
        staff,
        warnings,
      }),
    [
      accessProfile,
      businessUnit,
      masterDashboard,
      masterDashboardUpdatedAt,
      payrollRuns,
      squareStatus,
      staff,
      warnings,
    ],
  );

  const activeStaff = staff.filter((member) => member.active);
  const warningCount = checks.filter((check) => check.tone === 'warning' || check.tone === 'danger').length;
  const businessSlug = slug(businessUnit?.name || 'rtb-os');
  const exportedAt = new Date(snapshot.exportedAt);
  const payrollEntries = snapshot.tables.payrollEntries;
  const quickActions = [
    ['staff', 'Fix roster mistake', 'Edit, deactivate, restore, delete, or move staff to probation.'],
    ['payroll', 'Correct payroll', 'Delete drafts or create a correction draft from finalized payroll.'],
    ['operations', 'Update SOPs/forms', 'Adjust workflows, checklists, templates, and change log.'],
    ['access', 'Manage access', 'Invite, revoke, restore, or change admin and manager roles.'],
  ].filter(([page]) => canAccessPage(accessProfile, page));

  const csvExports = [
    {
      filename: `${businessSlug}-staff.csv`,
      label: 'Roster',
      rows: staff.map((member) => ({
        active: member.active,
        commission_rate: member.commission_rate,
        email: member.email,
        fixed_rate: member.fixed_rate,
        full_name: member.full_name,
        phone: member.phone,
        role: member.role,
        start_date: member.start_date,
        tier: member.tier,
      })),
    },
    {
      filename: `${businessSlug}-payroll-runs.csv`,
      label: 'Payroll runs',
      rows: payrollRuns.map((run) => ({
        corrected_from_run_id: run.corrected_from_run_id,
        created_at: run.created_at,
        notes: run.notes,
        rtb_net: run.rtb_net,
        status: run.status,
        total_deductions: run.total_deductions,
        total_net_sales: run.total_net_sales,
        total_staff_payout: run.total_staff_payout,
        week_label: run.week_label,
      })),
    },
    {
      filename: `${businessSlug}-payroll-entries.csv`,
      label: 'Payroll entries',
      rows: payrollEntries,
    },
    {
      filename: `${businessSlug}-performance.csv`,
      label: 'Performance',
      rows: performanceSummary,
    },
    {
      filename: `${businessSlug}-monthly-performance.csv`,
      label: 'Monthly performance',
      rows: monthlyPerformanceSummary,
    },
  ];

  function downloadBackup() {
    downloadFile(
      `${businessSlug}-backup-${snapshot.exportedAt.slice(0, 10)}.json`,
      JSON.stringify(snapshot, null, 2),
      'application/json',
    );
    window.localStorage.setItem('rtb-os-last-backup-at', snapshot.exportedAt);
    setLastBackupAt(snapshot.exportedAt);
    setNotice('Full backup downloaded.');
  }

  function downloadCsvExport(exportItem) {
    downloadFile(exportItem.filename, toCsv(exportItem.rows), 'text/csv;charset=utf-8');
    setNotice(`${exportItem.label} CSV downloaded.`);
  }

  async function copySupportBundle() {
    if (!navigator.clipboard?.writeText) {
      setNotice('Clipboard access is not available in this browser.');
      return;
    }

    await navigator.clipboard.writeText(buildSupportSummary(snapshot, checks));
    setNotice('Support summary copied.');
  }

  return (
    <div className="page-grid system-page">
      <section className="hero-panel full-span">
        <div>
          <h2>System tools</h2>
          <p>
            Health checks, backups, exports, and quick recovery shortcuts for the live RTB OS
            platform.
          </p>
        </div>
        <div className="action-row">
          <button className="secondary-button" type="button" onClick={onRefresh}>
            <RefreshCw size={16} />
            Refresh
          </button>
          <button className="primary-button" type="button" onClick={downloadBackup}>
            <Archive size={16} />
            Full backup
          </button>
        </div>
      </section>

      {notice ? <div className="alert success full-span">{notice}</div> : null}

      <section className="metrics-grid">
        <MetricCard
          icon={Activity}
          label="Health alerts"
          trend={warningCount ? 'Needs review' : 'Ready'}
          value={warningCount}
        />
        <MetricCard
          icon={ShieldCheck}
          label="Current access"
          trend={user?.email || 'Signed in'}
          value={getProfileRoleTitle(accessProfile)}
        />
        <MetricCard
          icon={Database}
          label="Supabase"
          trend={businessUnit?.name || 'No business selected'}
          value={isSupabaseConfigured ? 'Live' : 'Missing'}
        />
        <MetricCard
          icon={Archive}
          label="Last backup"
          trend={lastBackupAt ? formatDateTime(lastBackupAt) : 'Download one now'}
          value={lastBackupAt ? 'Saved' : 'None'}
        />
      </section>

      <section className="panel full-span">
        <div className="section-header">
          <div>
            <span>Live readiness</span>
            <h2>System health checks</h2>
          </div>
          <StatusBadge tone={warningCount ? 'warning' : 'success'}>
            {warningCount ? `${warningCount} review` : 'Ready'}
          </StatusBadge>
        </div>
        <div className="system-check-grid">
          {checks.map((check) => (
            <button
              className={`system-check-card ${check.tone}`}
              key={check.label}
              type="button"
              onClick={() => check.action && setActivePage(check.action)}
            >
              <strong>{check.label}</strong>
              <span>{check.detail}</span>
            </button>
          ))}
        </div>
      </section>

      <ClientErrorLog />

      <section className="panel two-thirds">
        <div className="section-header">
          <div>
            <span>Recovery</span>
            <h2>Backups and exports</h2>
          </div>
        </div>
        <p className="subtle-text">
          Use the full backup before big cleanup work. Use CSV exports when you want a spreadsheet
          copy for payroll, staff, or performance records.
        </p>
        <div className="system-export-grid">
          <button className="primary-button" type="button" onClick={downloadBackup}>
            <Download size={16} />
            Full JSON backup
          </button>
          {csvExports.map((exportItem) => (
            <button
              className="ghost-button"
              disabled={!exportItem.rows.length}
              key={exportItem.label}
              type="button"
              onClick={() => downloadCsvExport(exportItem)}
            >
              <FileSpreadsheet size={16} />
              {tableButtonLabel(exportItem.label, exportItem.rows.length)}
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="section-header">
          <div>
            <span>Support</span>
            <h2>Troubleshooting bundle</h2>
          </div>
        </div>
        <div className="system-summary">
          <div>
            <span>Export time</span>
            <strong>{formatDateTime(exportedAt)}</strong>
          </div>
          <div>
            <span>Active staff</span>
            <strong>{formatNumber(activeStaff.length)}</strong>
          </div>
          <div>
            <span>Payroll runs</span>
            <strong>{formatNumber(payrollRuns.length)}</strong>
          </div>
          <div>
            <span>Warnings</span>
            <strong>{formatNumber(warnings.length)}</strong>
          </div>
        </div>
        <button className="secondary-button full-width" type="button" onClick={copySupportBundle}>
          <ClipboardCopy size={16} />
          Copy support summary
        </button>
      </section>

      <section className="panel full-span">
        <div className="section-header">
          <div>
            <span>Fix common issues</span>
            <h2>Quick recovery links</h2>
          </div>
        </div>
        <div className="system-action-grid">
          {quickActions.map(([page, title, detail]) => (
            <button
              className="system-action-card"
              key={page}
              type="button"
              onClick={() => setActivePage(page)}
            >
              <Wrench size={18} />
              <span>
                <strong>{title}</strong>
                <small>{detail}</small>
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
