import { useEffect, useState } from 'react';
import { Coffee } from 'lucide-react';
import EmptyState from './EmptyState';
import { getStaffAttendance } from '../services/rtbService';
import { formatCurrency, formatDate } from '../utils/formatters';

function hoursBetween(start, end) {
  if (!start || !end) return 0;
  return (new Date(end) - new Date(start)) / (1000 * 60 * 60);
}

// Groups real per-shift data (hours, declared tips, breaks -- all from
// Square) under the real weekly commission/net sales from payroll_entries
// for that week. Deliberately doesn't split the weekly commission total
// across shifts -- Square's shift records don't carry per-shift net sales,
// so showing a per-shift commission number would mean guessing, not real
// data. The weekly total shown is real; only the shift list beneath it is
// what's genuinely per-shift.
export default function TipsBreakdown({ businessUnitId, ownEntries = [], staffId }) {
  const [attendance, setAttendance] = useState([]);
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

    getStaffAttendance(businessUnitId, 60)
      .then((rows) => {
        if (!cancelled) setAttendance((rows || []).filter((row) => row.staff_id === staffId));
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Unable to load shift data.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [businessUnitId, staffId]);

  if (!businessUnitId) return null;

  const recentWeeks = ownEntries.slice(0, 6);

  return (
    <section className="panel full-span">
      <div className="section-header">
        <div>
          <span>Tips &amp; Commission</span>
          <h2>By shift and by week</h2>
        </div>
      </div>
      {error ? <div className="alert danger">{error}</div> : null}
      {loading ? (
        <p className="subtle-text">Loading...</p>
      ) : recentWeeks.length ? (
        <div className="tips-week-list">
          {recentWeeks.map((entry) => {
            const weekStart = entry.week_start ? new Date(entry.week_start) : null;
            const weekEnd = entry.week_end ? new Date(entry.week_end) : null;
            const weekShifts = weekStart && weekEnd
              ? attendance.filter((row) => {
                const clockIn = new Date(row.clock_in);
                return clockIn >= weekStart && clockIn <= new Date(weekEnd.getTime() + 24 * 60 * 60 * 1000);
              })
              : [];
            const shiftTips = weekShifts.reduce((sum, row) => sum + Number(row.declared_tips || 0), 0);

            return (
              <div className="tips-week-card" key={entry.id || entry.week_label}>
                <div className="tips-week-card__header">
                  <strong>{entry.week_label || 'Week'}</strong>
                  <span>{formatCurrency(entry.take_home)} take-home</span>
                </div>
                <div className="tips-week-card__totals">
                  <div>
                    <span>Net sales</span>
                    <strong>{formatCurrency(entry.net_sales)}</strong>
                  </div>
                  <div>
                    <span>Tips (payroll)</span>
                    <strong>{formatCurrency(entry.tips)}</strong>
                  </div>
                  {shiftTips > 0 ? (
                    <div>
                      <span>Tips (Square, declared)</span>
                      <strong>{formatCurrency(shiftTips)}</strong>
                    </div>
                  ) : null}
                </div>
                {weekShifts.length ? (
                  <div className="tips-shift-list">
                    {weekShifts.map((row) => (
                      <div className="tips-shift-row" key={row.id}>
                        <span>{formatDate(row.clock_in)}</span>
                        <span>{hoursBetween(row.clock_in, row.clock_out).toFixed(1)}h</span>
                        {Number(row.declared_tips || 0) > 0 ? (
                          <span>{formatCurrency(row.declared_tips)} tips</span>
                        ) : null}
                        {(row.breaks || []).length ? (
                          <span className="tips-shift-row__break">
                            <Coffee size={12} />{' '}
                            {(row.breaks || [])
                              .reduce(
                                (sum, brk) =>
                                  sum + (brk.start_at && brk.end_at ? hoursBetween(brk.start_at, brk.end_at) * 60 : 0),
                                0,
                              )
                              .toFixed(0)}
                            min
                          </span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="subtle-text">No Square-clocked shifts matched to this week yet.</p>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={Coffee}
          title="No payroll history yet"
          message="Your weekly commission and per-shift tips will show here once payroll runs."
        />
      )}
    </section>
  );
}
