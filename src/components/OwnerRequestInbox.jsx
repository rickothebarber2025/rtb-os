import { useMemo, useState } from 'react';
import { CheckCircle2, MessageSquareReply, XCircle } from 'lucide-react';

/**
 * The owner's side of the message channel.
 *
 * Every open staff request in one list, newest first, each with a reply
 * box. Replying writes manager_note / admin_note, which is what the staff
 * thread displays as "Ricko replied". Marking done or declining is the same
 * action with a status change. Nothing here is automated — every reply is
 * typed by the owner.
 */
export default function OwnerRequestInbox({
  operationsRequests = [],
  timeOffRequests = [],
  staffById = {},
  busy = false,
  onReplyOperations,
  onDecideTimeOff,
}) {
  const [drafts, setDrafts] = useState({});
  const [error, setError] = useState('');

  const items = useMemo(() => {
    const isOpen = (s) => !['completed', 'resolved', 'denied', 'rejected', 'cancelled', 'approved'].includes(String(s || '').toLowerCase());
    const ops = operationsRequests.filter((r) => isOpen(r.status)).map((r) => ({
      id: `ops-${r.id}`,
      kind: 'operations',
      record: r,
      who: staffById[r.staff_id]?.full_name || staffById[r.staff_id]?.preferred_name || 'Unknown staff',
      what: r.details || r.title,
      label: labelFor(r.category === 'general' ? r.request_type : r.category),
      priority: r.priority,
      when: r.created_at,
    }));
    const off = timeOffRequests.filter((r) => isOpen(r.status)).map((r) => ({
      id: `off-${r.id}`,
      kind: 'time_off',
      record: r,
      who: staffById[r.staff_id]?.full_name || staffById[r.staff_id]?.preferred_name || 'Unknown staff',
      what: r.reason || 'Time off',
      label: `Time off · ${r.start_date}${r.end_date && r.end_date !== r.start_date ? ` to ${r.end_date}` : ''}`,
      priority: 'normal',
      when: r.created_at,
    }));
    const rank = { urgent: 0, high: 1, normal: 2, low: 3 };
    return [...ops, ...off].sort((a, b) => (rank[a.priority] ?? 2) - (rank[b.priority] ?? 2) || new Date(b.when) - new Date(a.when));
  }, [operationsRequests, timeOffRequests, staffById]);

  function setDraft(id, value) {
    setDrafts((current) => ({ ...current, [id]: value }));
  }

  async function act(item, action) {
    setError('');
    const note = (drafts[item.id] || '').trim();
    try {
      if (item.kind === 'time_off') {
        await onDecideTimeOff(item.record.id, action === 'done' ? 'approved' : action === 'decline' ? 'denied' : item.record.status || 'pending', note);
      } else {
        const status = action === 'done' ? 'completed' : action === 'decline' ? 'cancelled' : 'in_progress';
        await onReplyOperations(item.record, { manager_note: note || item.record.manager_note || null, status });
      }
      setDrafts((current) => ({ ...current, [item.id]: '' }));
    } catch (actError) {
      setError(actError?.message || 'Could not save.');
    }
  }

  if (!items.length) {
    return (
      <section className="panel full-span owner-inbox">
        <h3 className="owner-inbox-title">Staff requests</h3>
        <p className="smc-empty">Nothing waiting. New requests from staff land here.</p>
      </section>
    );
  }

  return (
    <section className="panel full-span owner-inbox">
      <h3 className="owner-inbox-title">Staff requests · {items.length}</h3>
      {error ? <p className="smc-error" role="alert">{error}</p> : null}
      {items.map((item) => (
        <article key={item.id} className={`owner-inbox-item owner-inbox-item--${item.priority}`}>
          <div className="owner-inbox-head">
            <strong>{item.who}</strong>
            <span className="owner-inbox-label">{item.label}</span>
            {item.priority === 'urgent' || item.priority === 'high' ? (
              <span className={`smc-status smc-status--${item.priority === 'urgent' ? 'denied' : 'active'}`}>{item.priority}</span>
            ) : null}
          </div>
          <p className="owner-inbox-body">{item.what}</p>
          <time className="smc-item-time" dateTime={item.when}>{relativeTime(item.when)}</time>

          <textarea
            className="owner-inbox-reply"
            rows={2}
            placeholder="Reply to them…"
            value={drafts[item.id] || ''}
            onChange={(event) => setDraft(item.id, event.target.value)}
          />
          <div className="owner-inbox-actions">
            <button type="button" className="owner-inbox-btn" disabled={busy || !(drafts[item.id] || '').trim()} onClick={() => act(item, 'reply')}>
              <MessageSquareReply size={15} /> Reply
            </button>
            <button type="button" className="owner-inbox-btn owner-inbox-btn--done" disabled={busy} onClick={() => act(item, 'done')}>
              <CheckCircle2 size={15} /> {item.kind === 'time_off' ? 'Approve' : 'Done'}
            </button>
            <button type="button" className="owner-inbox-btn owner-inbox-btn--decline" disabled={busy} onClick={() => act(item, 'decline')}>
              <XCircle size={15} /> {item.kind === 'time_off' ? 'Decline' : 'Close'}
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}

function labelFor(kind) {
  const map = {
    attendance_late: 'Running late', attendance_absent: 'Absence', supplies: 'Supplies',
    maintenance: 'Something broke', client_issue: 'Client issue', commission_pay: 'Pay question',
    availability_change: 'Schedule change', question: 'Question', inventory: 'Supplies', incident: 'Report',
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
