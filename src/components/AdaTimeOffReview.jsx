import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Check, Clock3, ShieldAlert, Undo2, X } from 'lucide-react';
import { invokeRtbFunction } from '../lib/invokeRtbFunction';

function formatDate(value) {
  if (!value) return '';
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function dateRange(record) {
  const start = formatDate(record.start_date);
  const end = formatDate(record.end_date);
  return !end || end === start ? start : `${start} – ${end}`;
}

export default function AdaTimeOffReview({ businessUnitId, active, refreshKey = 0, onDecision }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [workingId, setWorkingId] = useState('');
  const [error, setError] = useState('');
  const [notes, setNotes] = useState({});
  const [pendingDecision, setPendingDecision] = useState(null);
  const [lastDecision, setLastDecision] = useState(null);

  const load = useCallback(async () => {
    if (!active || !businessUnitId) return;
    setLoading(true);
    setError('');
    try {
      const data = await invokeRtbFunction('ada-time-off', { action: 'list', businessId: businessUnitId });
      setRequests(Array.isArray(data?.requests) ? data.requests : []);
    } catch (err) {
      setError(err?.message || 'Unable to load time-off requests.');
    } finally {
      setLoading(false);
    }
  }, [active, businessUnitId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function decide(record, decision) {
    if (!record?.id || workingId) return;
    setWorkingId(record.id);
    setError('');
    try {
      await invokeRtbFunction('ada-time-off', {
        action: 'decide',
        businessId: businessUnitId,
        requestId: record.id,
        decision,
        confirmed: true,
        adminNote: notes[record.id] || '',
      });
      setRequests((current) => current.filter((item) => item.id !== record.id));
      setLastDecision({ record, decision });
      setPendingDecision(null);
      onDecision?.(record, decision);
    } catch (err) {
      setError(err?.message || 'Unable to update this time-off request.');
    } finally {
      setWorkingId('');
    }
  }

  async function undoDecision() {
    if (!lastDecision?.record?.id || workingId) return;
    setWorkingId(lastDecision.record.id);
    setError('');
    try {
      await invokeRtbFunction('ada-time-off', {
        action: 'reopen',
        businessId: businessUnitId,
        requestId: lastDecision.record.id,
        confirmed: true,
      });
      setRequests((current) => [...current, lastDecision.record].sort((a, b) => String(a.start_date).localeCompare(String(b.start_date))));
      setLastDecision(null);
      onDecision?.();
    } catch (err) {
      setError(err?.message || 'Unable to undo that decision.');
    } finally {
      setWorkingId('');
    }
  }

  const urgentCount = useMemo(
    () => requests.filter((record) => record.meets_notice_policy === false || Number(record.coverage_overlap_count || 0) > 0).length,
    [requests],
  );

  if (!active) return null;
  if (loading && !requests.length) return <div className="gemini-ops-brief__loading"><CalendarDays size={17} /> Loading time-off requests…</div>;
  if (!requests.length && !error) return null;

  return (
    <div className="gemini-ops-brief__suggested-tasks ada-time-off-review">
      <strong>Time off waiting for your decision{requests.length ? ` (${requests.length})` : ''}</strong>
      {urgentCount ? <small>{urgentCount} request{urgentCount === 1 ? '' : 's'} need extra review because of notice or coverage.</small> : null}
      {error ? <div className="gemini-ops-brief__error" role="status">{error}</div> : null}
      {lastDecision ? (
        <div className="action-row">
          <span>{lastDecision.record.staff_name}: {lastDecision.decision}.</span>
          <button className="ghost-button small" disabled={Boolean(workingId)} onClick={undoDecision} type="button"><Undo2 size={14} /> Undo</button>
        </div>
      ) : null}
      <ul>
        {requests.map((record) => (
          <li key={record.id}>
            <b>{record.staff_name}</b>
            <span><CalendarDays size={14} /> {dateRange(record)}</span>
            {record.reason ? <span><strong>Reason:</strong> {record.reason}</span> : <span><strong>Reason:</strong> Not provided</span>}
            <small>
              <Clock3 size={13} /> {Number.isFinite(Number(record.notice_hours)) ? `${record.notice_hours}h notice` : 'Notice timing unavailable'}
              {record.meets_notice_policy === false ? ' · below 48h policy' : record.meets_notice_policy === true ? ' · notice policy met' : ''}
              {Number(record.coverage_overlap_count || 0) > 0 ? ` · ${record.coverage_overlap_count} approved absence overlap` : ''}
            </small>
            {record.review_flags?.length ? (
              <span><ShieldAlert size={14} /> {record.review_flags.join(' · ')}</span>
            ) : null}
            <input
              aria-label={`Optional decision note for ${record.staff_name}`}
              onChange={(event) => setNotes((current) => ({ ...current, [record.id]: event.target.value }))}
              placeholder="Optional note to staff"
              value={notes[record.id] || ''}
            />
            <div className="action-row">
              {pendingDecision?.record.id === record.id ? (
                <>
                  <button className={pendingDecision.decision === 'approved' ? 'ghost-button small success-action' : 'ghost-button small'} disabled={workingId === record.id} onClick={() => decide(record, pendingDecision.decision)} type="button">
                    <Check size={14} /> Confirm {pendingDecision.decision === 'approved' ? 'approval' : 'denial'}
                  </button>
                  <button className="ghost-button small" onClick={() => setPendingDecision(null)} type="button"><X size={14} /> Cancel</button>
                </>
              ) : (
                <>
                  <button className="ghost-button small success-action" disabled={workingId === record.id} onClick={() => setPendingDecision({ record, decision: 'approved' })} type="button"><Check size={14} /> Approve</button>
                  <button className="ghost-button small" disabled={workingId === record.id} onClick={() => setPendingDecision({ record, decision: 'denied' })} type="button"><X size={14} /> Deny</button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
