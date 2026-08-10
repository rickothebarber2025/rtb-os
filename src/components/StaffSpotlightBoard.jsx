import { useEffect, useState } from 'react';
import { Trophy } from 'lucide-react';
import EmptyState from './EmptyState';
import { getMonthlySpotlight } from '../services/rtbService';

function monthLabel(value) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// Automatically picks the top performer each month using the exact same
// ranking the Performance tab uses (staff_monthly_performance_summary,
// highest total_net_sales, excluding anyone flagged off the leaderboard) --
// computed server-side via get_monthly_spotlight, which only ever returns
// a name, role, and photo. No dollar figure is included in the response,
// so there's nothing financial for this board to display even though the
// selection itself is driven by real sales data.
export default function StaffSpotlightBoard({ businessUnitId }) {
  const [months, setMonths] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!businessUnitId) return;
    let cancelled = false;
    setLoading(true);
    setError('');

    getMonthlySpotlight(businessUnitId, 6)
      .then((rows) => {
        if (!cancelled) setMonths(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Unable to load the spotlight board.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [businessUnitId]);

  if (!businessUnitId) return null;

  const current = months[0] || null;
  const history = months.slice(1);

  return (
    <section className="panel full-span spotlight-board">
      <div className="section-header">
        <div>
          <span>Spotlight</span>
          <h2>Staff of the Month</h2>
        </div>
      </div>
      <p className="subtle-text">
        Picked automatically the same way the Performance tab ranks the team -- top net sales for the month.
      </p>

      {error ? <div className="alert danger">{error}</div> : null}

      {loading ? (
        <p className="subtle-text">Loading...</p>
      ) : current ? (
        <div className="spotlight-current">
          <div className="spotlight-current__avatar">
            {current.winner.photo_url ? (
              <img alt={current.winner.full_name} src={current.winner.photo_url} />
            ) : (
              <Trophy size={32} />
            )}
          </div>
          <div>
            <span className="spotlight-current__month">{monthLabel(current.month)}</span>
            <h3>{current.winner.full_name}</h3>
            {current.winner.role ? <small>{current.winner.role}</small> : null}
          </div>
        </div>
      ) : (
        <EmptyState
          icon={Trophy}
          title="Not enough data yet this month"
          message="This fills in automatically once this month's sales are recorded."
        />
      )}

      {history.length ? (
        <div className="spotlight-history">
          <h4>Past months</h4>
          <div className="spotlight-history__grid">
            {history.map((row) => (
              <div className="spotlight-history__card" key={row.month}>
                {row.winner.photo_url ? (
                  <img alt={row.winner.full_name} src={row.winner.photo_url} />
                ) : (
                  <Trophy size={18} />
                )}
                <div>
                  <strong>{row.winner.full_name}</strong>
                  <small>{monthLabel(row.month)}</small>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
