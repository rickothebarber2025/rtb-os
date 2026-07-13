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
import { isOwnerProfile } from '../lib/permissions';
import { getBusinessProfile, isAllBusinessesUnit } from '../utils/businessProfiles';
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
  businessUnits,
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
  const ownerView = isOwnerProfile(accessProfile);
  const allBusinessesView = isAllBusinessesUnit(businessUnit);
  const businessProfile = getBusinessProfile(businessUnit);
  const activeStaffCount = staff.filter((member) => member.active).length;
  const allowedPageIds = useMemo(() => new Set(navItems.map((item) => item.id)), [navItems]);
  const businessCards = useMemo(() => {
    const units = allBusinessesView ? businessUnits : businessUnits?.filter((unit) => unit.id === businessUnit?.id);
    return (units || []).map((unit) => {
      const profile = getBusinessProfile(unit);
      const assignedStaff = staff.filter((member) => member.business_unit_id === unit.id);
      return {
        activeStaff: assignedStaff.filter((member) => member.active).length,
        id: unit.id,
        logoUrl: profile.logo_url,
        name: unit.name,
        platform: profile.booking_platform,
        type: profile.business_type,
      };
    });
  }, [allBusinessesView, businessUnit?.id, businessUnits, staff]);
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
  const performanceTotal = sum(performanceSummary, 'total_net_sales');
  const canOpen = (pageId) => allowedPageIds.has(pageId);
  const profileName = staffProfile?.full_name || accessProfile?.full_name || user?.email || 'My Staff Account';
  const portalMode = staffProfile ? 'My staff portal' : ownerView ? 'Staff portal preview' : 'Staff access setup needed';

  function openPage(pageId) {
    if (canOpen(pageId)) setActivePage(pageId);
  }

  return (
    <div className="page-grid staff-hub-page">
      <section className="hero-panel full-span staff-hub-hero">
        <div className="staff-hub-brand-lockup">
          <div className="staff-hub-logo">
            <img src={businessProfile.logo_url} alt="" />
          </div>
          <div>
            <span className="eyebrow">{portalMode}</span>
            <h2>{profileName}</h2>
            <p>
              A focused staff workspace for earnings, performance, schedule readiness, and assigned
              business updates.
            </p>
          </div>
        </div>
        <div className="staff-hub-account-card">
          <div className="staff-hub-account-card__top">
            <UserRound size={18} />
            <StatusBadge tone={staffProfile?.active || ownerView ? 'success' : 'warning'}>
              {staffProfile?.active ? 'Active' : ownerView ? 'Owner preview' : 'Needs match'}
            </StatusBadge>
          </div>
          <strong>{staffProfile?.role || accessProfile?.role_title || 'Staff'}</strong>
          <span>{businessUnit?.name || staffProfile?.primary_business_name || 'Assigned business'}</span>
        </div>
      </section>

      {!staffProfile && !ownerView ? (
        <section className="panel full-span staff-hub-alert-panel">
          <div className="alert warning">
            <strong>No roster profile matched this login.</strong>
            <span>
              Ask an access admin to connect this login email to the correct staff profile so
              earnings and performance can be shown here.
            </span>
          </div>
        </section>
      ) : null}

      {ownerView && !staffProfile ? (
        <section className="panel full-span staff-hub-alert-panel">
          <div className="alert success">
            <strong>You are viewing the staff portal as the owner.</strong>
            <span>
              Staff will see their own earnings and performance after their login email is matched
              to a roster profile in Access and Roster.
            </span>
          </div>
        </section>
      ) : null}

      <section className="metrics-grid full-span">
        <MetricCard
          icon={WalletCards}
          label={staffProfile ? 'Latest take-home' : 'Active staff'}
          trend={staffProfile ? latestEntry?.week_label || 'No payroll entry yet' : 'Across selected view'}
          value={staffProfile ? formatCurrency(latestEntry?.take_home) : formatNumber(activeStaffCount)}
        />
        <MetricCard
          icon={CircleDollarSign}
          label={staffProfile ? 'Total take-home' : 'Payroll runs'}
          trend={staffProfile ? `${formatNumber(ownEntries.length)} recorded weeks` : 'Saved payroll history'}
          value={staffProfile ? formatCurrency(totalTakeHome) : formatNumber(payrollRuns.length)}
        />
        <MetricCard
          icon={TrendingUp}
          label={staffProfile ? 'Recorded sales' : 'Recorded sales'}
          trend={ownPerformance ? `${ownPerformance.weeks_recorded || 0} performance weeks` : 'Performance summary'}
          value={formatCurrency(staffProfile ? ownPerformance?.total_net_sales : performanceTotal)}
        />
        <MetricCard
          icon={BadgeCheck}
          label={staffProfile ? 'Business rank' : 'Businesses'}
          trend={businessUnit?.name || 'Assigned business'}
          value={staffProfile ? (rank ? `#${rank}` : 'N/A') : formatNumber(businessCards.length)}
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
          <section className="panel two-thirds staff-hub-overview-panel">
            <div className="section-header">
              <div>
                <span>{ownerView && !staffProfile ? 'Setup' : 'Start here'}</span>
                <h2>{ownerView && !staffProfile ? 'Staff portal controls' : 'Common staff actions'}</h2>
              </div>
              <ClipboardCheck size={20} />
            </div>
            <div className="staff-hub-actions">
              <button
                className="secondary-button"
                disabled={!canOpen(ownerView && !staffProfile ? 'access' : 'my-role')}
                onClick={() => openPage(ownerView && !staffProfile ? 'access' : 'my-role')}
                type="button"
              >
                <BriefcaseBusiness size={17} />
                {ownerView && !staffProfile ? 'Access' : 'My role'}
              </button>
              <button
                className="secondary-button"
                disabled={!canOpen(ownerView && !staffProfile ? 'staff' : 'performance')}
                onClick={() => openPage(ownerView && !staffProfile ? 'staff' : 'performance')}
                type="button"
              >
                {ownerView && !staffProfile ? <UserRound size={17} /> : <TrendingUp size={17} />}
                {ownerView && !staffProfile ? 'Roster' : 'Performance'}
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
            {businessCards.length ? (
              <div className="staff-hub-business-grid">
                {businessCards.map((card) => (
                  <article className="staff-hub-business-card" key={card.id}>
                    <img src={card.logoUrl} alt="" />
                    <div>
                      <strong>{card.name}</strong>
                      <span>{card.type}</span>
                    </div>
                    <small>
                      {formatNumber(card.activeStaff)} active staff · {card.platform}
                    </small>
                  </article>
                ))}
              </div>
            ) : null}
          </section>

          <section className="panel staff-hub-assignment-panel">
            <div className="section-header">
              <div>
                <span>Account</span>
                <h2>{ownerView && !staffProfile ? 'Business assignment rules' : 'Assigned business'}</h2>
              </div>
              <StatusBadge tone={staffProfile?.active || ownerView ? 'success' : 'muted'}>
                {staffProfile?.active ? 'Active' : ownerView ? 'Ready' : 'Inactive'}
              </StatusBadge>
            </div>
            <div className="role-summary-list compact">
              <div>
                <span>Business</span>
                <strong>
                  {ownerView && !staffProfile
                    ? allBusinessesView
                      ? 'Staff see only assigned businesses'
                      : businessUnit?.name
                    : businessUnit?.name || staffProfile?.primary_business_name || 'Not set'}
                </strong>
              </div>
              <div>
                <span>Email</span>
                <strong>{staffProfile?.email || accessProfile?.email || 'Not set'}</strong>
              </div>
              <div>
                <span>Commission</span>
                <strong>
                  {staffProfile
                    ? staffProfile.fixed_rate
                      ? 'Fixed rate'
                      : `${staffProfile.commission_rate || 0}%`
                    : 'Set per roster profile'}
                </strong>
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
