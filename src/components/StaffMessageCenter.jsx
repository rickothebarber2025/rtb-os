import { useMemo, useState } from 'react';
import { Send } from 'lucide-react';
import { QUICK_STARTS, classifyStaffMessage, staffFacingStatus } from '../utils/staffMessageIntent';

/**
 * One place for staff to reach Ricko, and one place to see what happened.
 *
 * Replaces the separate "Report Something", "Shift Notes" and time-off
 * forms with a single composer that reads like texting. Staff type what
 * they need; the app decides where it goes. Below it, every request they
 * have sent, with a plain status and Ricko's reply when there is one.
 */
export default function StaffMessageCenter({
  staffId,
  businessId,
  operationsRequests = [],
  timeOffRequests = [],
  busy = false,
  onSendOperations,
  onSendTimeOff,
}) {
  const [text, setText] = useState('');
  const [pendingDate, setPendingDate] = useState('');
  const [error, setError] = useState('');
  const [sentFlash, setSentFlash] = useState('');

  const preview = useMemo(() => (text.trim() ? classifyStaffMessage(text) : null), [text]);
  const needsDate = preview?.destination === 'time_off' && preview.needsDate && !pendingDate;

  const thread = useMemo(() => {
    const mine = (record) => !staffId || record.staff_id === staffId;
    const ops = operationsRequests.filter(mine).map((r) => ({
      id: `ops-${r.id}`,
      when: r.created_at,
      what: r.details || r.title,
      kind: r.category === 'general' ? r.request_type : r.category,
      reply: r.manager_note,
      record: r,
    }));
    const off = timeOffRequests.filter(mine).map((r) => ({
      id: `off-${r.id}`,
      when: r.created_at,
      what: r.reason || `Time off ${r.start_date}${r.end_date && r.end_date !== r.start_date ? ` to ${r.end_date}` : ''}`,
      kind: 'time_off',
      reply: r.admin_note,
      record: r,
    }));
    return [...ops, ...off].sort((a, b) => new Date(b.when) - new Date(a.when)).slice(0, 12);
  }, [operationsRequests, timeOffRequests, staffId]);

  async function send(event) {
    event?.preventDefault?.();
    setError('');
    const body = text.trim();
    if (!body) return;
    if (!businessId) { setError('Pick your shop first.'); return; }

    const decision = classifyStaffMessage(body);
    try {
      if (decision.destination === 'time_off') {
        const date = decision.start_date || pendingDate;
        if (!date) { setError('Which day? Pick a date below.'); return; }
        await onSendTimeOff({ start_date: date, end_date: date, reason: body });
      } else {
        await onSendOperations({
          request_type: decision.request_type,
          category: decision.category,
          priority: decision.priority,
          title: decision.title,
          details: decision.details,
        });
      }
      setText('');
      setPendingDate('');
      setSentFlash(`Sent to Ricko as ${decision.label.toLowerCase()}.`);
      window.setTimeout(() => setSentFlash(''), 3500);
    } catch (sendError) {
      setError(sendError?.message || 'Could not send. Try again.');
    }
  }

  function seed(value) {
    setText(value);
    setError('');
  }

  return (
    <section className="panel full-span staff-message-center">
      <form className="smc-composer" onSubmit={send}>
        <div className="smc-chips" role="group" aria-label="Quick starts">
          {QUICK_STARTS.map((chip) => (
            <button key={chip.label} type="button" className="smc-chip" onClick={() => seed(chip.seed)}>
              {chip.label}
            </button>
          ))}
        </div>

        <label className="smc-field">
          <span className="sr-only">Tell Ricko</span>
          <textarea
            value={text}
            rows={3}
            placeholder="Tell Ricko anything — running late, need Friday off, out of blades, chair’s broken…"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') send(event);
            }}
          />
        </label>

        {preview ? (
          <div className="smc-preview">
            <span className="smc-preview-label">Goes to Ricko as</span>
            <strong>{preview.label}</strong>
            {preview.destination === 'time_off' && preview.start_date ? <span> · {preview.start_date}</span> : null}
            {preview.priority === 'urgent' ? <span className="smc-urgent"> · marked urgent</span> : null}
          </div>
        ) : null}

        {needsDate ? (
          <label className="smc-field smc-date">
            <span>Which day?</span>
            <input type="date" value={pendingDate} onChange={(event) => setPendingDate(event.target.value)} />
          </label>
        ) : null}

        {error ? <p className="smc-error" role="alert">{error}</p> : null}
        {sentFlash ? <p className="smc-flash" role="status">{sentFlash}</p> : null}

        <button className="primary-button smc-send" type="submit" disabled={busy || !text.trim() || needsDate}>
          <Send size={16} /> {busy ? 'Sending…' : 'Send to Ricko'}
        </button>
      </form>

      <div className="smc-thread">
        <h3 className="smc-thread-title">Your requests</h3>
        {thread.length ? thread.map((item) => {
          const status = staffFacingStatus(item.record);
          return (
            <article key={item.id} className={`smc-item smc-item--${status.tone}`}>
              <div className="smc-item-head">
                <span className="smc-item-kind">{formatKind(item.kind)}</span>
                <span className={`smc-status smc-status--${status.tone}`}>{status.label}</span>
              </div>
              <p className="smc-item-body">{item.what}</p>
              <time className="smc-item-time" dateTime={item.when}>{relativeTime(item.when)}</time>
              {item.reply ? (
                <div className="smc-reply">
                  <span className="smc-reply-label">Ricko</span>
                  <p>{item.reply}</p>
                </div>
              ) : null}
            </article>
          );
        }) : (
          <p className="smc-empty">Nothing sent yet. Whatever you send shows up here with a status, and Ricko’s reply when he answers.</p>
        )}
      </div>
    </section>
  );
}

function formatKind(kind) {
  const map = {
    attendance_late: 'Running late',
    attendance_absent: 'Absence',
    supplies: 'Supplies',
    maintenance: 'Something broke',
    client_issue: 'Client issue',
    commission_pay: 'Pay question',
    availability_change: 'Schedule change',
    question: 'Question',
    time_off: 'Time off',
    inventory: 'Supplies',
    incident: 'Report',
  };
  return map[kind] || String(kind || 'Request').replace(/_/g, ' ');
}

function relativeTime(iso) {
  if (!iso) return '';
  const mins = (Date.now() - new Date(iso).getTime()) / 60000;
  if (mins < 1) return 'just now';
  if (mins < 60) return `${Math.round(mins)} min ago`;
  if (mins < 1440) return `${Math.round(mins / 60)} hr ago`;
  const days = Math.round(mins / 1440);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}
