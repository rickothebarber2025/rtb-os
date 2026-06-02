import { useMemo, useState } from 'react';
import { Award, BarChart3, Download, TrendingDown, TrendingUp, WalletCards } from 'lucide-react';
import DataTable from '../components/DataTable';
import EmptyState from '../components/EmptyState';
import MetricCard from '../components/MetricCard';
import ProbationProgressCard from '../components/ProbationProgressCard';
import StatusBadge from '../components/StatusBadge';
import { downloadStaffOfMonthCertificate } from '../utils/certificates';
import {
  formatCompactCurrency,
  formatCurrency,
  formatNumber,
  formatPercent,
} from '../utils/formatters';
import { isProbationStaff } from '../utils/probation';

export default function PerformancePage({ businessUnit, performanceSummary, staff }) {
  const [certificateError, setCertificateError] = useState('');
  const staffById = useMemo(() => new Map(staff.map((member) => [member.id, member])), [staff]);
  const topPerformer = performanceSummary[0] || null;
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

  function handleDownloadCertificate() {
    setCertificateError('');

    try {
      downloadStaffOfMonthCertificate({
        businessUnit,
        performer: topPerformer,
      });
    } catch (err) {
      setCertificateError(err.message || 'Unable to generate certificate.');
    }
  }

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

      <section className="panel full-span certificate-panel">
        <div className="section-header">
          <div>
            <span>Staff of the month</span>
            <h2>Top performance certificate</h2>
          </div>
          <button
            className="primary-button"
            disabled={!topPerformer}
            onClick={handleDownloadCertificate}
            type="button"
          >
            <Download size={17} />
            Download PDF
          </button>
        </div>
        {topPerformer ? (
          <div className="certificate-preview">
            <div className="certificate-seal">
              <Award size={24} />
            </div>
            <div>
              <strong>{topPerformer.full_name}</strong>
              <span>
                {businessUnit?.name || topPerformer.business_unit} · {formatCurrency(topPerformer.total_net_sales)} total sales
              </span>
            </div>
          </div>
        ) : (
          <p className="subtle-text">Save performance from payroll before generating a staff-of-the-month certificate.</p>
        )}
        {certificateError ? <div className="alert danger">{certificateError}</div> : null}
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
                {performanceSummary.map((row) => {
                  const rosterMember = staffById.get(row.staff_id);
                  const probation = isProbationStaff(rosterMember);

                  return (
                    <tr key={row.staff_id || row.full_name}>
                      <td className="performance-profile-cell">
                        {probation ? (
                          <ProbationProgressCard member={rosterMember} />
                        ) : null}
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
                  );
                })}
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
