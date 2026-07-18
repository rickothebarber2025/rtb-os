import {
  AlertCircle,
  AlertTriangle,
  BadgeDollarSign,
  BellRing,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  ReceiptText,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import DataTable from '../components/DataTable';
import EmptyState from '../components/EmptyState';
import MetricCard from '../components/MetricCard';
import StatusBadge from '../components/StatusBadge';
import { buildActionCenterItems, getActionCenterSummary, getPriorityIcon } from '../utils/actionCenter';
import { canManagePayroll, canUsePayroll } from '../utils/access';
import { getBusinessProfile, isAllBusinessesUnit } from '../utils/businessProfiles';
import {
  formatCompactCurrency,
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercent,
} from '../utils/formatters';
import { buildOperationalChecks } from '../utils/operations';
import { buildRoleWorkspace } from '../utils/workspaces';

const OPERATION_ICONS = {
  danger: AlertCircle,
  muted: Clock3,
  success: CheckCircle2,
  warning: AlertTriangle,
};

export default function DashboardPage({
  accessProfile,
  actionCenter,
  boothRent,
  businessUnit,
  masterDashboard,
  masterDashboardUpdatedAt,
  navItems,
  payrollRuns,
  performanceSummary,
  setActivePage,
  squareStatus,
  staff,
}) {
  const payrollAllowed = canUsePayroll(accessProfile);
  const payrollEditable = canManagePayroll(accessProfile);
  const allBusinessesView = isAllBusinessesUnit(businessUnit);
  const canStartPayroll = payrollEditable && !allBusinessesView;
  const businessProfile = getBusinessProfile(businessUnit);
  const activeStaff = staff.filter((member) => member.active);
  const fixedRateStaff = activeStaff.filter((member) => member.fixed_rate);
  const autoAdjustEligible = activeStaff.filter(
    (member) => !member.fixed_rate && member.tier !== 'probation',
  );
  const latestRun = payrollRuns[0];
  const openBoothRent = boothRent.filter((record) => !record.paid);
  const boothBalance = openBoothRent.reduce(
    (total, record) => total + Number(record.rent_amount || 0),
    0,
  );
  const performanceTotal = performanceSummary.reduce(
    (total, row) => total + Number(row.total_net_sales || 0),
    0,
  );
  const topPerformers = performanceSummary.slice(0, 5);
  const isBeautyLounge = businessUnit?.name === 'RTB Beauty Lounge';
  const booksySummary = businessUnit?.name === 'RTB Lounge' ? masterDashboard?.summary : null;
  const squareSummary = isBeautyLounge ? masterDashboard?.summary : null;
  const appointmentSummary = booksySummary || squareSummary;
  const operationalChecks = buildOperationalChecks({
    activeStaffCount: activeStaff.length,
    appointmentUpdatedAt: masterDashboard
      ? masterDashboardUpdatedAt || masterDashboard.updatedAt
      : null,
    boothRentCount: boothRent.length,
    businessUnitName: businessUnit?.name,
    latestRun,
    payrollAllowed,
    squareStatus,
  });
  const actionItems = buildActionCenterItems({
    accessProfile,
    actionCenter,
    businessUnitId: allBusinessesView ? null : businessUnit?.id,
    boothRent,
    payrollRuns,
    staff,
  });
  const actionSummary = getActionCenterSummary(actionItems);
  const topActions = actionItems.slice(0, 3);
  const workspace = buildRoleWorkspace(accessProfile, navItems, businessUnit);
  const hasAppointmentSnapshot = Boolean(booksySummary || squareSummary);
  const [mobileTab, setMobileTab] = useState('overview');
  const mobileTabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'actions', label: 'Actions' },
    ...(hasAppointmentSnapshot ? [{ id: 'appointments', label: 'Appointments' }] : []),
    { id: 'payroll', label: 'Payroll' },
  ];
  const mobileGroupClass = (id) => (mobileTab === id ? 'is-active-mobile-tab' : '');

  return (
    <div className="page-grid dashboard-page">
      <section className="hero-panel dashboard-hero">
        <div className="hero-brand-lockup">
          <div className="hero-brand-logo">
            <img src={businessProfile.logo_url} alt="" />
          </div>
          <div>
            <span className="eyebrow">{allBusinessesView ? 'Combined view' : businessProfile.business_type}</span>
            <h2>{businessUnit?.name || 'RTB OS'}</h2>
            <p>
              {allBusinessesView
                ? 'Reports and rankings from both businesses.'
                : `${businessProfile.booking_platform || 'Appointments'} and ${businessProfile.pos_platform || 'POS'} operations.`}
            </p>
          </div>
        </div>
        {canStartPayroll ? (
          <button className="primary-button" type="button" onClick={() => setActivePage('payroll')}>
            New payroll run
          </button>
        ) : null}
      </section>

      <nav className="dashboard-mobile-tabs" aria-label="Dashboard sections">
        {mobileTabs.map((tab) => (
          <button
            aria-current={mobileTab === tab.id ? 'page' : undefined}
            className={`dashboard-mobile-tabs__item ${mobileTab === tab.id ? 'active' : ''}`}
            key={tab.id}
            type="button"
            onClick={() => setMobileTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <section className={`panel full-span workspace-panel ${mobileGroupClass('overview')}`} data-mobile-group="overview">
        <div className="section-header">
          <div>
            <span>{workspace.roleTitle}</span>
            <h2>Quick actions</h2>
          </div>
          <StatusBadge tone={workspace.editableModules.length ? 'gold' : 'muted'}>
            {workspace.editableModules.length
              ? `${workspace.editableModules.length} edit areas`
              : 'View only'}
          </StatusBadge>
        </div>
        <div className="workspace-grid">
          <div className="workspace-card">
            <span>Open</span>
            <div className="workspace-actions">
              {workspace.focusPages.map((page) => (
                <button
                  className="secondary-button small"
                  key={page.id}
                  type="button"
                  onClick={() => setActivePage(page.id)}
                >
                  {page.label}
                </button>
              ))}
            </div>
          </div>
          <div className="workspace-card">
            <span>Status</span>
            <div className="workspace-status-pills">
              {workspace.onboarding.map((item) => (
                <div className={item.complete ? 'complete' : 'open'} key={item.label} title={item.detail}>
                  <CheckCircle2 size={16} />
                  <strong>{item.label}</strong>
                </div>
              ))}
            </div>
          </div>
          <div className="workspace-card">
            <span>Role</span>
            {workspace.responsibilities.length ? (
              <ul className="compact-list workspace-mini-list">
                {workspace.responsibilities.slice(0, 3).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className="subtle-text">No role notes yet.</p>
            )}
          </div>
        </div>
      </section>

      <section className={`panel full-span priority-board ${mobileGroupClass('overview')}`} data-mobile-group="overview">
        <div className="section-header">
          <div>
            <span>Priority board</span>
            <h2>What needs attention right now</h2>
          </div>
          <StatusBadge tone={actionSummary.total ? 'warning' : 'success'}>
            {actionSummary.total ? `${actionSummary.total} open` : 'Everything clear'}
          </StatusBadge>
        </div>
        <div className="priority-board__layout">
          <div className="priority-board__summary">
            <div className="priority-board__stats">
              <div className="priority-board__stat">
                <strong>{actionSummary.total}</strong>
                <span>open actions</span>
              </div>
              <div className="priority-board__stat">
                <strong>{actionSummary.urgent}</strong>
                <span>urgent / high</span>
              </div>
            </div>
            <p>
              The dashboard now highlights the work that needs follow-up first so managers can act
              quickly instead of hunting through reports.
            </p>
            <button className="primary-button" type="button" onClick={() => setActivePage('action-center')}>
              Review action center
            </button>
          </div>
          <div className="priority-board__list">
            {topActions.length ? (
              topActions.map((item) => {
                const Icon = getPriorityIcon(item.category);
                return (
                  <button
                    className={`priority-board__item ${item.priority}`}
                    key={item.id}
                    onClick={() => setActivePage(item.page)}
                    type="button"
                  >
                    <div className="priority-board__item-icon">
                      <Icon size={18} />
                    </div>
                    <span>
                      <strong>{item.title}</strong>
                      <small>{item.detail}</small>
                    </span>
                  </button>
                );
              })
            ) : (
              <div className="empty-state compact">
                <h3>No urgent priorities</h3>
                <p>This view looks clear right now.</p>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className={`metrics-grid ${mobileGroupClass('overview')}`} data-mobile-group="overview">
        <MetricCard
          icon={Users}
          label="Active staff"
          trend={`${fixedRateStaff.length} fixed-rate`}
          value={activeStaff.length}
        />
        <MetricCard
          icon={CircleDollarSign}
          label={payrollAllowed ? 'Latest payroll' : 'Appointment revenue'}
          trend={
            payrollAllowed
              ? latestRun?.week_label || 'No runs yet'
              : appointmentSummary?.periodLabel || 'Import appointment data'
          }
          value={
            payrollAllowed
              ? latestRun
                ? formatCompactCurrency(latestRun.total_net_sales)
                : '$0'
              : formatCompactCurrency(appointmentSummary?.ytdRevenue)
          }
        />
        <MetricCard
          icon={ReceiptText}
          label="Open booth rent"
          trend={`${openBoothRent.length} open records`}
          value={formatCompactCurrency(boothBalance)}
        />
        <MetricCard
          icon={TrendingUp}
          label="Recorded sales"
          trend={`${performanceSummary.length} staff profiles`}
          value={formatCompactCurrency(performanceTotal)}
        />
      </section>

      <section className={`panel full-span ${mobileGroupClass('overview')}`} data-mobile-group="overview">
        <div className="section-header">
          <div>
            <span>Setup</span>
            <h2>Business profile</h2>
          </div>
        </div>
        <div className="snapshot-grid">
          <div>
            <CalendarDays size={18} />
            <span>Booking</span>
            <strong>{businessProfile.booking_platform || 'Manual'}</strong>
          </div>
          <div>
            <CircleDollarSign size={18} />
            <span>POS</span>
            <strong>{businessProfile.pos_platform || 'Square'}</strong>
          </div>
          <div>
            <Users size={18} />
            <span>Instagram</span>
            <strong>{businessProfile.instagram_format || 'Manual'}</strong>
          </div>
        </div>
      </section>

      <section className={`panel full-span ${mobileGroupClass('overview')}`} data-mobile-group="overview">
        <div className="section-header">
          <div>
            <span>Operations</span>
            <h2>Checks</h2>
          </div>
        </div>
        <div className="operations-grid">
          {operationalChecks.map((check) => {
            const Icon = OPERATION_ICONS[check.tone] || Clock3;
            return (
              <button
                className={`operation-check ${check.tone}`}
                key={check.label}
                onClick={() => setActivePage(check.action)}
                type="button"
              >
                <Icon size={18} />
                <span>
                  <strong>{check.label}</strong>
                  <small>{check.detail}</small>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className={`panel full-span action-center-snapshot ${mobileGroupClass('actions')}`} data-mobile-group="actions">
        <div className="section-header">
          <div>
            <span>Action Center</span>
            <h2>Attention</h2>
          </div>
          <button className="ghost-button" type="button" onClick={() => setActivePage('action-center')}>
            <BellRing size={16} />
            Open Action Center
          </button>
        </div>
        {topActions.length ? (
          <div className="dashboard-action-list">
            {topActions.map((item) => {
              const Icon = getPriorityIcon(item.category);
              return (
                <button
                  className={`dashboard-action-item ${item.priority}`}
                  key={item.id}
                  type="button"
                  onClick={() => setActivePage(item.page)}
                >
                  <Icon size={18} />
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.detail}</small>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="empty-state compact">
            <h3>No open actions</h3>
            <p>Action Center is clear for this view.</p>
          </div>
        )}
        <div className="action-center-snapshot__footer">
          <StatusBadge tone={actionSummary.urgent ? 'warning' : actionSummary.total ? 'gold' : 'success'}>
            {actionSummary.total ? `${actionSummary.total} open actions` : 'Clear'}
          </StatusBadge>
          <span>{actionSummary.automatic} automatic / {actionSummary.manual} manual</span>
        </div>
      </section>

      {booksySummary ? (
        <section className={`panel full-span ${mobileGroupClass('appointments')}`} data-mobile-group="appointments">
          <div className="section-header">
            <div>
              <span>Booksy import</span>
              <h2>Master dashboard snapshot</h2>
            </div>
            <button className="ghost-button" type="button" onClick={() => setActivePage('insights')}>
              Open insights
            </button>
          </div>

          <div className="snapshot-grid">
            <div>
              <CalendarDays size={18} />
              <span>YTD revenue</span>
              <strong>{formatCurrency(booksySummary.ytdRevenue)}</strong>
            </div>
            <div>
              <Users size={18} />
              <span>All-time clients</span>
              <strong>{formatNumber(booksySummary.allTimeClients)}</strong>
            </div>
            <div>
              <AlertTriangle size={18} />
              <span>Slipping away</span>
              <strong>{formatNumber(booksySummary.slippingAwayClients)}</strong>
            </div>
          </div>
        </section>
      ) : null}

      {isBeautyLounge && squareSummary ? (
        <section className={`panel full-span ${mobileGroupClass('appointments')}`} data-mobile-group="appointments">
          <div className="section-header">
            <div>
              <span>Square Appointments</span>
              <h2>Beauty Lounge appointment snapshot</h2>
            </div>
            <button className="ghost-button" type="button" onClick={() => setActivePage('insights')}>
              Open insights
            </button>
          </div>

          <div className="snapshot-grid">
            <div>
              <CalendarDays size={18} />
              <span>Estimated sales</span>
              <strong>{formatCurrency(squareSummary.ytdRevenue)}</strong>
            </div>
            <div>
              <Users size={18} />
              <span>Clients</span>
              <strong>{formatNumber(squareSummary.allTimeClients)}</strong>
            </div>
            <div>
              <AlertTriangle size={18} />
              <span>Synced appts</span>
              <strong>{formatNumber(squareSummary.completedAppointments)}</strong>
            </div>
          </div>
        </section>
      ) : null}

      {isBeautyLounge && !squareSummary ? (
        <section className={`panel full-span ${mobileGroupClass('appointments')}`} data-mobile-group="appointments">
          <div className="section-header">
            <div>
              <span>Square Appointments</span>
              <h2>Beauty Lounge appointment source</h2>
            </div>
            <button className="ghost-button" type="button" onClick={() => setActivePage('insights')}>
              Open insights
            </button>
          </div>
          <p className="subtle-text">
            RTB Beauty Lounge uses Square Appointments. Import Square Appointments data to
            fill this snapshot.
          </p>
        </section>
      ) : null}

      {payrollAllowed ? (
      <section className={`panel two-thirds ${mobileGroupClass('payroll')}`} data-mobile-group="payroll">
        <div className="section-header">
          <div>
            <span>Payroll</span>
            <h2>Recent runs</h2>
          </div>
          <button className="ghost-button" type="button" onClick={() => setActivePage('payroll')}>
            Open payroll
          </button>
        </div>

        {payrollRuns.length ? (
          <DataTable>
            <table>
              <thead>
                <tr>
                  <th>Week</th>
                  <th>Status</th>
                  <th>Net sales</th>
                  <th>Staff payout</th>
                  <th>RTB net</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {payrollRuns.slice(0, 6).map((run) => (
                  <tr key={run.id}>
                    <td>{run.week_label}</td>
                    <td>
                      <StatusBadge tone={run.status === 'locked' ? 'success' : 'warning'}>
                        {run.status}
                      </StatusBadge>
                    </td>
                    <td>{formatCurrency(run.total_net_sales)}</td>
                    <td>{formatCurrency(run.total_staff_payout)}</td>
                    <td>{formatCurrency(run.rtb_net)}</td>
                    <td>{formatDate(run.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataTable>
        ) : (
          <EmptyState
            icon={BadgeDollarSign}
            title="No payroll runs"
            message="Draft the first run for this business unit."
            action={
              <button className="ghost-button" type="button" onClick={() => setActivePage('payroll')}>
                Start payroll
              </button>
            }
          />
        )}
      </section>
      ) : null}

      <section className={`panel ${mobileGroupClass('payroll')}`} data-mobile-group="payroll">
        <div className="section-header">
          <div>
            <span>Performance</span>
            <h2>Leaderboard</h2>
          </div>
        </div>

        {topPerformers.length ? (
          <div className="leaderboard">
            {topPerformers.map((row, index) => (
              <div className="leaderboard-row" key={row.staff_id || row.full_name}>
                <span>{index + 1}</span>
                <div>
                  <strong>{row.full_name}</strong>
                  <small>{row.role || 'Staff'}</small>
                </div>
                <b>{formatCompactCurrency(row.total_net_sales)}</b>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={TrendingUp}
            title="No performance history"
            message="Locked payroll runs can populate staff performance."
          />
        )}
      </section>

      <section className={`panel ${mobileGroupClass('payroll')}`} data-mobile-group="payroll">
        <div className="section-header">
          <div>
            <span>Roster</span>
            <h2>Commission profile</h2>
          </div>
        </div>
        <div className="stat-list">
          <div>
            <span>Average commission</span>
            <strong>
              {activeStaff.length
                ? formatPercent(
                    activeStaff.reduce(
                      (total, member) => total + Number(member.commission_rate || 0),
                      0,
                    ) / activeStaff.length,
                  )
                : '0%'}
            </strong>
          </div>
          <div>
            <span>Auto-adjust eligible</span>
            <strong>{autoAdjustEligible.length}</strong>
          </div>
          <div>
            <span>Inactive profiles</span>
            <strong>{staff.filter((member) => !member.active).length}</strong>
          </div>
        </div>
      </section>

      <section className={`panel ${mobileGroupClass('payroll')}`} data-mobile-group="payroll">
        <div className="section-header">
          <div>
            <span>Booth rent</span>
            <h2>Open balances</h2>
          </div>
        </div>
        <div className="stat-list">
          {openBoothRent.slice(0, 4).map((record) => (
            <div key={record.id}>
              <span>{record.renter_name}</span>
              <strong>{formatCurrency(record.rent_amount)}</strong>
            </div>
          ))}
          {!openBoothRent.length ? (
            <div>
              <span>No open records</span>
              <strong>{formatCurrency(0)}</strong>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
