import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, RefreshCw, Store, Users } from 'lucide-react';
import { getChecklistHistory } from '../services/rtbService';
import { formatDate, formatDateTime } from '../utils/formatters';

const RANGE_OPTIONS = [
  { days: 7, label: '7 days' },
  { days: 14, label: '14 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

function completionPercent(run) {
  const items = Array.isArray(run?.items) ? run.items : [];
  if (items.length) {
    const completed = items.filter((item) => item.status === 'completed' || item.completed).length;
    return Math.round((completed / items.length) * 100);
  }
  return Number(run?.completion_percent || 0);
}

function staffName(run) {
  return run?.owner?.full_name || run?.staff_name_snapshot || 'Unassigned';
}

export default function AdminChecklistDashboard({ businessUnitId }) {
  const [days, setDays] = useState(30);
  const [type, setType] = useState('all');
  const [staff, setStaff] = useState('all');
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      setRuns((await getChecklistHistory(businessUnitId, days)) || []);
    } catch (err) {
      setError(err.message || 'Unable to load opening and closing history.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [businessUnitId, days]);

  const staffOptions = useMemo(
    () => [...new Set(runs.map(staffName).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [runs],
  );

  const filteredRuns = useMemo(
    () => runs.filter((run) => {
      if (type !== 'all' && run.checklist_type !== type) return false;
      if (staff !== 'all' && staffName(run) !== staff) return false;
      return true;
    }),
    [runs, staff, type],
  );

  const summary = useMemo(() => {
    const completed = filteredRuns.filter((run) => completionPercent(run) === 100).length;
    const incomplete = filteredRuns.length - completed;
    const confirmed = filteredRuns.filter((run) => run.final_confirmed_at || run.confirmed_by?.full_name).length;
    const contributors = new Set(filteredRuns.map(staffName).filter((name) => name !== 'Unassigned')).size;
    return { completed, confirmed, contributors, incomplete, total: filteredRuns.length };
  }, [filteredRuns]);

  return (
    <section className="panel full-span admin-checklist-dashboard">
      <div className="section-header">
        <div>
          <span>Admin tracking</span>
          <h2>Opening & closing history</h2>
        </div>
        <button className="ghost-button small" disabled={loading} type="button" onClick={load}>
          <RefreshCw className={loading ? 'spin' : ''} size={15} /> Refresh
        </button>
      </div>

      {error ? <div className="alert danger">{error}</div> : null}

      <div className="chp-range-toggle" aria-label="History range">
        {RANGE_OPTIONS.map((option) => (
          <button
            className={days === option.days ? 'active' : ''}
            key={option.days}
            type="button"
            onClick={() => setDays(option.days)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="form-grid" style={{ marginTop: '1rem' }}>
        <label className="field">
          <span>Checklist</span>
          <select value={type} onChange={(event) => setType(event.target.value)}>
            <option value="all">Opening and closing</option>
            <option value="opening">Opening only</option>
            <option value="closing">Closing only</option>
          </select>
        </label>
        <label className="field">
          <span>Staff member</span>
          <select value={staff} onChange={(event) => setStaff(event.target.value)}>
            <option value="all">All staff</option>
            {staffOptions.map((name) => <option key={name}>{name}</option>)}
          </select>
        </label>
      </div>

      <div className="metric-grid" style={{ marginTop: '1rem' }}>
        <article className="metric-card"><Store size={18} /><span>Total runs</span><strong>{summary.total}</strong></article>
        <article className="metric-card"><CheckCircle2 size={18} /><span>100% complete</span><strong>{summary.completed}</strong></article>
        <article className="metric-card"><Clock3 size={18} /><span>Confirmed</span><strong>{summary.confirmed}</strong></article>
        <article className="metric-card"><Users size={18} /><span>Contributors</span><strong>{summary.contributors}</strong></article>
        <article className="metric-card"><AlertTriangle size={18} /><span>Incomplete</span><strong>{summary.incomplete}</strong></article>
      </div>

      {loading ? <p className="subtle-text">Loading opening and closing records...</p> : null}

      {!loading && filteredRuns.length ? (
        <div className="chp-runs-list" style={{ marginTop: '1rem' }}>
          {filteredRuns.map((run) => {
            const percent = completionPercent(run);
            const items = Array.isArray(run.items) ? run.items : [];
            const missed = items.filter((item) => !['completed', true].includes(item.status) && !item.completed);
            return (
              <details className="chp-run-row" key={run.id}>
                <summary style={{ cursor: 'pointer', width: '100%' }}>
                  <div>
                    <strong>{formatDate(run.run_date)} · {run.checklist_type}</strong>
                    <small>{staffName(run)} · {percent}% complete · {run.scope || 'shared'}</small>
                  </div>
                  <span className={`status-badge ${percent === 100 ? 'success' : 'warning'}`}>
                    {percent === 100 ? 'Complete' : `${missed.length || 'Some'} incomplete`}
                  </span>
                </summary>
                <div className="ops-checklist-items" style={{ marginTop: '.75rem', width: '100%' }}>
                  {items.map((item) => (
                    <div className={`ops-check-item ${item.status === 'completed' || item.completed ? 'done' : ''}`} key={item.id}>
                      <span>{item.status === 'completed' || item.completed ? '✓' : '!'}</span>
                      <div>
                        <strong>{item.label}</strong>
                        <small>
                          {item.completed_by?.full_name || 'No staff recorded'}
                          {item.completed_at ? ` · ${formatDateTime(item.completed_at)}` : ''}
                        </small>
                        {item.note ? <p>{item.note}</p> : null}
                        {item.photo_url ? <a href={item.photo_url} target="_blank" rel="noreferrer">View photo</a> : null}
                      </div>
                    </div>
                  ))}
                </div>
                <small style={{ marginTop: '.75rem' }}>
                  {run.confirmed_by?.full_name
                    ? `Confirmed by ${run.confirmed_by.full_name}${run.final_confirmed_at ? ` on ${formatDateTime(run.final_confirmed_at)}` : ''}`
                    : 'Not finally confirmed'}
                </small>
              </details>
            );
          })}
        </div>
      ) : null}

      {!loading && !filteredRuns.length ? (
        <div className="empty-state compact">
          <h3>No matching opening or closing records</h3>
          <p>Completed staff checklists will appear here once they exist in Supabase for this business and date range.</p>
        </div>
      ) : null}
    </section>
  );
}
