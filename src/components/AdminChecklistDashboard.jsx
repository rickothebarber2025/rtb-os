import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Camera, CheckCircle2, Clock3, RefreshCw, Store, Users } from 'lucide-react';
import GoogleHomeConnectionPanel from './GoogleHomeConnectionPanel';
import { getChecklistHistory, getShopPresenceHistory } from '../services/rtbService';
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

function presenceStatusLabel(value) {
  const labels = {
    verified: 'Verified',
    late_signal: 'Late signal',
    early_signal: 'Early signal',
    after_hours: 'After hours',
    no_signal: 'No camera signal',
  };
  return labels[value] || 'Unknown';
}

function presenceTone(value) {
  if (value === 'verified') return 'success';
  if (value === 'no_signal') return 'neutral';
  return 'warning';
}

function shortTime(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-CA', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Toronto',
  }).format(new Date(value));
}

function deltaText(value, mode) {
  if (value === null || value === undefined) return '';
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) return '';
  if (mode === 'open') {
    if (minutes <= 0) return `${Math.abs(minutes)} min before public open`;
    return `${minutes} min after public open`;
  }
  if (minutes === 0) return 'at scheduled close';
  if (minutes < 0) return `${Math.abs(minutes)} min before close`;
  return `${minutes} min after close`;
}

export default function AdminChecklistDashboard({ businessUnitId }) {
  const [days, setDays] = useState(30);
  const [type, setType] = useState('all');
  const [staff, setStaff] = useState('all');
  const [runs, setRuns] = useState([]);
  const [presenceDays, setPresenceDays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [history, cameraHistory] = await Promise.all([
        getChecklistHistory(businessUnitId, days),
        getShopPresenceHistory(businessUnitId, days),
      ]);
      setRuns(history || []);
      setPresenceDays(cameraHistory || []);
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

  const cameraConnected = presenceDays.some((day) => day.activity_count > 0);

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

      <div className="shop-presence-verification" style={{ marginTop: '1rem' }}>
        <div className="section-header">
          <div>
            <span>Physical verification</span>
            <h3><Camera size={17} /> Google Home opening & closing</h3>
          </div>
          <span className={`status-badge ${cameraConnected ? 'success' : 'neutral'}`}>
            {cameraConnected ? 'Shop activity connected' : 'Waiting for camera events'}
          </span>
        </div>

        <GoogleHomeConnectionPanel businessUnitId={businessUnitId} embedded onSetupEventRecorded={load} />

        {businessUnitId ? (
          presenceDays.length ? (
            <div className="shop-presence-days">
              {presenceDays.slice(0, 7).map((day) => (
                <article className="shop-presence-day" key={day.business_date}>
                  <div className="shop-presence-day__date">
                    <strong>{formatDate(day.business_date)}</strong>
                    <small>{day.activity_count || 0} activity record{Number(day.activity_count || 0) === 1 ? '' : 's'}</small>
                  </div>
                  <div>
                    <span>First activity</span>
                    <strong>{shortTime(day.first_activity_at)}</strong>
                    <small>{deltaText(day.opening_delta_minutes, 'open')}</small>
                  </div>
                  <div>
                    <span>Last activity</span>
                    <strong>{shortTime(day.last_activity_at)}</strong>
                    <small>{deltaText(day.closing_delta_minutes, 'close')}</small>
                  </div>
                  <div className="shop-presence-day__status">
                    <span className={`status-badge ${presenceTone(day.opening_status)}`}>
                      Open: {presenceStatusLabel(day.opening_status)}
                    </span>
                    <span className={`status-badge ${presenceTone(day.closing_status)}`}>
                      Close: {presenceStatusLabel(day.closing_status)}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state compact">
              <h3>No Google Home activity yet</h3>
              <p>RTB OS is ready to store camera person/door events. Complete the Google Home authorization on the iPhone app to start the connection.</p>
            </div>
          )
        ) : (
          <div className="empty-state compact">
            <h3>Select one business</h3>
            <p>Camera verification is shown per business so opening and closing records stay properly separated.</p>
          </div>
        )}
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
