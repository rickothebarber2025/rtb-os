import { useEffect, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { getStaffDailySales } from '../services/rtbService';
import { formatCurrency } from '../utils/formatters';

const WEEKLY_MINIMUM = 500;
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

// Shown alongside the real per-shift/per-week payroll numbers, not instead
// of them -- this is meant as a day-by-day "where do I stand this week"
// view toward the shop's real $500/week commission minimum, using the same
// real Square sales data the rest of the hub uses. Note: net_sales here is
// attributed by who rang up the sale in Square, not necessarily who
// performed the service, so it's directionally useful day to day but isn't
// a substitute for the finalized payroll numbers.
export default function WeeklyGoalProgress({ businessUnitId, staffId }) {
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!businessUnitId || !staffId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');

    getStaffDailySales(businessUnitId, 14)
      .then((rows) => {
        if (!cancelled) setSales((rows || []).filter((row) => row.staff_id === staffId));
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Unable to load sales.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [businessUnitId, staffId]);

  if (!businessUnitId || !staffId) return null;

  const weekStart = startOfWeek(new Date());
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + index);
    return date;
  });

  const salesByDate = new Map(sales.map((row) => [row.sale_date, Number(row.net_sales || 0)]));
  const weekTotal = days.reduce((sum, date) => sum + (salesByDate.get(dateKey(date)) || 0), 0);
  const progressPercent = Math.min(100, (weekTotal / WEEKLY_MINIMUM) * 100);
  const maxDay = Math.max(WEEKLY_MINIMUM / 7, ...days.map((date) => salesByDate.get(dateKey(date)) || 0));
  const today = dateKey(new Date());

  return (
    <article className="panel daily-ops-card wgp-card">
      <div className="section-header">
        <div>
          <span>This Week</span>
          <h2>{formatCurrency(weekTotal)} of {formatCurrency(WEEKLY_MINIMUM)}</h2>
        </div>
        <TrendingUp size={20} />
      </div>
      {error ? <div className="alert danger">{error}</div> : null}
      <div className="wgp-progress-track">
        <span style={{ width: `${progressPercent}%` }} />
      </div>
      {loading ? (
        <p className="subtle-text">Loading...</p>
      ) : (
        <div className="wgp-bar-row">
          {days.map((date, index) => {
            const key = dateKey(date);
            const value = salesByDate.get(key) || 0;
            const height = Math.max(4, (value / maxDay) * 60);
            return (
              <div className={key === today ? 'wgp-bar wgp-bar--today' : 'wgp-bar'} key={key}>
                <div className="wgp-bar__fill" style={{ height: `${height}px` }} title={formatCurrency(value)} />
                <small>{WEEKDAY_LABELS[index]}</small>
              </div>
            );
          })}
        </div>
      )}
      <p className="subtle-text">
        {weekTotal >= WEEKLY_MINIMUM
          ? "You've hit the weekly minimum \u2014 nice work."
          : `${formatCurrency(WEEKLY_MINIMUM - weekTotal)} to go this week.`}
      </p>
    </article>
  );
}
