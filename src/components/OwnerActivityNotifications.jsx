import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bell,
  Check,
  CheckCheck,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  ListFilter,
  UserRoundCheck,
  Wrench,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import '../styles/ownerActivityNotifications.css';

const NOTIFICATION_TABS = [
  { id: 'for-you', label: 'For You' },
  { id: 'requests', label: 'Requests' },
  { id: 'staff', label: 'Staff' },
  { id: 'operations', label: 'Operations' },
  { id: 'all', label: 'All' },
];

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
  return body || event.title || `${actor} recorded a staff activity update.`;
}

function eventSearchText(event) {
  return `${event.title || ''} ${event.body || ''} ${event.actor_name || ''}`.toLowerCase();
}

function normalizeCategory(value) {
  const category = String(value || '').trim().toLowerCase();
  if (['request', 'requests', 'approval', 'time_off', 'time-off'].includes(category)) return 'requests';
  if (['operation', 'operations', 'maintenance', 'inventory', 'incident', 'checklist'].includes(category)) return 'operations';
  if (['staff', 'attendance', 'shift', 'profile', 'performance'].includes(category)) return 'staff';
  return '';
}

function priorityFor(event) {
  const explicit = String(event.metadata?.priority || event.priority || '').trim().toLowerCase();
  if (['urgent', 'high', 'attention', 'action_required'].includes(explicit)) return 'attention';
  if (['done', 'resolved', 'completed', 'success'].includes(explicit)) return 'done';

  const action = String(event.action || '').toLowerCase();
  if (/request|approve|decline|incident|failed|missing|late|no.?show|urgent|damage/.test(action)) return 'attention';
  if (/complete|resolve|approve|close/.test(action)) return 'done';

  const text = eventSearchText(event);
  if (/incident|failed|could not|missing|late|no.?show|urgent|damage|problem|request|approval|time off/.test(text)) return 'attention';
  if (/completed|finished|closed|approved/.test(text)) return 'done';
  return 'info';
}

function categoryFor(event) {
  const explicit = normalizeCategory(event.category || event.metadata?.category);
  if (explicit) return explicit;

  const action = String(event.action || '').toLowerCase();
  if (/request|approve|decline|time.?off/.test(action)) return 'requests';
  if (/incident|maintenance|inventory|restock|checklist|operation/.test(action)) return 'operations';
  if (/clock|shift|attendance|staff|profile|task/.test(action)) return 'staff';

  const text = eventSearchText(event);
  if (/time off|request|approval|approve|decline/.test(text)) return 'requests';
  if (/incident|issue|failed|damage|maintenance|inventory|restock|broken|repair|problem/.test(text)) return 'operations';
  if (/clock|shift|late|no.?show|checklist|attendance|staff|task/.test(text)) return 'staff';
  return 'all';
}

function destinationFor(event) {
  const metadataPage = String(event.metadata?.page || '').trim();
  const metadataTab = String(event.metadata?.tab || '').trim();
  const metadataLabel = String(event.metadata?.action_label || '').trim();
  if (metadataPage) return { page: metadataPage, tab: metadataTab || 'home', label: metadataLabel || 'Open' };

  const category = categoryFor(event);
  if (category === 'operations') return { page: 'staff-hub', tab: 'daily', label: 'Open work' };
  if (category === 'requests') return { page: 'staff-hub', tab: 'schedule', label: 'Review request' };
  if (category === 'staff') return { page: 'staff-hub', tab: 'home', label: 'Review staff' };
  return { page: 'staff-hub', tab: 'home', label: 'Open Staff Hub' };
}

function iconFor(event) {
  const category = categoryFor(event);
  if (category === 'requests') return UserRoundCheck;
  if (category === 'operations') return Wrench;
  if (category === 'staff') return Clock3;
  return ClipboardCheck;
}

function filterEvents(events, tab) {
  if (tab === 'all') return events;
  if (tab === 'for-you') return events.filter((event) => !event.read && priorityFor(event) === 'attention');
  return events.filter((event) => categoryFor(event) === tab);
}

function tabCount(events, tab) {
  return filterEvents(events, tab).filter((event) => !event.read).length;
}

export default function OwnerActivityNotifications({ selectedBusinessUnitId, setActivePage, setStaffHubTab }) {
  const [feed, setFeed] = useState({ events: [], unread_count: 0 });
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState(true);
  const [working, setWorking] = useState(false);
  const [activeTab, setActiveTab] = useState('for-you');
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

  async function markOneRead(eventId) {
    if (!supabase || !eventId) return;
    setWorking(true);
    const { error } = await supabase.rpc('mark_owner_activity_read', { p_event_ids: [eventId] });
    if (!error) await load();
    setWorking(false);
  }

  function openEvent(event) {
    const destination = destinationFor(event);
    setStaffHubTab?.(destination.tab);
    setActivePage?.(destination.page);
    setOpen(false);
  }

  function reviewActivity() {
    setStaffHubTab?.('daily');
    setActivePage?.('staff-hub');
    setOpen(false);
  }

  if (!available) return null;
  const unread = Number(feed.unread_count || 0);
  const events = Array.isArray(feed.events) ? feed.events : [];
  const visibleEvents = filterEvents(events, activeTab);
  const attention = events.filter((event) => priorityFor(event) === 'attention' && !event.read).length;

  return <div className="owner-activity-notifications">
    <button aria-label={`${unread} unread staff updates`} className="owner-activity-button" onClick={() => setOpen((current) => !current)} type="button">
      <Bell aria-hidden="true" size={18} />
      {unread > 0 ? <span className="owner-activity-badge">{unread > 99 ? '99+' : unread}</span> : null}
    </button>

    {open ? <div className="owner-activity-popover" role="dialog" aria-label="Owner notifications">
      <div className="owner-activity-header">
        <div>
          <strong>Notifications</strong>
          <small>{attention ? `${attention} need${attention === 1 ? 's' : ''} your attention` : unread ? `${unread} new update${unread === 1 ? '' : 's'}` : 'You’re caught up'}</small>
        </div>
        <button className="owner-activity-close" aria-label="Close notifications" onClick={() => setOpen(false)} type="button"><X size={18} /></button>
      </div>

      <nav className="owner-activity-tabs" aria-label="Notification categories">
        {NOTIFICATION_TABS.map((tab) => {
          const count = tabCount(events, tab.id);
          return <button
            aria-current={activeTab === tab.id ? 'page' : undefined}
            className={activeTab === tab.id ? 'active' : ''}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            type="button"
          >
            <span>{tab.label}</span>
            {count ? <em>{count > 99 ? '99+' : count}</em> : null}
          </button>;
        })}
      </nav>

      {activeTab === 'for-you' && attention ? <div className="owner-activity-summary">
        <strong>{attention} item{attention === 1 ? '' : 's'} worth checking</strong>
        <span>Only exceptions, requests and problems that may need a decision are shown here.</span>
      </div> : null}

      <div className="owner-activity-list">
        {visibleEvents.length ? visibleEvents.map((event) => {
          const EventIcon = iconFor(event);
          const destination = destinationFor(event);
          return <article className={`${event.read ? '' : 'unread'} ${priorityFor(event)}`} key={event.id}>
            <div className="owner-activity-event-icon"><EventIcon size={15} /></div>
            <div className="owner-activity-event-body">
              <strong>{eventText(event)}</strong>
              <small>{[event.business_name, formatWhen(event.created_at)].filter(Boolean).join(' · ')}</small>
              <div className="owner-activity-event-actions">
                <button onClick={() => openEvent(event)} type="button">{destination.label}<ChevronRight size={14} /></button>
                {!event.read ? <button disabled={working} onClick={() => markOneRead(event.id)} type="button"><Check size={13} /> Mark read</button> : null}
              </div>
            </div>
          </article>;
        }) : <div className="owner-activity-empty">
          <ListFilter size={24} />
          <strong>{activeTab === 'for-you' ? 'Nothing needs you right now' : `No ${NOTIFICATION_TABS.find((tab) => tab.id === activeTab)?.label.toLowerCase()} updates`}</strong>
          <span>{activeTab === 'for-you' ? 'Routine updates stay out of the way until something needs a decision.' : 'New activity will appear here automatically.'}</span>
        </div>}
      </div>

      <div className="owner-activity-footer">
        <button className="owner-activity-review" onClick={reviewActivity} type="button">Open Staff Hub <ChevronRight size={16} /></button>
        {unread ? <button className="owner-activity-read" disabled={working} onClick={markAllRead} type="button"><CheckCheck size={15} /> Mark all read</button> : null}
      </div>
    </div> : null}
  </div>;
}
