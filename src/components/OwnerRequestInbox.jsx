import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, MessageSquareReply, XCircle } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

/**
 * Management side of staff communication.
 *
 * Combines:
 * - staff operational requests
 * - time-off requests
 * - staff replies to management announcements
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
  const [announcementMessages, setAnnouncementMessages] = useState([]);

  const loadAnnouncementMessages = useCallback(async () => {
    if (!supabase) return;

    const { data, error: loadError } = await supabase
      .from('staff_announcement_messages')
      .select('id,announcement_id,staff_id,sender_kind,body,created_at,staff_announcements(title,business_unit_id)')
      .order('created_at', { ascending: true })
      .limit(300);

    if (!loadError) setAnnouncementMessages(data || []);
  }, []);

  useEffect(() => {
    loadAnnouncementMessages();
    if (!supabase) return undefined;

    const channel = supabase
      .channel('management-announcement-conversations')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'staff_announcement_messages' }, () => loadAnnouncementMessages())
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [loadAnnouncementMessages]);

  const pendingAnnouncementThreads = useMemo(() => {
    const groups = new Map();

    announcementMessages.forEach((message) => {
      const key = `${message.announcement_id}:${message.staff_id}`;
      const rows = groups.get(key) || [];
      rows.push(message);
      groups.set(key, rows);
    });

    return [...groups.values()]
      .filter((rows) => rows.length && rows[rows.length - 1].sender_kind === 'staff')
      .map((rows) => {
        const latest = rows[rows.length - 1];
        return {
          id: `announcement-${latest.announcement_id}-${latest.staff_id}`,
          kind: 'announcement',
          record: latest,
          announcementId: latest.announcement_id,
          staffId: latest.staff_id,
          who: staffById[latest.staff_id]?.full_name || staffById[latest.staff_id]?.preferred_name || 'Staff member',
          what: latest.body,
          label: `Reply · ${latest.staff_announcements?.title || 'Staff update'}`,
          priority: 'normal',
          when: latest.created_at,
          conversation: rows,
        };
      });
  }, [announcementMessages, staffById]);

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
    return [...ops, ...off, ...pendingAnnouncementThreads]
      .sort((a, b) => (rank[a.priority] ?? 2) - (rank[b.priority] ?? 2) || new Date(b.when) - new Date(a.when));
  }, [operationsRequests, timeOffRequests, staffById, pendingAnnouncementThreads]);

  function setDraft(id, value) {
    setDrafts((current) => ({ ...current, [id]: value }));
  }

  async function replyToAnnouncement(item, note) {
    const { error: replyError } = await supabase
      .from('staff_announcement_messages')
      .insert({
        announcement_id: item.announcementId,
        staff_id: item.staffId,
        sender_kind: 'manager',
        body: note,
      });

    if (replyError) throw replyError;
    await loadAnnouncementMessages();
  }

  async function act(item, action) {
    setError('');
    const note = (drafts[item.id] || '').trim();
    try {
      if (item.kind === 'announcement') {
        if (!note) return;
        await replyToAnnouncement(item, note);
      } else if (item.kind === 'time_off') {
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
        <h3 className="owner-inbox-title">Staff communication</h3>
        <p className="smc-empty">Nothing waiting. Staff requests and replies to updates land here.</p>
      </section>
    );
  }

  return (
    <section className="panel full-span owner-inbox">
      <h3 className="owner-inbox-title">Staff communication · {items.length}</h3>
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

          {item.kind === 'announcement' && item.conversation?.length ? (
            <div className="smc-reply-thread">
              {item.conversation.map((message) => (
                <div className={`smc-reply ${message.sender_kind === 'staff' ? 'smc-reply--staff' : ''}`} key={message.id}>
                  <span className="smc-reply-label">{message.sender_kind === 'staff' ? item.who : 'Management'}</span>
                  <p>{message.body}</p>
                </div>
              ))}
            </div>
          ) : <p className="owner-inbox-body">{item.what}</p>}

          <time className="smc-item-time" dateTime={item.when}>{relativeTime(item.when)}</time>

          <textarea
            className="owner-inbox-reply"
            rows={2}
            placeholder={item.kind === 'announcement' ? 'Reply in this conversation…' : 'Reply to them…'}
            value={drafts[item.id] || ''}
            onChange={(event) => setDraft(item.id, event.target.value)}
          />
          <div className="owner-inbox-actions">
            <button type="button" className="owner-inbox-btn" disabled={busy || !(drafts[item.id] || '').trim()} onClick={() => act(item, 'reply')}>
              <MessageSquareReply size={15} /> Reply
            </button>
            {item.kind !== 'announcement' ? (
              <>
                <button type="button" className="owner-inbox-btn owner-inbox-btn--done" disabled={busy} onClick={() => act(item, 'done')}>
                  <CheckCircle2 size={15} /> {item.kind === 'time_off' ? 'Approve' : 'Done'}
                </button>
                <button type="button" className="owner-inbox-btn owner-inbox-btn--decline" disabled={busy} onClick={() => act(item, 'decline')}>
                  <XCircle size={15} /> {item.kind === 'time_off' ? 'Decline' : 'Close'}
                </button>
              </>
            ) : null}
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
