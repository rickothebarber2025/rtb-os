import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Camera, CheckCircle2, Lock } from 'lucide-react';
import EmptyState from './EmptyState';
import StatusBadge from './StatusBadge';
import { getChecklistHistory } from '../services/rtbService';
import { formatDate, formatDateTime } from '../utils/formatters';

const RANGE_OPTIONS = [
  { days: 7, label: 'Last 7 days' },
  { days: 14, label: 'Last 14 days' },
  { days: 30, label: 'Last 30 days' },
];

function buildParticipation(runs) {
  const byStaff = new Map();

  runs.forEach((run) => {
    (run.items || []).forEach((item) => {
      const name = item.completed_by?.full_name;
      if (!name) return;
      if (!byStaff.has(name)) byStaff.set(name, { completed: 0, missed: 0, name });
      const entry = byStaff.get(name);
      if (item.status === 'completed') entry.completed += 1;
      else if (item.status === 'skipped' || item.status === 'could_not_complete') entry.missed += 1;
    });
  });

  return [...byStaff.values()].sort((a, b) => b.completed - a.completed);
}

function buildMissedItems(runs) {
  const missed = [];
  runs.forEach((run) => {
    (run.items || []).forEach((item) => {
      if (item.status === 'skipped' || item.status === 'could_not_complete') {
        missed.push({
          businessUnitId: run.business_unit_id,
          checklistType: run.checklist_type,
          completedAt: item.completed_at,
          completedByName: item.completed_by?.full_name,
          label: item.label,
          note: item.note,
          photoUrl: item.photo_url,
          runDate: run.run_date,
          scope: run.scope,
          status: item.status,
        });
      }
    });
  });
  return missed.sort((a, b) => new Date(b.completedAt || 0) - new Date(a.completedAt || 0));
}

export default function ChecklistHistoryPanel({ businessUnitId }) {
  const [days, setDays] = useState(14);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    getChecklistHistory(businessUnitId, days)
      .then((data) => {
        if (!cancelled) setRuns(data || []);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Unable to load checklist history.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [businessUnitId, days]);

  const participation = useMemo(() => buildParticipation(runs), [runs]);
  const missedItems = useMemo(() => buildMissedItems(runs), [runs]);
  const sharedRuns = useMemo(() => runs.filter((run) => run.scope === 'shared'), [runs]);

  if (loading) return <p className="subtle-text">Loading checklist history...</p>;

  return (
    <div className="chp-panel">
      {error ? <div className="alert danger">{error}</div> : null}

      <div className="chp-range-toggle">
        {RANGE_OPTIONS.map((option) => (
          <button
            className={days === option.days ? 'active' : ''}
            key={option.days}
            onClick={() => setDays(option.days)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="section-header">
        <div>
          <span>Participation</span>
          <h2>Who's contributing to shared shop tasks</h2>
        </div>
      </div>
      {participation.length ? (
        <div className="chp-participation-grid">
          {participation.map((entry) => (
            <div className="chp-participation-card" key={entry.name}>
              <strong>{entry.name}</strong>
              <span className="chp-participation-completed">{entry.completed} completed</span>
              {entry.missed ? <span className="chp-participation-missed">{entry.missed} skipped/incomplete</span> : null}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={CheckCircle2} title="No completions yet" message="Completed shared tasks in this range will show participation here." />
      )}

      <div className="section-header">
        <div>
          <span>Missed or incomplete tasks</span>
          <h2>{missedItems.length ? `${missedItems.length} need a look` : 'Nothing outstanding'}</h2>
        </div>
      </div>
      {missedItems.length ? (
        <div className="chp-missed-list">
          {missedItems.slice(0, 20).map((item, index) => (
            <div className="chp-missed-item" key={`${item.label}-${index}`}>
              <AlertTriangle size={16} />
              <div>
                <strong>{item.label}</strong>
                <small>
                  {formatDate(item.runDate)} &middot; {item.checklistType} &middot; {item.scope}
                  {item.completedByName ? ` \u00b7 ${item.completedByName}` : ''}
                </small>
                {item.note ? <p>{item.note}</p> : <p className="chp-missed-no-note">No explanation given.</p>}
                {item.photoUrl ? (
                  <a href={item.photoUrl} rel="noreferrer" target="_blank">
                    <Camera size={12} /> View photo
                  </a>
                ) : null}
              </div>
              <StatusBadge tone="warning">{item.status === 'skipped' ? 'Skipped' : "Couldn't complete"}</StatusBadge>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={CheckCircle2} title="Clean record" message="No skipped or incomplete required tasks in this range." />
      )}

      <div className="section-header">
        <div>
          <span>Shift confirmations</span>
          <h2>Who confirmed the shop opened or closed</h2>
        </div>
      </div>
      {sharedRuns.length ? (
        <div className="chp-runs-list">
          {sharedRuns.map((run) => (
            <div className="chp-run-row" key={run.id}>
              <div>
                <strong>{formatDate(run.run_date)} &middot; {run.checklist_type}</strong>
                <small>{run.completion_percent}% complete</small>
              </div>
              {run.confirmed_by?.full_name ? (
                <span className="chp-confirmed">
                  <Lock size={12} /> {run.confirmed_by.full_name} &middot; {formatDateTime(run.final_confirmed_at)}
                </span>
              ) : (
                <StatusBadge tone={run.status === 'completed' ? 'success' : 'muted'}>Not confirmed</StatusBadge>
              )}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={Lock} title="No shared shifts yet" message="Opening and closing confirmations will appear here." />
      )}
    </div>
  );
}
