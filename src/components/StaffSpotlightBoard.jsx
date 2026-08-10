import { useEffect, useState } from 'react';
import { Crown, Flame, Medal, Trophy } from 'lucide-react';
import EmptyState from './EmptyState';
import { getOperationsLeaderboards } from '../services/rtbService';

const RANK_META = {
  1: { icon: Crown, tone: 'gold', label: '1st' },
  2: { icon: Medal, tone: 'silver', label: '2nd' },
  3: { icon: Medal, tone: 'bronze', label: '3rd' },
};

// Podium order: 2nd on the left, 1st in the center (elevated, biggest),
// 3rd on the right -- the classic podium layout, not just a ranked list.
const PODIUM_ORDER = [2, 1, 3];

function monthLabel(value) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function initials(name) {
  return (name || '')
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

// Shows both businesses side by side, since this is a shared board, not
// scoped to whichever business happens to be selected. Ranked by the same
// performance/earnings data as the Performance tab's own top performer
// (see get_monthly_operations_leaderboard) -- but the response never
// includes the dollar figure itself, so nothing financial reaches this
// screen even though real earnings drive who's shown here.
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
        if (!cancelled) setError(err.message || 'Unable to load the leaderboard.');
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
          <span className="spotlight-eyebrow">
            <Flame size={14} /> Leaderboard
          </span>
          <h2>Staff of the Month</h2>
        </div>
      </div>
      <p className="subtle-text">
        Who's leading the pack{month ? ` for ${monthLabel(month)}` : ''}? Top 3 per shop -- climb the ranks
        and claim the top spot next month.
      </p>

      {error ? <div className="alert danger">{error}</div> : null}

      {loading ? (
        <p className="subtle-text">Loading...</p>
      ) : (
        <div className="spotlight-business-grid">
          {boards.map(({ business, top }) => {
            const byRank = new Map(top.map((entry) => [entry.rank, entry]));
            const podium = PODIUM_ORDER.map((rank) => byRank.get(rank)).filter(Boolean);

            return (
              <div className="spotlight-business-card" key={business.id}>
                <h3>{business.name}</h3>
                {top.length ? (
                  <div className="leaderboard-podium">
                    {podium.map((entry) => {
                      const meta = RANK_META[entry.rank] || RANK_META[3];
                      const RankIcon = meta.icon;
                      return (
                        <div className={`leaderboard-podium__slot tone-${meta.tone}`} key={entry.staff_id}>
                          <div className="leaderboard-podium__crown">
                            {entry.rank === 1 ? <RankIcon size={22} /> : null}
                          </div>
                          <div className="leaderboard-podium__avatar">
                            {entry.photo_url ? (
                              <img alt={entry.full_name} src={entry.photo_url} />
                            ) : (
                              <span>{initials(entry.full_name)}</span>
                            )}
                            <div className="leaderboard-podium__rank-badge">
                              {entry.rank > 1 ? <RankIcon size={14} /> : null}
                              <span>{entry.rank}</span>
                            </div>
                          </div>
                          <strong>{entry.full_name}</strong>
                          {entry.role ? <small>{entry.role}</small> : null}
                          <div className="leaderboard-podium__base">{meta.label}</div>
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
            );
          })}
        </div>
      )}

      {!loading && boards.some(({ top }) => top.length) ? (
        <p className="spotlight-footer-note">Think you've got what it takes? Next month's board is still wide open.</p>
      ) : null}
    </section>
  );
}
