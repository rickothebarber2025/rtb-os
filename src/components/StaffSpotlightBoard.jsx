import { useEffect, useState } from 'react';
import { Award, Medal, Trophy } from 'lucide-react';
import EmptyState from './EmptyState';
import { getOperationsLeaderboards } from '../services/rtbService';

const RANK_ICON = { 1: Trophy, 2: Medal, 3: Award };

function monthLabel(value) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// Shows both businesses side by side, since this is a shared board, not
// scoped to whichever business happens to be selected. Ranking comes from
// the same participation metric already used on the Operations tab's
// checklist history (completion rate, then completed count -- see
// get_monthly_operations_leaderboard, which mirrors buildParticipation in
// ChecklistHistoryPanel.jsx exactly). That metric is inherently
// non-financial, so there's no dollar figure to withhold in the first
// place.
export default function StaffSpotlightBoard() {
  const [boards, setBoards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [month, setMonth] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    getOperationsLeaderboards()
      .then((results) => {
        if (cancelled) return;
        setBoards(results);
        setMonth(results[0]?.month || '');
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
  }, []);

  return (
    <section className="panel full-span spotlight-board">
      <div className="section-header">
        <div>
          <span>Spotlight</span>
          <h2>Staff of the Month</h2>
        </div>
      </div>
      <p className="subtle-text">
        Top 3 per business, based on the same performance and earnings ranking as the Performance tab
        {month ? ` -- ${monthLabel(month)}` : ''}.
      </p>

      {error ? <div className="alert danger">{error}</div> : null}

      {loading ? (
        <p className="subtle-text">Loading...</p>
      ) : (
        <div className="spotlight-business-grid">
          {boards.map(({ business, top }) => (
            <div className="spotlight-business-card" key={business.id}>
              <h3>{business.name}</h3>
              {top.length ? (
                <div className="spotlight-podium">
                  {top.map((entry) => {
                    const RankIcon = RANK_ICON[entry.rank] || Trophy;
                    return (
                      <div className={`spotlight-podium__row rank-${entry.rank}`} key={entry.staff_id}>
                        <div className="spotlight-podium__rank">
                          <RankIcon size={entry.rank === 1 ? 24 : 18} />
                          <span>#{entry.rank}</span>
                        </div>
                        <div className="spotlight-podium__avatar">
                          {entry.photo_url ? <img alt={entry.full_name} src={entry.photo_url} /> : null}
                        </div>
                        <div className="spotlight-podium__body">
                          <strong>{entry.full_name}</strong>
                          {entry.role ? <small>{entry.role}</small> : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState
                  icon={Trophy}
                  title="No completed month yet"
                  message="This fills in automatically once a full week's payroll has been locked for this business."
                />
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
