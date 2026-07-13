import { useMemo, useState } from 'react';
import {
  BadgeCheck,
  BriefcaseBusiness,
  CalendarDays,
  CircleDollarSign,
  ClipboardCheck,
  TrendingUp,
  UserRound,
  WalletCards,
} from 'lucide-react';
import DataTable from '../components/DataTable';
import EmptyState from '../components/EmptyState';
import MetricCard from '../components/MetricCard';
import StatusBadge from '../components/StatusBadge';
import { formatCurrency, formatDate, formatNumber } from '../utils/formatters';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'earnings', label: 'Earnings' },
  { id: 'performance', label: 'Performance' },
  { id: 'profile', label: 'Profile' },
];

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function getEntryWeekTime(entry) {
  return new Date(entry.week_start || entry.created_at || 0).getTime();
}

function getRunEntryRows(payrollRuns) {
  return payrollRuns.flatMap((run) =>
    (run.payroll_entries || []).map((entry) => ({
      ...entry,
      run_status: run.status,
      week_end: run.week_end,
      week_label: run.week_label,
      week_start: run.week_start,
    })),
  );
}

function findStaffProfile({ accessProfile, staff, user }) {
  const email = normalize(accessProfile?.email || user?.email);
  const displayName = normalize(accessProfile?.full_name || user?.user_metadata?.full_name);

  return (
    staff.find((member) => normalize(member.email) === email) ||
    staff.find((member) => normalize(member.full_name) === displayName) ||
    null
  );
}

function entryBelongsToStaff(entry, staffProfile) {
  if (!staffProfile) return false;
  return (
    (entry.staff_id && entry.staff_id === staffProfile.id) ||
    normalize(entry.staff_name_snapshot) === normalize(staffProfile.full_name)
  );
}

function rowBelongsToStaff(row, staffProfile) {
  if (!staffProfile) return false;
  return (
    (row.staff_id && row.staff_id === staffProfile.id) ||
    normalize(row.full_name) === normalize(staffProfile.full_name)
  );
}

function sum(rows, field) {
  return rows.reduce((total, row) => total + Number(row[field] || 0), 0);
}

function getRank(performanceSummary, staffProfile) {
  if (!staffProfile) return null;
  const sorted = [...performanceSummary].sort(
    (a, b) => Number(b.total_net_sales || 0) - Number(a.total_net_sales || 0),
  );
  const index = sorted.findIndex((row) => rowBelongsToStaff(row, staffProfile));
  return index >= 0 ? index + 1 : null;
}

export default function StaffHubPage({
  accessProfile,
  businessUnit,
  navItems,
  payrollRuns,
  performanceSummary,
  setActivePage,
  staff,
  user,
}) {
  const [activeTab, setActiveTab] = useState('overview');
  const staffProfile = useMemo(
    () => findStaffProfile({ accessProfile, staff, user }),
    [accessProfile, staff, user],
  );
  const allowedPageIds = useMemo(() => new Set(navItems.map((item) => item.id)), [navItems]);
  const ownEntries = useMemo(
    () =>
      getRunEntryRows(payrollRuns)
        .filter((entry) => entryBelongsToStaff(entry, staffProfile))
        .sort((a, b) => getEntryWeekTime(b) - getEntryWeekTime(a)),
    [payrollRuns, staffProfile],
  );
  const ownPerformance = useMemo(
    () => performanceSummary.find((row) => rowBelongsToStaff(row, staffProfile)) || null,
    [performanceSummary, staffProfile],
  );
  const totalTakeHome = sum(ownEntries, 'take_home');
  const totalTips = sum(ownEntries, 'tips');
  const latestEntry = ownEntries[0] || null;
  const rank = getRank(performanceSummary, staffProfile);
  const canOpen = (pageId) => allowedPageIds.has(pageId);

  function openPage(pageId) {
    if (canOpen(pageId)) setActivePage(pageId);
  }

  return (
    <div className="page-grid staff-hub-page">
      <section className="hero-panel full-span staff-hub-hero">
        <div>
          <span className="eyebrow">Staff Hub</span>
          <h2>{accessProfile?.full_name || user?.email || 'My Staff Account'}</h2>
          <p>
            Weekly earnings, performance, role details, and business updates for{' '}
            {businessUnit?.name || 'your assigned RTB business'}.
          </p>
        </div>
        <div className="staff-hub-identity">
          <UserRound size={22} />
          <strong>{staffProfile?.full_name || 'Profile not matched'}</strong>
          <span>{staffProfile?.role || accessProfile?.role_title || 'Staff'}</span>
        </div>
      </section>

      {!staffProfile ? (
        <section className="panel full-span">
          <div className="alert warning">
            <strong>No roster profile matched this login.</strong>
            <span>
              Ask an access admin to connect this login email to the correct staff profile so
              earnings and performance can be shown here.
            </span>
          </div>
        </section>
      ) : null}

      <section className="metrics-grid full-span">
        <MetricCard
          icon={WalletCards}
          label="Latest take-home"
          trend={latestEntry?.week_label || 'No payroll entry yet'}
          value={formatCurrency(latestEntry?.take_home)}
        />
        <MetricCard
          icon={CircleDollarSign}
          label="Total take-home"
          trend={`${formatNumber(ownEntries.length)} recorded weeks`}
          value={formatCurrency(totalTakeHome)}
        />
        <MetricCard
          icon={TrendingUp}
          label="Recorded sales"
          trend={ownPerformance ? `${ownPerformance.weeks_recorded || 0} performance weeks` : 'No saved performance'}
          value={formatCurrency(ownPerformance?.total_net_sales)}
        />
        <MetricCard
          icon={BadgeCheck}
          label="Business rank"
          trend={businessUnit?.name || 'Assigned business'}
          value={rank ? `#${rank}` : 'N/A'}
        />
      </section>

      <section className="panel full-span">
        <div className="staff-hub-tabs" role="tablist" aria-label="Staff Hub sections">
          {TABS.map((tab) => (
            <button
              aria-selected={activeTab === tab.id}
              className={activeTab === tab.id ? 'active' : ''}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      {activeTab === 'overview' ? (
        <>
          <section className="panel two-thirds">
            <div className="section-header">
              <div>
                <span>Start here</span>
                <h2>Common staff actions</h2>
              </div>
              <ClipboardCheck size={20} />
            </div>
            <div className="staff-hub-actions">
              <button
                className="secondary-button"
                disabled={!canOpen('my-role')}
                onClick={() => openPage('my-role')}
                type="button"
              >
                <BriefcaseBusiness size={17} />
                My role
              </button>
              <button
                className="secondary-button"
                disabled={!canOpen('performance')}
                onClick={() => openPage('performance')}
                type="button"
              >
                <TrendingUp size={17} />
                Performance
              </button>
              <button
                className="secondary-button"
                disabled={!canOpen('payroll')}
                onClick={() => openPage('payroll')}
                type="button"
              >
                <CircleDollarSign size={17} />
                Payroll history
              </button>
              <button
                className="secondary-button"
                disabled={!canOpen('operations')}
                onClick={() => openPage('operations')}
                type="button"
              >
                <ClipboardCheck size={17} />
                Operations
              </button>
            </div>
          </section>

          <section className="panel">
            <div className="section-header">
              <div>
                <span>Account</span>
                <h2>Assigned business</h2>
              </div>
              <StatusBadge tone={staffProfile?.active ? 'success' : 'muted'}>
                {staffProfile?.active ? 'Active' : 'Inactive'}
              </StatusBadge>
            </div>
            <div className="role-summary-list compact">
              <div>
                <span>Business</span>
                <strong>{businessUnit?.name || staffProfile?.primary_business_name || 'Not set'}</strong>
              </div>
              <div>
                <span>Email</span>
                <strong>{staffProfile?.email || accessProfile?.email || 'Not set'}</strong>
              </div>
              <div>
                <span>Commission</span>
                <strong>{staffProfile?.fixed_rate ? 'Fixed rate' : `${staffProfile?.commission_rate || 0}%`}</strong>
              </div>
            </div>
          </section>
        </>
      ) : null}

      {activeTab === 'earnings' ? (
        <section className="panel full-span">
          <div className="section-header">
            <div>
              <span>Weekly earnings</span>
              <h2>My payroll entries</h2>
            </div>
            <StatusBadge tone={ownEntries.length ? 'success' : 'muted'}>
              {ownEntries.length ? `${ownEntries.length} weeks` : 'No entries'}
            </StatusBadge>
          </div>
          {ownEntries.length ? (
            <DataTable>
              <table>
                <thead>
                  <tr>
                    <th>Week</th>
                    <th>Status</th>
                    <th>Sales</th>
                    <th>Tips</th>
                    <th>Commission</th>
                    <th>Take-home</th>
                  </tr>
                </thead>
                <tbody>
                  {ownEntries.map((entry) => (
                    <tr key={`${entry.payroll_run_id || entry.week_label}-${entry.id || entry.staff_name_snapshot}`}>
                      <td>
                        <strong>{entry.week_label || formatDate(entry.week_start)}</strong>
                      </td>
                      <td>
                        <StatusBadge tone={entry.run_status === 'draft' ? 'warning' : 'success'}>
                          {entry.run_status || 'saved'}
                        </StatusBadge>
                      </td>
                      <td>{formatCurrency(entry.net_sales)}</td>
                      <td>{formatCurrency(entry.tips)}</td>
                      <td>{entry.applied_commission_rate || entry.base_commission_rate || 0}%</td>
                      <td>
                        <strong>{formatCurrency(entry.take_home)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DataTable>
          ) : (
            <EmptyState
              icon={CircleDollarSign}
              title="No payroll entries yet"
              message="Finalized payroll entries connected to your staff profile will show here."
            />
          )}
          {ownEntries.length ? (
            <div className="staff-hub-total">
              <span>Total tips: {formatCurrency(totalTips)}</span>
              <strong>Total take-home: {formatCurrency(totalTakeHome)}</strong>
            </div>
          ) : null}
        </section>
      ) : null}

      {activeTab === 'performance' ? (
        <section className="panel full-span">
          <div className="section-header">
            <div>
              <span>Performance</span>
              <h2>My performance summary</h2>
            </div>
            {rank ? <StatusBadge tone="gold">Rank #{rank}</StatusBadge> : null}
          </div>
          {ownPerformance ? (
            <div className="staff-hub-performance-grid">
              <div>
                <span>Total sales</span>
                <strong>{formatCurrency(ownPerformance.total_net_sales)}</strong>
              </div>
              <div>
                <span>Average week</span>
                <strong>{formatCurrency(ownPerformance.avg_weekly_net)}</strong>
              </div>
              <div>
                <span>Best week</span>
                <strong>{formatCurrency(ownPerformance.best_week_net)}</strong>
              </div>
              <div>
                <span>Weeks recorded</span>
                <strong>{formatNumber(ownPerformance.weeks_recorded)}</strong>
              </div>
              <div>
                <span>Under minimum</span>
                <strong>{formatNumber(ownPerformance.under_minimum_weeks)}</strong>
              </div>
              <div>
                <span>Total take-home</span>
                <strong>{formatCurrency(ownPerformance.total_take_home)}</strong>
              </div>
            </div>
          ) : (
            <EmptyState
              icon={TrendingUp}
              title="No performance summary yet"
              message="Saved performance data connected to your staff profile will show here."
            />
          )}
        </section>
      ) : null}

      {activeTab === 'profile' ? (
        <section className="panel full-span">
          <div className="section-header">
            <div>
              <span>Profile</span>
              <h2>My staff record</h2>
            </div>
            <CalendarDays size={20} />
          </div>
          <div className="staff-hub-profile-grid">
            <div>
              <span>Name</span>
              <strong>{staffProfile?.full_name || accessProfile?.full_name || 'Not set'}</strong>
            </div>
            <div>
              <span>Role</span>
              <strong>{staffProfile?.role || accessProfile?.role || 'Staff'}</strong>
            </div>
            <div>
              <span>Start date</span>
              <strong>{formatDate(staffProfile?.start_date)}</strong>
            </div>
            <div>
              <span>Phone</span>
              <strong>{staffProfile?.phone || 'Not set'}</strong>
            </div>
            <div>
              <span>Instagram</span>
              <strong>{staffProfile?.instagram_handle || 'Not set'}</strong>
            </div>
            <div>
              <span>Booking profile</span>
              <strong>{staffProfile?.booking_platform_profile || 'Not set'}</strong>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
