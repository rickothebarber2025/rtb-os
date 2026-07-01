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
  const topActions = actionItems.slice(0, 4);
  const workspace = buildRoleWorkspace(accessProfile, navItems, businessUnit);

  return (
    <div className="page-grid">
      <section className="hero-panel">
        <div>
          <h2>{businessUnit?.name || 'RTB'} operations snapshot</h2>
          <p>
            {allBusinessesView
              ? 'Combined owner view across RTB Lounge and RTB Beauty Lounge.'
              : `Live roster, payroll, performance, booth rent, and ${businessProfile.booking_platform} activity for this business.`}
          </p>
        </div>
        {canStartPayroll ? (
          <button className="primary-button" type="button" onClick={() => setActivePage('payroll')}>
            New payroll run
          </button>
        ) : null}
      </section>

      <section className="panel full-span workspace-panel">
        <div className="section-header">
          <div>
            <span>{workspace.roleTitle}</span>
            <h2>{workspace.title}</h2>
          </div>
          <StatusBadge tone={workspace.editableModules.length ? 'gold' : 'muted'}>
            {workspace.editableModules.length
              ? `${workspace.editableModules.length} edit areas`
              : 'View only'}
          </StatusBadge>
        </div>
        <p className="subtle-text">{workspace.description}</p>
        <div className="workspace-grid">
          <div className="workspace-card">
            <span>Start here</span>
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
            <span>Onboarding</span>
            <div className="workspace-checklist">
              {workspace.onboarding.map((item) => (
                <div className={item.complete ? 'complete' : 'open'} key={item.label}>
                  <CheckCircle2 size={16} />
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </div>
              ))}
            </div>
          </div>
          <div className="workspace-card">
            <span>Responsibilities</span>
            {workspace.responsibilities.length ? (
              <ul className="compact-list">
                {workspace.responsibilities.slice(0, 4).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className="subtle-text">No responsibilities assigned yet.</p>
            )}
          </div>
        </div>
      </section>

      <section className="metrics-grid">
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

      <section className="panel full-span">
        <div className="section-header">
          <div>
            <span>{businessProfile.business_type}</span>
            <h2>Business setup</h2>
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
        <p className="subtle-text">{businessProfile.import_source}</p>
      </section>

      <section className="panel full-span">
        <div className="section-header">
          <div>
            <span>Operations</span>
            <h2>Readiness checks</h2>
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

      <section className="panel full-span action-center-snapshot">
        <div className="section-header">
          <div>
            <span>Action Center</span>
            <h2>Needs attention</h2>
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
        <section className="panel full-span">
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
        <section className="panel full-span">
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
        <section className="panel full-span">
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
      <section className="panel two-thirds">
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

      <section className="panel">
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

      <section className="panel">
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

      <section className="panel">
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
