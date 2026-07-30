import { useEffect, useMemo, useState } from 'react';
import { Award, BarChart3, Clock3, Download, TrendingDown, TrendingUp, WalletCards } from 'lucide-react';
import DataTable from '../components/DataTable';
import EmptyState from '../components/EmptyState';
import MetricCard from '../components/MetricCard';
import ProbationProgressCard from '../components/ProbationProgressCard';
import StatusBadge from '../components/StatusBadge';
import {
  getStaffAttendance,
  syncSquareAttendance,
} from '../services/rtbService';
import {
  formatCompactCurrency,
  formatCurrency,
  formatNumber,
  formatPercent,
} from '../utils/formatters';
import { isAllBusinessesUnit } from '../utils/businessProfiles';
import { isProbationStaff } from '../utils/probation';
import { buildStaffPerformanceFeedback } from '../utils/customerIntelligence';

function monthLabel(value) {
  if (!value) return 'No month selected';
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${value}T12:00:00`));
}

export default function PerformancePage({
  accessProfile,
  businessUnit,
  monthlyPerformanceSummary,
  performanceSummary,
  staff,
}) {
  const allBusinessesView = isAllBusinessesUnit(businessUnit);
  const [certificateError, setCertificateError] = useState('');
  const [certificateLoading, setCertificateLoading] = useState(false);
  const [attendance, setAttendance] = useState([]);
  const [attendanceLoading, setAttendanceLoading] = useState(true);
  const [attendanceSyncing, setAttendanceSyncing] = useState(false);
  const [attendanceError, setAttendanceError] = useState('');
  const [attendanceNotice, setAttendanceNotice] = useState('');
  const availableMonths = useMemo(
    () => [...new Set(monthlyPerformanceSummary.map((row) => row.month_start))],
    [monthlyPerformanceSummary],
  );
  const [selectedMonth, setSelectedMonth] = useState(availableMonths[0] || '');
  const staffById = useMemo(() => new Map(staff.map((member) => [member.id, member])), [staff]);
  const scopedBusinessId = allBusinessesView ? null : businessUnit?.id;

  async function loadAttendance() {
    setAttendanceLoading(true);
    setAttendanceError('');
    try {
      const rows = await getStaffAttendance(scopedBusinessId, 30);
      setAttendance(rows || []);
    } catch (err) {
      setAttendanceError(err.message || 'Unable to load attendance.');
    } finally {
      setAttendanceLoading(false);
    }
  }

  useEffect(() => {
    loadAttendance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedBusinessId]);

  async function handleSyncAttendance() {
    setAttendanceSyncing(true);
    setAttendanceError('');
    setAttendanceNotice('');
    try {
      const result = await syncSquareAttendance(scopedBusinessId, 30);
      setAttendanceNotice(
        `Synced: ${result.shiftsInserted} new, ${result.shiftsUpdated} updated` +
          (result.shiftsWithUnmatchedStaff
            ? `, ${result.shiftsWithUnmatchedStaff} shift(s) need a staff match`
            : '') +
          (result.unmatchedNames?.length ? ` (unmatched: ${result.unmatchedNames.join(', ')})` : '') +
          '.',
      );
      await loadAttendance();
    } catch (err) {
      setAttendanceError(err.message || 'Attendance sync failed.');
    } finally {
      setAttendanceSyncing(false);
    }
  }

  const attendanceByStaff = useMemo(() => {
    const summary = new Map();
    attendance.forEach((record) => {
      if (!record.staff_id) return;
      const current = summary.get(record.staff_id) || { hours: 0, shifts: 0 };
      const hours = record.clock_out
        ? (new Date(record.clock_out) - new Date(record.clock_in)) / (1000 * 60 * 60)
        : 0;
      summary.set(record.staff_id, {
        hours: current.hours + hours,
        shifts: current.shifts + 1,
      });
    });
    return summary;
  }, [attendance]);

  const performanceFeedback = useMemo(
    () => buildStaffPerformanceFeedback(performanceSummary, staff),
    [performanceSummary, staff],
  );
  const monthlyRows = useMemo(
    () =>
      monthlyPerformanceSummary.filter(
        (row) => row.month_start === selectedMonth && !row.exclude_from_leaderboard,
      ),
    [monthlyPerformanceSummary, selectedMonth],
  );
  const topPerformer = monthlyRows[0] || null;
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

  useEffect(() => {
    if (!availableMonths.includes(selectedMonth)) {
      setSelectedMonth(availableMonths[0] || '');
    }
  }, [availableMonths, selectedMonth]);

  async function handleDownloadCertificate() {
    setCertificateError('');
    setCertificateLoading(true);

    try {
      const { downloadStaffOfMonthCertificate } = await import('../utils/certificates');
      await downloadStaffOfMonthCertificate({
        businessUnit,
        generatedAt: new Date(`${selectedMonth}T12:00:00`),
        performer: topPerformer,
      });
    } catch (err) {
      setCertificateError(err.message || 'Unable to generate certificate.');
    } finally {
      setCertificateLoading(false);
    }
  }

  return (
    <div className="page-grid">
      {allBusinessesView ? (
        <section className="panel full-span">
          <div className="alert warning">
            <strong>Combined performance view</strong>
            <span>
              Staff rankings and Staff of the Month are combined only because All Businesses is
              selected. Choose one business to calculate awards separately.
            </span>
          </div>
        </section>
      ) : null}

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
            <span>Attendance</span>
            <h2>{attendance.length} shifts in the last 30 days</h2>
          </div>
          <button
            className="secondary-button"
            disabled={attendanceSyncing}
            onClick={handleSyncAttendance}
            type="button"
          >
            <Clock3 size={16} />
            {attendanceSyncing ? 'Syncing...' : 'Sync Square attendance'}
          </button>
        </div>
        <p className="subtle-text">
          Pulls real clock-in/clock-out data from Square for both locations and matches it to your roster.
        </p>
        {attendanceError ? <div className="alert danger">{attendanceError}</div> : null}
        {attendanceNotice ? <div className="alert success">{attendanceNotice}</div> : null}
        {attendanceLoading ? (
          <p className="subtle-text">Loading attendance...</p>
        ) : attendanceByStaff.size ? (
          <div className="stat-list">
            {staff
              .filter((member) => attendanceByStaff.has(member.id))
              .sort((a, b) => (attendanceByStaff.get(b.id)?.hours || 0) - (attendanceByStaff.get(a.id)?.hours || 0))
              .map((member) => {
                const summary = attendanceByStaff.get(member.id);
                return (
                  <div key={member.id}>
                    <span>{member.full_name}</span>
                    <strong>{summary.shifts} shifts &middot; {summary.hours.toFixed(1)}h</strong>
                  </div>
                );
              })}
          </div>
        ) : (
          <EmptyState
            icon={Clock3}
            title="No attendance synced yet"
            message="Click Sync Square attendance to pull in real clock-in/clock-out records."
          />
        )}
      </section>

      <section className="panel full-span certificate-panel">
        <div className="section-header">
          <div>
            <span>Staff of the month</span>
            <h2>Top performance certificate</h2>
          </div>
          <div className="section-header__controls">
            <label className="field month-field">
              <span>Performance month</span>
              <select
                disabled={!availableMonths.length}
                onChange={(event) => setSelectedMonth(event.target.value)}
                value={selectedMonth}
              >
                {!availableMonths.length ? <option value="">No saved months</option> : null}
                {availableMonths.map((month) => (
                  <option key={month} value={month}>
                    {monthLabel(month)}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="primary-button"
              disabled={!topPerformer || certificateLoading}
              onClick={handleDownloadCertificate}
              type="button"
            >
              <Download size={17} />
              {certificateLoading ? 'Generating...' : 'Download PDF'}
            </button>
          </div>
        </div>
        {topPerformer ? (
          <div className="award-layout">
            <div className="certificate-preview">
              <div className="certificate-seal">
                <Award size={24} />
              </div>
              <div>
                <strong>{topPerformer.full_name}</strong>
                <span>
                  {monthLabel(selectedMonth)} · {businessUnit?.name || topPerformer.business_unit}
                  {' · '}
                  {formatCurrency(topPerformer.total_net_sales)} sales
                </span>
              </div>
            </div>
            <div className="monthly-ranking">
              {monthlyRows.slice(0, 3).map((row, index) => (
                <div key={row.staff_id}>
                  <span>#{index + 1}</span>
                  <strong>{row.full_name}</strong>
                  <b>{formatCurrency(row.total_net_sales)}</b>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="subtle-text">
            Finalize payroll to add performance data before generating a monthly certificate.
          </p>
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
          <>
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

            <section className="panel full-span performance-feedback-panel">
              <div className="section-header">
                <div>
                  <span>Feedback</span>
                  <h2>Performance coaching for staff</h2>
                </div>
              </div>
              <div className="feedback-cards">
                {performanceFeedback.map((feedback) => (
                  <article key={feedback.staff_id} className="feedback-card">
                    <div className="feedback-card__header">
                      <div>
                        <strong>{feedback.full_name}</strong>
                        <span>{formatCurrency(feedback.avgWeekNet)} avg weekly sales</span>
                      </div>
                      <StatusBadge
                        tone={
                          feedback.priority === 'high'
                            ? 'danger'
                            : feedback.priority === 'medium'
                            ? 'warning'
                            : 'success'
                        }
                      >
                        {feedback.priority}
                      </StatusBadge>
                    </div>
                    <p>{feedback.summary}</p>
                    <ul>
                      <li>
                        <strong>Growth:</strong> {feedback.growthTip}
                      </li>
                      <li>
                        <strong>Customer service:</strong> {feedback.customerServiceTip}
                      </li>
                      <li>
                        <strong>Tips:</strong> {feedback.tipTip}
                      </li>
                      <li>
                        <strong>Next action:</strong> {feedback.action}
                      </li>
                    </ul>
                  </article>
                ))}
              </div>
            </section>
          </>
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
