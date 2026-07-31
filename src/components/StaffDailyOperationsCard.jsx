import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bell,
  CalendarOff,
  Check,
  ClipboardCheck,
  Clock3,
  LogIn,
  LogOut,
  RefreshCw,
  Store,
} from 'lucide-react';
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
  if (!shift) return <span className="status-badge neutral">Not working today</span>;
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
  const [showCoverageOptions, setShowCoverageOptions] = useState(false);

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
  const assignedChecklists = checklists.filter(Boolean);
  const completedChecklists = assignedChecklists.filter((run) => run.status === 'completed').length;
  const hasDailyAssignment = Boolean(shift) || assignedChecklists.length > 0;
  const unreadCount = useMemo(
    () => (Array.isArray(state?.notifications) ? state.notifications.filter((item) => !item.read_at).length : 0),
    [state?.notifications],
  );

  async function runAction(key, action, successMessage) {
    setWorking(key);
    setError('');
    setNotice('');
    try {
      const result = await action();
      if (result === null || result === undefined) {
        throw new Error('The database did not confirm this action.');
      }
      await load();
      setNotice(successMessage);
    } catch (err) {
      setError(err.message || 'The operation could not be completed. Nothing was marked complete.');
    } finally {
      setWorking('');
    }
  }

  async function toggleItem(item) {
    await runAction(
      `item-${item.id}`,
      () => setMyOperationItem(item.id, !item.completed),
      item.completed ? 'Checklist item reopened.' : 'Checklist item saved and attributed to your account.',
    );
  }

  if (loading && !state) {
    return (
      <section className="panel full-span">
        <div className="section-header">
          <div>
            <span>Today</span>
            <h2>My RTB day</h2>
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
          <span>{hasDailyAssignment ? 'Your work today' : 'No required duties'}</span>
          <h2>{hasDailyAssignment ? 'Today at RTB' : 'You are off today'}</h2>
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

      {!hasDailyAssignment ? (
        <div className="subpanel empty-day-card">
          <div className="metric-icon"><CalendarOff size={20} /></div>
          <div>
            <h3>No shift or shop duty is assigned to you today</h3>
            <p>You do not need to clock in, open, close, or complete an operations checklist.</p>
          </div>
          <button
            className="secondary-button"
            disabled={Boolean(working)}
            type="button"
            onClick={() => runAction('start', () => startMyShift(businessUnitId), 'Shift started.')}
          >
            <LogIn size={17} /> {working === 'start' ? 'Starting…' : 'I am working today'}
          </button>
        </div>
      ) : (
        <>
          <div className="metric-grid">
            <article className="metric-card">
              <div className="metric-icon"><Clock3 size={18} /></div>
              <span>My shift</span>
              <ShiftStatus shift={shift} />
              <small>In: {timeLabel(shift?.checked_in_at)} · Out: {timeLabel(shift?.checked_out_at)}</small>
              {Number(shift?.late_minutes || 0) > 0 ? (
                <small className="text-warning">Late by {shift.late_minutes} minutes after grace period</small>
              ) : null}
            </article>

            <article className="metric-card">
              <div className="metric-icon"><Store size={18} /></div>
              <span>Assigned shop duties</span>
              <strong>
                {assignedChecklists.length
                  ? `${completedChecklists} / ${assignedChecklists.length} complete`
                  : 'None assigned'}
              </strong>
              <small>Only duties assigned or intentionally covered by you appear here.</small>
            </article>

            <article className="metric-card">
              <div className="metric-icon"><ClipboardCheck size={18} /></div>
              <span>Today’s status</span>
              <strong>
                {shift?.status === 'completed'
                  ? 'Recorded'
                  : shift?.status === 'active'
                    ? 'In progress'
                    : assignedChecklists.length
                      ? 'Duty assigned'
                      : 'No action needed'}
              </strong>
              <small>Your shift and assigned checklist history are recorded separately.</small>
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

          {assignedChecklists.length ? (
            <div className="two-column-grid" style={{ marginTop: '1rem' }}>
              {assignedChecklists.map((run) => {
                const items = Array.isArray(run?.items) ? run.items : [];
                const completed = items.filter((item) => item.completed).length;
                return (
                  <article className="subpanel" key={run.id || run.type}>
                    <div className="section-header compact">
                      <div>
                        <span>{run.type === 'opening' ? 'Start of day' : 'End of day'}</span>
                        <h3>{checklistTitle(run.type)}</h3>
                      </div>
                      <span className={`status-badge ${run.status === 'completed' ? 'success' : 'warning'}`}>
                        {run.status}
                      </span>
                    </div>
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
                          {working === `item-${item.id}` ? 'Saving…' : item.label}
                        </button>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : null}

          {shift?.status === 'active' && assignedChecklists.length < 2 ? (
            <div className="subpanel" style={{ marginTop: '1rem' }}>
              <div className="section-header compact">
                <div>
                  <span>Optional coverage</span>
                  <h3>Cover a shop duty</h3>
                </div>
                <button className="ghost-button small" type="button" onClick={() => setShowCoverageOptions((current) => !current)}>
                  {showCoverageOptions ? 'Hide' : 'Show options'}
                </button>
              </div>
              {showCoverageOptions ? (
                <div className="action-row">
                  {!assignedChecklists.some((run) => run.type === 'opening') ? (
                    <button
                      className="secondary-button"
                      disabled={Boolean(working)}
                      type="button"
                      onClick={() => runAction(
                        'claim-opening',
                        () => claimMyOperationChecklist(businessUnitId, 'opening'),
                        'Opening responsibility added to your day.',
                      )}
                    >
                      <ClipboardCheck size={16} /> Cover opening
                    </button>
                  ) : null}
                  {!assignedChecklists.some((run) => run.type === 'closing') ? (
                    <button
                      className="secondary-button"
                      disabled={Boolean(working)}
                      type="button"
                      onClick={() => runAction(
                        'claim-closing',
                        () => claimMyOperationChecklist(businessUnitId, 'closing'),
                        'Closing responsibility added to your day.',
                      )}
                    >
                      <ClipboardCheck size={16} /> Cover closing
                    </button>
                  ) : null}
                </div>
              ) : (
                <p>This is optional. Use it only when management asks you to cover an unassigned opening or closing duty.</p>
              )}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
