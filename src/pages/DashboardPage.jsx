import {
  AlertTriangle,
  BadgeDollarSign,
  CalendarDays,
  CircleDollarSign,
  ReceiptText,
  TrendingUp,
  Users,
} from 'lucide-react';
import DataTable from '../components/DataTable';
import EmptyState from '../components/EmptyState';
import MetricCard from '../components/MetricCard';
import StatusBadge from '../components/StatusBadge';
import {
  formatCompactCurrency,
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercent,
} from '../utils/formatters';

export default function DashboardPage({
  boothRent,
  businessUnit,
  masterDashboard,
  payrollRuns,
  performanceSummary,
  setActivePage,
  staff,
}) {
  const activeStaff = staff.filter((member) => member.active);
  const fixedRateStaff = activeStaff.filter((member) => member.fixed_rate);
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

  return (
    <div className="page-grid">
      <section className="hero-panel">
        <div>
          <h2>RTB operations snapshot</h2>
          <p>
            Payroll, performance, booth rent, and roster activity across the selected
            business unit.
          </p>
        </div>
        <button className="primary-button" type="button" onClick={() => setActivePage('payroll')}>
          New payroll run
        </button>
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
          label="Latest payroll"
          trend={latestRun ? latestRun.week_label : 'No runs yet'}
          value={latestRun ? formatCompactCurrency(latestRun.total_net_sales) : '$0'}
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

      {isBeautyLounge ? (
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
            <strong>{activeStaff.length - fixedRateStaff.length}</strong>
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
