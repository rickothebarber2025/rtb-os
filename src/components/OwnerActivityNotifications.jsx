import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, CheckCheck, ChevronRight, X } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import '../styles/ownerActivityNotifications.css';

function formatWhen(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  if (hours < 48) return 'Yesterday';
  return new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric' }).format(date);
}

function eventText(event) {
  const actor = event.actor_name || 'A staff member';
  const title = String(event.title || '').toLowerCase();
  const body = String(event.body || '').trim();
  if (title.includes('checklist started')) return `${actor} started the ${body.replace(/^.*?·\s*/, '') || 'shop checklist'}.`;
  if (title.includes('checklist step completed')) return `${actor} completed ${body.replace(/^.*?·\s*/, '') || 'a checklist task'}.`;
  if (title.includes('checklist') && title.includes('completed')) return `${actor} finished the ${body.replace(/^.*?·\s*/, '') || 'checklist'}.`;
  if (title.includes('clock') || title.includes('shift')) return body ? `${actor}: ${body}` : `${actor} updated their shift.`;
  if (title.includes('time off')) return body ? `${actor} requested time off: ${body}` : `${actor} submitted a time-off request.`;
  if (title.includes('incident') || title.includes('issue') || title.includes('failed')) return body ? `${actor} reported: ${body}` : `${actor} reported an issue that needs attention.`;
  return body || `${actor} recorded a staff activity update.`;
}

function priorityFor(event) {
  const text = `${event.title || ''} ${event.body || ''}`.toLowerCase();
  if (/incident|failed|could not|missing|late|no.?show|urgent|damage|problem|request|approval/.test(text)) return 'attention';
  if (/completed|finished|closed|approved/.test(text)) return 'done';
  return 'info';
}

function groupEvents(events) {
  const now = new Date();
  const today = now.toDateString();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).toDateString();
  const groups = { 'Needs attention': [], Today: [], Yesterday: [], Earlier: [] };
  events.forEach((event) => {
    if (priorityFor(event) === 'attention' && !event.read) return groups['Needs attention'].push(event);
    const stamp = new Date(event.created_at);
    const day = Number.isNaN(stamp.getTime()) ? '' : stamp.toDateString();
    if (day === today) groups.Today.push(event);
    else if (day === yesterday) groups.Yesterday.push(event);
    else groups.Earlier.push(event);
  });
  return Object.entries(groups).filter(([, items]) => items.length);
}

export default function OwnerActivityNotifications({ selectedBusinessUnitId, setActivePage, setStaffHubTab }) {
  const [feed, setFeed] = useState({ events: [], unread_count: 0 });
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState(true);
  const [working, setWorking] = useState(false);
  const businessId = useMemo(() => (selectedBusinessUnitId === 'all-businesses' ? null : selectedBusinessUnitId || null), [selectedBusinessUnitId]);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.rpc('get_owner_activity_feed', { p_business_unit_id: businessId, p_limit: 80 });
    if (error) return setAvailable(false);
    setAvailable(true);
    setFeed(data || { events: [], unread_count: 0 });
  }, [businessId]);

  useEffect(() => {
    load();
    if (!supabase) return undefined;
    const channel = supabase.channel(`owner-activity-${businessId || 'all'}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'owner_activity_events' }, (payload) => {
        if (!businessId || payload.new?.business_unit_id === businessId) load();
      }).subscribe();
    return () => supabase.removeChannel(channel);
  }, [businessId, load]);

  async function markAllRead() {
    if (!supabase || !feed.unread_count) return;
    setWorking(true);
    const { error } = await supabase.rpc('mark_owner_activity_read', { p_event_ids: null });
    if (!error) await load();
    setWorking(false);
  }

  function reviewActivity() {
    setStaffHubTab?.('daily');
    setActivePage?.('staff-hub');
    setOpen(false);
  }

  if (!available) return null;
  const unread = Number(feed.unread_count || 0);
  const events = Array.isArray(feed.events) ? feed.events : [];
  const groups = groupEvents(events);
  const attention = events.filter((event) => priorityFor(event) === 'attention' && !event.read).length;

  return <div className="owner-activity-notifications">
    <button aria-label={`${unread} unread staff updates`} className="owner-activity-button" onClick={() => setOpen((current) => !current)} type="button">
      <Bell aria-hidden="true" size={18} />
      {unread > 0 ? <span className="owner-activity-badge">{unread > 99 ? '99+' : unread}</span> : null}
    </button>
    {open ? <div className="owner-activity-popover" role="dialog" aria-label="Staff updates">
      <div className="owner-activity-header">
        <div><strong>What’s happening</strong><small>{attention ? `${attention} update${attention === 1 ? '' : 's'} may need you` : unread ? `${unread} new since you last checked` : 'You’re caught up'}</small></div>
        <button className="owner-activity-close" aria-label="Close staff updates" onClick={() => setOpen(false)} type="button"><X size={18} /></button>
      </div>
      {attention ? <div className="owner-activity-summary"><strong>{attention} need a closer look</strong><span>Requests, issues and exceptions stay at the top.</span></div> : null}
      <div className="owner-activity-list">
        {groups.length ? groups.map(([label, items]) => <section className="owner-activity-group" key={label}>
          <h3>{label}</h3>
          {items.map((event) => <article className={`${event.read ? '' : 'unread'} ${priorityFor(event)}`} key={event.id}>
            <div className="owner-activity-dot" />
            <div><strong>{eventText(event)}</strong><small>{[event.business_name, formatWhen(event.created_at)].filter(Boolean).join(' · ')}</small></div>
          </article>)}
        </section>) : <p className="owner-activity-empty">Nothing needs your attention right now.</p>}
      </div>
      <div className="owner-activity-footer">
        <button className="owner-activity-review" onClick={reviewActivity} type="button">Review daily operations <ChevronRight size={16} /></button>
        {unread ? <button className="owner-activity-read" disabled={working} onClick={markAllRead} type="button"><CheckCheck size={15} /> Clear new updates</button> : null}
      </div>
    </div> : null}
  </div>;
}