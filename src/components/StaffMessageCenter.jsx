import { useCallback, useEffect, useMemo, useState } from 'react';
import { MessageSquareReply, Send } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { QUICK_STARTS, classifyStaffMessage, staffFacingStatus } from '../utils/staffMessageIntent';

/**
 * Staff communication center.
 *
 * Keeps requests and management updates in one place:
 * - staff can send requests to management
 * - staff can see management announcements for their business
 * - staff can reply to an announcement and continue the conversation
 * - manager replies arrive back in the same announcement thread
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
  const [announcements, setAnnouncements] = useState([]);
  const [announcementMessages, setAnnouncementMessages] = useState([]);
  const [replyDrafts, setReplyDrafts] = useState({});
  const [replying, setReplying] = useState('');

  const preview = useMemo(() => (text.trim() ? classifyStaffMessage(text) : null), [text]);
  const needsDate = preview?.destination === 'time_off' && preview.needsDate && !pendingDate;

  const loadAnnouncements = useCallback(async () => {
    if (!supabase || !staffId) return;

    let announcementQuery = supabase
      .from('staff_announcements')
      .select('id,business_unit_id,title,body,category,pinned,created_by,created_at,updated_at')
      .is('archived_at', null)
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(20);

    if (businessId) {
      announcementQuery = announcementQuery.or(`business_unit_id.is.null,business_unit_id.eq.${businessId}`);
    }

    const [{ data: announcementRows, error: announcementError }, { data: messageRows, error: messageError }] =
      await Promise.all([
        announcementQuery,
        supabase
          .from('staff_announcement_messages')
          .select('id,announcement_id,staff_id,sender_kind,body,created_at')
          .eq('staff_id', staffId)
          .order('created_at', { ascending: true })
          .limit(200),
      ]);

    if (!announcementError) setAnnouncements(announcementRows || []);
    if (!messageError) setAnnouncementMessages(messageRows || []);
  }, [businessId, staffId]);

  useEffect(() => {
    loadAnnouncements();
    if (!supabase || !staffId) return undefined;

    const channel = supabase
      .channel(`staff-communication-${staffId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff_announcements' }, () => loadAnnouncements())
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'staff_announcement_messages', filter: `staff_id=eq.${staffId}` },
        () => loadAnnouncements(),
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [loadAnnouncements, staffId]);

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

  const messagesByAnnouncement = useMemo(() => {
    const grouped = new Map();
    announcementMessages.forEach((message) => {
      const rows = grouped.get(message.announcement_id) || [];
      rows.push(message);
      grouped.set(message.announcement_id, rows);
    });
    return grouped;
  }, [announcementMessages]);

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
      setSentFlash(`Sent to management as ${decision.label.toLowerCase()}.`);
      window.setTimeout(() => setSentFlash(''), 3500);
    } catch (sendError) {
      setError(sendError?.message || 'Could not send. Try again.');
    }
  }

  async function sendAnnouncementReply(announcementId) {
    const body = String(replyDrafts[announcementId] || '').trim();
    if (!body || !supabase || !staffId) return;

    setReplying(announcementId);
    setError('');
    const { error: replyError } = await supabase
      .from('staff_announcement_messages')
      .insert({
        announcement_id: announcementId,
        staff_id: staffId,
        sender_kind: 'staff',
        body,
      });

    if (replyError) {
      setError(replyError.message || 'Could not send your reply.');
    } else {
      setReplyDrafts((current) => ({ ...current, [announcementId]: '' }));
      setSentFlash('Reply sent to management.');
      await loadAnnouncements();
      window.setTimeout(() => setSentFlash(''), 3500);
    }
    setReplying('');
  }

  function seed(value) {
    setText(value);
    setError('');
  }

  return (
    <section className="panel full-span staff-message-center">
      <div className="smc-thread">
        <h3 className="smc-thread-title">Team updates</h3>
        {announcements.length ? announcements.map((announcement) => {
          const messages = messagesByAnnouncement.get(announcement.id) || [];
          return (
            <article key={announcement.id} className="smc-item smc-item--active">
              <div className="smc-item-head">
                <span className="smc-item-kind">{announcement.category || 'Update'}</span>
                {announcement.pinned ? <span className="smc-status smc-status--active">Pinned</span> : null}
              </div>
              <strong>{announcement.title}</strong>
              <p className="smc-item-body">{announcement.body}</p>
              <time className="smc-item-time" dateTime={announcement.created_at}>{relativeTime(announcement.created_at)}</time>

              {messages.length ? (
                <div className="smc-reply-thread">
                  {messages.map((message) => (
                    <div className={`smc-reply ${message.sender_kind === 'staff' ? 'smc-reply--staff' : ''}`} key={message.id}>
                      <span className="smc-reply-label">{message.sender_kind === 'staff' ? 'You' : 'Management'}</span>
                      <p>{message.body}</p>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="smc-announcement-reply">
                <textarea
                  rows={2}
                  placeholder="Reply to this update…"
                  value={replyDrafts[announcement.id] || ''}
                  onChange={(event) => setReplyDrafts((current) => ({ ...current, [announcement.id]: event.target.value }))}
                />
                <button
                  className="ghost-button small"
                  disabled={replying === announcement.id || !String(replyDrafts[announcement.id] || '').trim()}
                  onClick={() => sendAnnouncementReply(announcement.id)}
                  type="button"
                >
                  <MessageSquareReply size={15} /> {replying === announcement.id ? 'Sending…' : 'Reply'}
                </button>
              </div>
            </article>
          );
        }) : <p className="smc-empty">No management updates yet.</p>}
      </div>

      <form className="smc-composer" onSubmit={send}>
        <h3 className="smc-thread-title">Message management</h3>
        <div className="smc-chips" role="group" aria-label="Quick starts">
          {QUICK_STARTS.map((chip) => (
            <button key={chip.label} type="button" className="smc-chip" onClick={() => seed(chip.seed)}>
              {chip.label}
            </button>
          ))}
        </div>

        <label className="smc-field">
          <span className="sr-only">Message management</span>
          <textarea
            value={text}
            rows={3}
            placeholder="Tell management anything — running late, need Friday off, out of blades, chair’s broken…"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') send(event);
            }}
          />
        </label>

        {preview ? (
          <div className="smc-preview">
            <span className="smc-preview-label">Sent as</span>
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
          <Send size={16} /> {busy ? 'Sending…' : 'Send'}
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
                  <span className="smc-reply-label">Management</span>
                  <p>{item.reply}</p>
                </div>
              ) : null}
            </article>
          );
        }) : (
          <p className="smc-empty">Nothing sent yet. Whatever you send shows up here with a status and management reply.</p>
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
