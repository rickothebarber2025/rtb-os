import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, Check, ClipboardCheck, Clock3, LogIn, LogOut, RefreshCw, Store } from 'lucide-react';
import {
  claimMyOperationChecklist,
  endMyShift,
  getMyDailyOperations,
  setMyOperationItem,
  startMyShift,
} from '../services/staffOperationsService';

function timeLabel(value) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not recorded';
  return new Intl.DateTimeFormat('en-CA', { hour: 'numeric', minute: '2-digit' }).format(date);
}

function checklistTitle(type) {
  return type === 'opening' ? 'Opening checklist' : 'Closing checklist';
}

function ShiftStatus({ shift }) {
  if (!shift) return <span className="status-badge neutral">Not started</span>;
  if (shift.status === 'active') return <span className="status-badge success">Shift active</span>;
  if (shift.status === 'completed') return <span className="status-badge neutral">Shift complete</span>;
  return <span className="status-badge warning">{shift.status}</span>;
}

export default function StaffDailyOperationsCard({ businessUnitId }) {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [afterHoursReason, setAfterHoursReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setState(await getMyDailyOperations(businessUnitId));
    } catch (err) {
      setError(err.message || 'Unable to load today’s operations.');
    } finally {
      setLoading(false);
    }
  }, [businessUnitId]);

  useEffect(() => {
    load();
  }, [load]);

  const shift = state?.shift || null;
  const checklists = Array.isArray(state?.checklists) ? state.checklists : [];
  const unreadCount = useMemo(
    () => (Array.isArray(state?.notifications) ? state.notifications.filter((item) => !item.read_at).length : 0),
    [state?.notifications],
  );

  async function runAction(key, action, successMessage) {
    setWorking(key);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(successMessage);
      await load();
    } catch (err) {
      setError(err.message || 'The operation could not be completed.');
    } finally {
      setWorking('');
    }
  }

  async function toggleItem(item) {
    await runAction(
      `item-${item.id}`,
      () => setMyOperationItem(item.id, !item.completed),
      item.completed ? 'Checklist item reopened.' : 'Checklist item completed.',
    );
  }

  if (loading && !state) {
    return (
      <section className="panel full-span">
        <div className="section-header">
          <div>
            <span>Required today</span>
            <h2>Today at RTB</h2>
          </div>
          <RefreshCw className="spin" size={18} />
        </div>
      </section>
    );
  }

  return (
    <section className="panel full-span" aria-label="Today at RTB operations">
      <div className="section-header">
        <div>
          <span>Required today</span>
          <h2>Today at RTB</h2>
        </div>
        <div className="action-row">
          {unreadCount ? (
            <span className="status-badge warning"><Bell size={14} /> {unreadCount} reminders</span>
          ) : null}
          <button className="ghost-button small" disabled={loading || Boolean(working)} type="button" onClick={load}>
            <RefreshCw size={15} /> Refresh
          </button>
        </div>
      </div>

      {error ? <div className="alert danger">{error}</div> : null}
      {notice ? <div className="alert success">{notice}</div> : null}

      <div className="metric-grid">
        <article className="metric-card">
          <div className="metric-icon"><Clock3 size={18} /></div>
          <span>Shift status</span>
          <ShiftStatus shift={shift} />
          <small>In: {timeLabel(shift?.checked_in_at)} · Out: {timeLabel(shift?.checked_out_at)}</small>
          {Number(shift?.late_minutes || 0) > 0 ? (
            <small className="text-warning">Late by {shift.late_minutes} minutes after grace period</small>
          ) : null}
        </article>

        <article className="metric-card">
          <div className="metric-icon"><Store size={18} /></div>
          <span>Shop responsibilities</span>
          <strong>{checklists.filter((run) => run.status === 'completed').length} / {checklists.length || 2} complete</strong>
          <small>Claim only the opening or closing responsibility assigned to you.</small>
        </article>

        <article className="metric-card">
          <div className="metric-icon"><ClipboardCheck size={18} /></div>
          <span>Operations record</span>
          <strong>{shift?.status === 'completed' ? 'Recorded' : shift?.status === 'active' ? 'In progress' : 'Action needed'}</strong>
          <small>Your timestamps and checklist completion feed your operations history.</small>
        </article>
      </div>

      <div className="action-row" style={{ marginTop: '1rem' }}>
        {!shift?.checked_in_at ? (
          <button
            className="primary-button"
            disabled={Boolean(working)}
            type="button"
            onClick={() => runAction('start', () => startMyShift(businessUnitId), 'Shift started.')}
          >
            <LogIn size={17} /> {working === 'start' ? 'Starting…' : 'Start shift'}
          </button>
        ) : null}

        {shift?.status === 'active' ? (
          <>
            <input
              aria-label="Reason for staying after hours"
              className="input"
              placeholder="After-hours reason, when applicable"
              value={afterHoursReason}
              onChange={(event) => setAfterHoursReason(event.target.value)}
            />
            <button
              className="secondary-button"
              disabled={Boolean(working)}
              type="button"
              onClick={() => runAction(
                'end',
                () => endMyShift(businessUnitId, afterHoursReason),
                'Shift ended and recorded.',
              )}
            >
              <LogOut size={17} /> {working === 'end' ? 'Ending…' : 'End shift'}
            </button>
          </>
        ) : null}
      </div>

      <div className="two-column-grid" style={{ marginTop: '1rem' }}>
        {['opening', 'closing'].map((type) => {
          const run = checklists.find((entry) => entry.type === type);
          const items = Array.isArray(run?.items) ? run.items : [];
          const completed = items.filter((item) => item.completed).length;
          return (
            <article className="subpanel" key={type}>
              <div className="section-header compact">
                <div>
                  <span>{type === 'opening' ? 'Start of day' : 'End of day'}</span>
                  <h3>{checklistTitle(type)}</h3>
                </div>
                {run ? <span className={`status-badge ${run.status === 'completed' ? 'success' : 'warning'}`}>{run.status}</span> : null}
              </div>

              {!run ? (
                <button
                  className="secondary-button full-width"
                  disabled={Boolean(working)}
                  type="button"
                  onClick={() => runAction(
                    `claim-${type}`,
                    () => claimMyOperationChecklist(businessUnitId, type),
                    `${checklistTitle(type)} claimed.`,
                  )}
                >
                  <ClipboardCheck size={16} /> {working === `claim-${type}` ? 'Claiming…' : `Claim ${type}`}
                </button>
              ) : (
                <>
                  <div className="ops-progress"><span style={{ width: `${items.length ? (completed / items.length) * 100 : 0}%` }} /></div>
                  <small>{completed} of {items.length} complete</small>
                  <div className="ops-checklist-items" style={{ marginTop: '.75rem' }}>
                    {items.map((item) => (
                      <button
                        className={`ops-check-item ${item.completed ? 'done' : ''}`}
                        disabled={Boolean(working) || run.status === 'completed'}
                        key={item.id}
                        type="button"
                        onClick={() => toggleItem(item)}
                      >
                        <span>{item.completed ? <Check size={15} /> : null}</span>
                        {item.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
