import { BarChart3, TrendingDown, TrendingUp, WalletCards } from 'lucide-react';
import DataTable from '../components/DataTable';
import EmptyState from '../components/EmptyState';
import MetricCard from '../components/MetricCard';
import StatusBadge from '../components/StatusBadge';
import {
  formatCompactCurrency,
  formatCurrency,
  formatNumber,
  formatPercent,
} from '../utils/formatters';

export default function PerformancePage({ performanceSummary }) {
  const totals = performanceSummary.reduce(
    (acc, row) => ({
      adjustedWeeks: acc.adjustedWeeks + Number(row.adjusted_weeks || 0),
      netSales: acc.netSales + Number(row.total_net_sales || 0),
      takeHome: acc.takeHome + Number(row.total_take_home || 0),
      underMinimumWeeks: acc.underMinimumWeeks + Number(row.under_minimum_weeks || 0),
      weeks: acc.weeks + Number(row.weeks_recorded || 0),
    }),
    { adjustedWeeks: 0, netSales: 0, takeHome: 0, underMinimumWeeks: 0, weeks: 0 },
  );

  return (
    <div className="page-grid">
      <section className="metrics-grid full-span">
        <MetricCard
          icon={TrendingUp}
          label="Total net sales"
          trend={`${formatNumber(totals.weeks)} recorded weeks`}
          value={formatCompactCurrency(totals.netSales)}
        />
        <MetricCard
          icon={WalletCards}
          label="Total take-home"
          trend="Saved performance"
          value={formatCompactCurrency(totals.takeHome)}
        />
        <MetricCard
          icon={TrendingDown}
          label="Under minimum weeks"
          trend={`${totals.adjustedWeeks} adjusted weeks`}
          value={totals.underMinimumWeeks}
        />
      </section>

      <section className="panel full-span">
        <div className="section-header">
          <div>
            <span>Performance</span>
            <h2>Staff performance summary</h2>
          </div>
        </div>

        {performanceSummary.length ? (
          <DataTable>
            <table>
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Role</th>
                  <th>Commission</th>
                  <th>Total sales</th>
                  <th>Avg week</th>
                  <th>Best week</th>
                  <th>Take-home</th>
                  <th>Weeks</th>
                  <th>Flags</th>
                </tr>
              </thead>
              <tbody>
                {performanceSummary.map((row) => (
                  <tr key={row.staff_id || row.full_name}>
                    <td>
                      <div className="person-cell">
                        <strong>{row.full_name}</strong>
                        <span>{row.business_unit}</span>
                      </div>
                    </td>
                    <td>{row.role || 'Staff'}</td>
                    <td>
                      <strong>{formatPercent(row.commission_rate)}</strong>
                      {row.fixed_rate ? <StatusBadge tone="gold">Fixed rate</StatusBadge> : null}
                    </td>
                    <td>{formatCurrency(row.total_net_sales)}</td>
                    <td>{formatCurrency(row.avg_weekly_net)}</td>
                    <td>{formatCurrency(row.best_week_net)}</td>
                    <td>{formatCurrency(row.total_take_home)}</td>
                    <td>{formatNumber(row.weeks_recorded)}</td>
                    <td>
                      {Number(row.under_minimum_weeks || 0) > 0 ? (
                        <StatusBadge tone="warning">
                          {row.under_minimum_weeks} under $500
                        </StatusBadge>
                      ) : (
                        <StatusBadge tone="success">On track</StatusBadge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataTable>
        ) : (
          <EmptyState
            icon={BarChart3}
            title="No saved performance"
            message="Performance appears after locked payroll runs are saved."
          />
        )}
      </section>
    </div>
  );
}
