import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Camera, CheckCircle2, Clock3, Lock, ShieldAlert } from 'lucide-react';
import EmptyState from './EmptyState';
import StatusBadge from './StatusBadge';
import { getChecklistHistory } from '../services/rtbService';
import { formatDate, formatDateTime } from '../utils/formatters';

const RANGE_OPTIONS = [
  { days: 7, label: 'Last 7 days' },
  { days: 14, label: 'Last 14 days' },
  { days: 30, label: 'Last 30 days' },
];

function localDateKey(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}

function getRunOwner(run) {
  return run.staff?.full_name
    || run.assigned_staff?.full_name
    || run.claimed_by?.full_name
    || run.items?.find((item) => item.completed_by?.full_name)?.completed_by?.full_name
    || null;
}

function classifyRun(run) {
  if (run.final_confirmed_at || run.confirmed_by?.full_name) return 'confirmed';
  const percent = Number(run.completion_percent || 0);
  const isPast = String(run.run_date) < localDateKey();
  if (isPast && percent === 0) return 'missed';
  if (isPast && percent < 100) return 'abandoned';
  if (percent > 0) return 'in_progress';
  return 'not_started';
}

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

    const owner = getRunOwner(run);
    const classification = classifyRun(run);
    if (owner && (classification === 'missed' || classification === 'abandoned')) {
      if (!byStaff.has(owner)) byStaff.set(owner, { completed: 0, missed: 0, name: owner });
      byStaff.get(owner).missed += 1;
    }
  });

  return [...byStaff.values()]
    .map((entry) => ({
      ...entry,
      rate: entry.completed + entry.missed
        ? Math.round((entry.completed / (entry.completed + entry.missed)) * 100)
        : 100,
    }))
    .sort((a, b) => b.rate - a.rate || b.completed - a.completed);
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

function buildRunIssues(runs) {
  return runs
    .filter((run) => run.scope === 'shared')
    .map((run) => ({ ...run, classification: classifyRun(run), ownerName: getRunOwner(run) }))
    .filter((run) => ['missed', 'abandoned', 'in_progress', 'not_started'].includes(run.classification))
    .sort((a, b) => String(b.run_date).localeCompare(String(a.run_date)));
}

function toneForClassification(classification) {
  if (classification === 'missed' || classification === 'abandoned') return 'danger';
  if (classification === 'in_progress') return 'warning';
  return 'muted';
}

function labelForClassification(classification) {
  if (classification === 'missed') return 'Missed';
  if (classification === 'abandoned') return 'Abandoned';
  if (classification === 'in_progress') return 'In progress';
  return 'Not started';
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
  const runIssues = useMemo(() => buildRunIssues(runs), [runs]);
  const confirmedRuns = useMemo(
    () => sharedRuns.filter((run) => classifyRun(run) === 'confirmed'),
    [sharedRuns],
  );
  const healthScore = useMemo(() => {
    if (!sharedRuns.length) return 100;
    const confirmedWeight = confirmedRuns.length * 100;
    const partialWeight = sharedRuns
      .filter((run) => classifyRun(run) !== 'confirmed')
      .reduce((sum, run) => sum + Number(run.completion_percent || 0), 0);
    return Math.round((confirmedWeight + partialWeight) / sharedRuns.length);
  }, [confirmedRuns, sharedRuns]);

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

      <div className="metric-grid" style={{ marginBottom: '1rem' }}>
        <article className="metric-card">
          <span>Operations health</span>
          <strong>{healthScore}%</strong>
          <small>{confirmedRuns.length} of {sharedRuns.length} shared shifts confirmed</small>
        </article>
        <article className="metric-card">
          <span>Needs attention</span>
          <strong>{runIssues.length + missedItems.length}</strong>
          <small>Missed, abandoned, active, or explained incomplete work</small>
        </article>
        <article className="metric-card">
          <span>Confirmed shifts</span>
          <strong>{confirmedRuns.length}</strong>
          <small>Verified opening and closing records</small>
        </article>
      </div>

      <div className="section-header">
        <div>
          <span>Needs attention</span>
          <h2>{runIssues.length ? `${runIssues.length} operational issue${runIssues.length === 1 ? '' : 's'}` : 'No shift issues'}</h2>
        </div>
      </div>
      {runIssues.length ? (
        <div className="chp-missed-list">
          {runIssues.slice(0, 20).map((run) => (
            <div className="chp-missed-item" key={run.id}>
              {run.classification === 'in_progress' ? <Clock3 size={17} /> : <ShieldAlert size={17} />}
              <div>
                <strong>{formatDate(run.run_date)} · {run.checklist_type}</strong>
                <small>
                  {run.ownerName ? `Responsible: ${run.ownerName} · ` : 'No responsible person recorded · '}
                  {Number(run.completion_percent || 0)}% complete
                </small>
                <p>
                  {run.classification === 'missed' && 'The shift passed with no checklist progress or confirmation.'}
                  {run.classification === 'abandoned' && 'The checklist was started but not completed or confirmed.'}
                  {run.classification === 'in_progress' && 'The checklist is currently active and still requires completion.'}
                  {run.classification === 'not_started' && 'The checklist exists but has not been started.'}
                </p>
              </div>
              <StatusBadge tone={toneForClassification(run.classification)}>
                {labelForClassification(run.classification)}
              </StatusBadge>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={CheckCircle2} title="No shift issues" message="All shared opening and closing records in this range are confirmed." />
      )}

      <div className="section-header">
        <div>
          <span>Participation and reliability</span>
          <h2>Who's contributing to shared shop tasks</h2>
        </div>
      </div>
      {participation.length ? (
        <div className="chp-participation-grid">
          {participation.map((entry) => (
            <div className="chp-participation-card" key={entry.name}>
              <strong>{entry.name}</strong>
              <span className="chp-participation-completed">{entry.completed} completed · {entry.rate}% completion</span>
              <span className={entry.missed ? 'chp-participation-missed' : 'subtle-text'}>
                {entry.missed} missed or incomplete
              </span>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={CheckCircle2} title="No completions yet" message="Completed shared tasks in this range will show participation here." />
      )}

      <div className="section-header">
        <div>
          <span>Skipped or could not complete</span>
          <h2>{missedItems.length ? `${missedItems.length} task${missedItems.length === 1 ? '' : 's'} need a look` : 'No explained exceptions'}</h2>
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
                  {formatDate(item.runDate)} · {item.checklistType} · {item.scope}
                  {item.completedByName ? ` · ${item.completedByName}` : ''}
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
        <EmptyState icon={CheckCircle2} title="No explained exceptions" message="No tasks were skipped or marked unable to complete in this range." />
      )}

      <div className="section-header">
        <div>
          <span>Recently completed</span>
          <h2>Verified opening and closing records</h2>
        </div>
      </div>
      {confirmedRuns.length ? (
        <div className="chp-runs-list">
          {confirmedRuns.map((run) => (
            <div className="chp-run-row" key={run.id}>
              <div>
                <strong>{formatDate(run.run_date)} · {run.checklist_type}</strong>
                <small>{run.completion_percent}% complete</small>
              </div>
              <span className="chp-confirmed">
                <Lock size={12} /> {run.confirmed_by?.full_name || getRunOwner(run) || 'Confirmed'} · {formatDateTime(run.final_confirmed_at)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={Lock} title="No confirmed shifts yet" message="Completed opening and closing confirmations will appear here." />
      )}
    </div>
  );
}
