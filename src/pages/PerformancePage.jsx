import { useEffect, useMemo, useState } from 'react';
import { Award, BarChart3, Download, RefreshCw, Star, TrendingDown, TrendingUp, WalletCards } from 'lucide-react';
import DataTable from '../components/DataTable';
import EmptyState from '../components/EmptyState';
import MetricCard from '../components/MetricCard';
import ProbationProgressCard from '../components/ProbationProgressCard';
import StatusBadge from '../components/StatusBadge';
import {
  getReviews,
  syncRankingCoachReviews,
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
  const [reviews, setReviews] = useState([]);
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [reviewsSyncing, setReviewsSyncing] = useState(false);
  const [reviewsError, setReviewsError] = useState('');
  const [reviewsNotice, setReviewsNotice] = useState('');
  const availableMonths = useMemo(
    () => [...new Set(monthlyPerformanceSummary.map((row) => row.month_start))],
    [monthlyPerformanceSummary],
  );
  const [selectedMonth, setSelectedMonth] = useState(availableMonths[0] || '');
  const staffById = useMemo(() => new Map(staff.map((member) => [member.id, member])), [staff]);
  const scopedBusinessId = allBusinessesView ? null : businessUnit?.id;

  async function loadReviews() {
    setReviewsLoading(true);
    setReviewsError('');
    try {
      const rows = await getReviews(scopedBusinessId);
      setReviews(rows || []);
    } catch (err) {
      setReviewsError(err.message || 'Unable to load reviews.');
    } finally {
      setReviewsLoading(false);
    }
  }

  useEffect(() => {
    loadReviews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedBusinessId]);

  async function handleSyncReviews() {
    if (allBusinessesView) {
      setReviewsError('Choose one business before syncing reviews.');
      return;
    }
    setReviewsSyncing(true);
    setReviewsError('');
    setReviewsNotice('');
    try {
      const result = await syncRankingCoachReviews(scopedBusinessId, { maxMessages: 25 });
      setReviewsNotice(
        `Synced: ${result.inserted ?? 0} new, ${result.updated ?? 0} updated, ${result.unresolved ?? 0} need review.`,
      );
      await loadReviews();
    } catch (err) {
      setReviewsError(err.message || 'Review sync failed.');
    } finally {
      setReviewsSyncing(false);
    }
  }

  const reviewCountsByStaff = useMemo(() => {
    const counts = new Map();
    reviews.forEach((review) => {
      if (!review.staff_id) return;
      const current = counts.get(review.staff_id) || { count: 0, totalRating: 0 };
      counts.set(review.staff_id, {
        count: current.count + 1,
        totalRating: current.totalRating + Number(review.rating || 0),
      });
    });
    return counts;
  }, [reviews]);

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
            <span>Reviews</span>
            <h2>{reviews.length} in the last 60 days</h2>
          </div>
          <button
            className="secondary-button"
            disabled={reviewsSyncing || allBusinessesView}
            onClick={handleSyncReviews}
            title={allBusinessesView ? 'Choose one business to sync reviews.' : undefined}
            type="button"
          >
            <RefreshCw size={16} />
            {reviewsSyncing ? 'Syncing...' : 'Sync reviews'}
          </button>
        </div>
        {reviewsError ? <div className="alert danger">{reviewsError}</div> : null}
        {reviewsNotice ? <div className="alert success">{reviewsNotice}</div> : null}
        {reviewsLoading ? (
          <p className="subtle-text">Loading reviews...</p>
        ) : reviews.length ? (
          <div className="stat-list">
            {staff
              .filter((member) => reviewCountsByStaff.has(member.id))
              .sort(
                (a, b) =>
                  (reviewCountsByStaff.get(b.id)?.count || 0) - (reviewCountsByStaff.get(a.id)?.count || 0),
              )
              .map((member) => {
                const summary = reviewCountsByStaff.get(member.id);
                const avgRating = summary.count ? (summary.totalRating / summary.count).toFixed(1) : '--';
                return (
                  <div key={member.id}>
                    <span>{member.full_name}</span>
                    <strong>
                      <Star size={14} /> {summary.count} · {avgRating} avg
                    </strong>
                  </div>
                );
              })}
          </div>
        ) : (
          <EmptyState
            icon={Star}
            title="No reviews synced yet"
            message="Click Sync reviews to pull in new Google reviews from rankingCoach's forwarded emails."
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
