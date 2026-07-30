import { useEffect, useState } from 'react';
import { Clock3, Coffee } from 'lucide-react';
import { getStaffAttendance } from '../services/rtbService';
import { formatDate } from '../utils/formatters';

function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // week starts Monday
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function hoursBetween(start, end) {
  if (!start || !end) return 0;
  return (new Date(end) - new Date(start)) / (1000 * 60 * 60);
}

export default function MyHoursWidget({ businessUnitId, staffId }) {
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

    getStaffAttendance(businessUnitId, 14)
      .then((rows) => {
        if (!cancelled) setAttendance((rows || []).filter((row) => row.staff_id === staffId));
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Unable to load your hours.');
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
  const thisWeekShifts = attendance.filter((row) => new Date(row.clock_in) >= weekStart);
  const totalHours = thisWeekShifts.reduce((sum, row) => sum + hoursBetween(row.clock_in, row.clock_out), 0);

  return (
    <article className="panel daily-ops-card">
      <div className="section-header">
        <div>
          <span>My Hours</span>
          <h2>{totalHours.toFixed(1)}h this week</h2>
        </div>
        <Clock3 size={20} />
      </div>
      {error ? <div className="alert danger">{error}</div> : null}
      {loading ? (
        <p className="subtle-text">Loading...</p>
      ) : thisWeekShifts.length ? (
        <div className="my-hours-list">
          {thisWeekShifts.map((row) => {
            const shiftHours = hoursBetween(row.clock_in, row.clock_out);
            const breakMinutes = (row.breaks || []).reduce((sum, brk) => {
              if (!brk.start_at || !brk.end_at) return sum;
              return sum + hoursBetween(brk.start_at, brk.end_at) * 60;
            }, 0);

            return (
              <div className="my-hours-row" key={row.id}>
                <span>{formatDate(row.clock_in)}</span>
                <strong>{row.clock_out ? `${shiftHours.toFixed(1)}h` : 'In progress'}</strong>
                {breakMinutes > 0 ? (
                  <small>
                    <Coffee size={12} /> {Math.round(breakMinutes)} min break
                  </small>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="subtle-text">No shifts clocked yet this week.</p>
      )}
    </article>
  );
}
