import { useMemo, useState } from 'react';
import {
  BadgeCheck,
  Bell,
  BookOpen,
  BriefcaseBusiness,
  CalendarDays,
  Camera,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  FileText,
  Megaphone,
  ShieldCheck,
  TrendingUp,
  UserRound,
  WalletCards,
} from 'lucide-react';
import DataTable from '../components/DataTable';
import EmptyState from '../components/EmptyState';
import MetricCard from '../components/MetricCard';
import StatusBadge from '../components/StatusBadge';
import { isOwnerProfile } from '../lib/permissions';
import { normalizeActionCenterState } from '../utils/actionCenter';
import { getBusinessProfile, isAllBusinessesUnit } from '../utils/businessProfiles';
import { formatCurrency, formatDate, formatDateTime, formatNumber } from '../utils/formatters';

const TABS = [
  { id: 'home', label: 'Home' },
  { id: 'money', label: 'Money' },
  { id: 'stats', label: 'Stats' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'more', label: 'More' },
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

function getRows(rows) {
  return Array.isArray(rows) ? rows : [];
}

function initials(name = '') {
  const parts = String(name)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return `${parts[0]?.[0] || 'R'}${parts.length > 1 ? parts[parts.length - 1][0] : ''}`.toUpperCase();
}

function getProfilePhoto(staffProfile, user) {
  return (
    staffProfile?.photo_url ||
    staffProfile?.avatar_url ||
    user?.user_metadata?.avatar_url ||
    user?.user_metadata?.picture ||
    ''
  );
}

function getDashboardScheduleRows(masterDashboard) {
  return [
    ...getRows(masterDashboard?.upcomingAppointments).map((row) => ({ ...row, schedule_type: 'Upcoming' })),
    ...getRows(masterDashboard?.recentTransactions).map((row) => ({ ...row, schedule_type: 'Recent' })),
  ];
}

function scheduleBelongsToStaff(row, staffProfile) {
  if (!staffProfile) return false;
  const staffName = normalize(row.staffer || row.staff || row.staff_name || row.team_member);
  const profileName = normalize(staffProfile.full_name);
  if (!staffName || !profileName) return false;
  return staffName === profileName || staffName.includes(profileName) || profileName.includes(staffName);
}

function manualRecordBelongsToStaff(record, staffProfile) {
  if (!staffProfile) return false;
  return (
    (record.staff_id && record.staff_id === staffProfile.id) ||
    normalize(record.staff_name) === normalize(staffProfile.full_name)
  );
}

function getStaffActionItems(actionCenter, staffProfile, ownerView) {
  const state = normalizeActionCenterState(actionCenter);
  const warnings = state.warnings
    .filter((warning) => !warning.resolved_at)
    .filter((warning) => ownerView || manualRecordBelongsToStaff(warning, staffProfile))
    .map((warning) => ({
      date: warning.date || warning.created_at,
      detail: warning.notes || warning.warning_type || 'Staff warning needs review.',
      id: `warning-${warning.id}`,
      label: 'Warning',
      tone: 'warning',
    }));
  const documents = state.documents
    .filter((document) => !document.resolved_at)
    .filter((document) => ownerView || manualRecordBelongsToStaff(document, staffProfile))
    .map((document) => ({
      date: document.due_date || document.created_at,
      detail: `${document.document_name || 'Document'}${document.staff_name ? ` for ${document.staff_name}` : ''}`,
      id: `document-${document.id}`,
      label: 'Document',
      tone: 'danger',
    }));

  return [...documents, ...warnings].slice(0, 4);
}

export default function StaffHubPage({
  actionCenter,
  accessProfile,
  businessUnit,
  businessUnits,
  masterDashboard,
  masterDashboardUpdatedAt,
  navItems,
  payrollRuns,
  performanceSummary,
  setActivePage,
  staff,
  user,
}) {
  const [activeTab, setActiveTab] = useState('home');
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
  const scheduleRows = useMemo(
    () =>
      getDashboardScheduleRows(masterDashboard)
        .filter((row) => ownerView || scheduleBelongsToStaff(row, staffProfile))
        .slice(0, 8),
    [masterDashboard, ownerView, staffProfile],
  );
  const actionItems = useMemo(
    () => getStaffActionItems(actionCenter, staffProfile, ownerView),
    [actionCenter, ownerView, staffProfile],
  );
  const totalTakeHome = sum(ownEntries, 'take_home');
  const totalTips = sum(ownEntries, 'tips');
  const latestEntry = ownEntries[0] || null;
  const rank = getRank(performanceSummary, staffProfile);
  const performanceTotal = sum(performanceSummary, 'total_net_sales');
  const canOpen = (pageId) => allowedPageIds.has(pageId);
  const profileName = staffProfile?.full_name || accessProfile?.full_name || user?.email || 'My Staff Account';
  const portalMode = staffProfile ? 'My staff portal' : ownerView ? 'Staff portal preview' : 'Staff access setup needed';
  const profilePhoto = getProfilePhoto(staffProfile, user);
  const firstName = String(profileName).split(/\s+/)[0] || 'there';
  const quickTools = [
    {
      description: 'Role, tier, expectations, and probation status',
      icon: BriefcaseBusiness,
      id: ownerView && !staffProfile ? 'access' : 'my-role',
      label: ownerView && !staffProfile ? 'Access setup' : 'My role',
    },
    {
      description: 'Weekly earnings and payroll history',
      icon: CircleDollarSign,
      id: 'payroll',
      label: 'Payroll history',
    },
    {
      description: 'Sales, rank, goals, and client performance',
      icon: TrendingUp,
      id: 'performance',
      label: 'Performance',
    },
    {
      description: 'Imported appointments and schedule data',
      icon: CalendarDays,
      id: 'insights',
      label: 'Schedule',
    },
  ];
  const moreOptions = [
    {
      description: 'Opening, closing, policies, forms, and operating standards',
      icon: BookOpen,
      id: 'operations',
      label: 'Policies & training',
    },
    {
      description: 'Warnings, missing documents, and follow-up items',
      icon: Bell,
      id: 'action-center',
      label: 'Alerts',
    },
    {
      description: 'Client signals and content ideas from customer trends',
      icon: Camera,
      id: 'customer-intelligence',
      label: 'Content center',
    },
    {
      description: 'Staff profiles, commission levels, assignments, and status',
      icon: UserRound,
      id: 'staff',
      label: 'Team',
    },
    {
      description: 'Invite staff and control what each person can access',
      icon: ShieldCheck,
      id: 'access',
      label: 'Access',
    },
    {
      description: 'Imported reports, diagnostics, and export tools',
      icon: FileText,
      id: 'system',
      label: 'System tools',
    },
  ];

  function openPage(pageId) {
    if (canOpen(pageId)) setActivePage(pageId);
  }

  return (
    <div className="page-grid staff-hub-page">
      <section className="hero-panel full-span staff-hub-hero">
        <div className="staff-hub-brand-lockup">
          <div className="staff-hub-logo-stack">
            <div className="staff-hub-logo">
              <img src={businessProfile.logo_url} alt="" />
            </div>
            <div className="staff-hub-avatar" aria-label={profileName}>
              {profilePhoto ? <img src={profilePhoto} alt="" /> : <span>{initials(profileName)}</span>}
            </div>
          </div>
          <div>
            <span className="eyebrow">{portalMode}</span>
            <h2>Hey {firstName}</h2>
            <p>
              Earnings, performance, schedule, alerts, and business resources for{' '}
              {businessUnit?.name || staffProfile?.primary_business_name || 'your assigned business'}.
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

      {activeTab === 'home' ? (
        <>
          <section className="panel two-thirds staff-hub-overview-panel">
            <div className="section-header">
              <div>
                <span>{ownerView && !staffProfile ? 'Setup' : 'Today'}</span>
                <h2>{ownerView && !staffProfile ? 'Staff portal controls' : 'Staff home'}</h2>
              </div>
              <Megaphone size={20} />
            </div>
            <div className="staff-hub-action-grid">
              {quickTools.map((tool) => {
                const Icon = tool.icon;
                return (
                  <button
                    className="staff-hub-tool"
                    disabled={!canOpen(tool.id)}
                    key={tool.label}
                    onClick={() => openPage(tool.id)}
                    type="button"
                  >
                    <Icon size={17} />
                    <span>
                      <strong>{tool.label}</strong>
                      <small>{tool.description}</small>
                    </span>
                    <ChevronRight size={16} />
                  </button>
                );
              })}
            </div>
            {actionItems.length ? (
              <div className="staff-hub-preview-list">
                <div className="staff-hub-preview-list__header">
                  <strong>Needs attention</strong>
                  <button type="button" onClick={() => openPage('action-center')} disabled={!canOpen('action-center')}>
                    View all
                  </button>
                </div>
                {actionItems.map((item) => (
                  <article className="staff-hub-alert-row" key={item.id}>
                    <StatusBadge tone={item.tone}>{item.label}</StatusBadge>
                    <span>{item.detail}</span>
                    <small>{formatDate(item.date)}</small>
                  </article>
                ))}
              </div>
            ) : null}
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

      {activeTab === 'money' ? (
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

      {activeTab === 'stats' ? (
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

      {activeTab === 'schedule' ? (
        <section className="panel full-span">
          <div className="section-header">
            <div>
              <span>Schedule</span>
              <h2>My appointments</h2>
            </div>
            <StatusBadge tone={scheduleRows.length ? 'success' : 'muted'}>
              {scheduleRows.length ? `${scheduleRows.length} rows` : 'No imported rows'}
            </StatusBadge>
          </div>
          {masterDashboardUpdatedAt ? (
            <p className="staff-hub-import-note">
              Last appointment import: {formatDateTime(masterDashboardUpdatedAt)}
            </p>
          ) : null}
          {scheduleRows.length ? (
            <DataTable>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Client</th>
                    <th>Service</th>
                    <th>Staff</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {scheduleRows.map((row, index) => (
                    <tr key={`${row.date || row.created_at || index}-${row.client || row.service || index}`}>
                      <td>
                        <strong>{row.date || formatDate(row.created_at)}</strong>
                        <span className="table-subtext">{row.schedule_type}</span>
                      </td>
                      <td>{row.client || row.customer || 'Not listed'}</td>
                      <td>{row.service || row.item || 'Service'}</td>
                      <td>{row.staffer || row.staff || row.staff_name || 'Team'}</td>
                      <td>{row.amount ? formatCurrency(row.amount) : 'Not set'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DataTable>
          ) : (
            <EmptyState
              icon={Clock3}
              title="No schedule rows for this profile yet"
              message="Imported Booksy or Square appointment data connected to this staff profile will show here."
            />
          )}
        </section>
      ) : null}

      {activeTab === 'more' ? (
        <>
          <section className="panel two-thirds">
            <div className="section-header">
              <div>
                <span>More</span>
                <h2>Staff tools and resources</h2>
              </div>
              <ClipboardCheck size={20} />
            </div>
            <div className="staff-hub-more-grid">
              {moreOptions.map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    className="staff-hub-more-card"
                    disabled={!canOpen(option.id)}
                    key={option.label}
                    onClick={() => openPage(option.id)}
                    type="button"
                  >
                    <Icon size={18} />
                    <span>
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                    </span>
                    <ChevronRight size={16} />
                  </button>
                );
              })}
            </div>
          </section>

          <section className="panel">
            <div className="section-header">
              <div>
                <span>Profile</span>
                <h2>My staff record</h2>
              </div>
              <CalendarDays size={20} />
            </div>
            <div className="staff-hub-profile-grid compact">
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
                <strong>{staffProfile?.instagram_handle || staffProfile?.social_handle || 'Not set'}</strong>
              </div>
              <div>
                <span>Booking profile</span>
                <strong>{staffProfile?.booking_platform_profile || 'Not set'}</strong>
              </div>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
