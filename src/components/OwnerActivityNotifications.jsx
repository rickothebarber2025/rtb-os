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
  { id: 'attention', label: 'Attention' },
  { id: 'activity', label: 'Activity' },
  { id: 'requests', label: 'Requests' },
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
  if (event.grouped_checklist_count) {
    const actor = event.actor_name || 'Staff';
    const type = String(event.metadata?.checklist_type || 'checklist').replace(/_/g, ' ');
    return `${actor} completed ${event.grouped_checklist_count} ${type} checklist steps.`;
  }

  const actor = event.actor_name || '';
  const title = String(event.title || '').trim();
  const titleLower = title.toLowerCase();
  const body = String(event.body || '').trim();

  if (titleLower.includes('checklist started')) {
    const type = String(event.metadata?.checklist_type || 'checklist').replace(/_/g, ' ');
    return actor ? `${actor} started the ${type} checklist.` : title;
  }
  if (titleLower.includes('checklist step completed')) {
    const label = String(event.metadata?.label || '').trim();
    return actor ? `${actor} completed ${label || 'a checklist step'}.` : (label || title);
  }
  if (titleLower.includes('checklist') && titleLower.includes('completed')) {
    return actor ? `${actor} finished a checklist.` : title;
  }
  if (titleLower.includes('time off')) {
    return actor ? `${actor} submitted a time-off request.` : title;
  }
  if (titleLower.includes('clock') || titleLower.includes('shift')) {
    return actor ? `${actor} updated their shift.` : title;
  }
  if (actor && (titleLower.includes('incident') || titleLower.includes('issue') || titleLower.includes('failed'))) {
    return `${actor} reported an issue.`;
  }

  return title || body || (actor ? `${actor} recorded an activity.` : 'RTB OS recorded an activity.');
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

function collapseRoutineActivity(events) {
  const result = [];
  const grouped = new Map();

  for (const event of events) {
    const isChecklistStep =
      String(event.title || '').toLowerCase().includes('checklist step completed') &&
      event.metadata?.run_id &&
      event.actor_staff_id;

    if (!isChecklistStep) {
      result.push(event);
      continue;
    }

    const key = `${event.metadata.run_id}:${event.actor_staff_id}`;
    const existing = grouped.get(key);
    if (!existing) {
      const groupedEvent = { ...event, grouped_checklist_count: 1, grouped_event_ids: [event.id] };
      grouped.set(key, groupedEvent);
      result.push(groupedEvent);
    } else {
      existing.grouped_checklist_count += 1;
      existing.grouped_event_ids.push(event.id);
      if (new Date(event.created_at) > new Date(existing.created_at)) {
        existing.created_at = event.created_at;
      }
      existing.read = existing.read && event.read;
    }
  }

  return result.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function filterEvents(events, tab) {
  if (tab === 'attention') return events.filter((event) => !event.read && priorityFor(event) === 'attention');
  if (tab === 'requests') return events.filter((event) => categoryFor(event) === 'requests');
  return events;
}

function tabCount(events, tab) {
  return filterEvents(events, tab).filter((event) => !event.read).length;
}

export default function OwnerActivityNotifications({ selectedBusinessUnitId, setActivePage, setStaffHubTab }) {
  const [feed, setFeed] = useState({ events: [], unread_count: 0 });
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState(true);
  const [working, setWorking] = useState(false);
  const [activeTab, setActiveTab] = useState('attention');
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

  async function markOneRead(eventIds) {
    const ids = Array.isArray(eventIds) ? eventIds : [eventIds].filter(Boolean);
    if (!supabase || !ids.length) return;
    setWorking(true);
    const { error } = await supabase.rpc('mark_owner_activity_read', { p_event_ids: ids });
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
  const rawEvents = Array.isArray(feed.events) ? feed.events : [];
  const events = collapseRoutineActivity(rawEvents);
  const unread = events.filter((event) => !event.read).length;
  const visibleEvents = filterEvents(events, activeTab);
  const attention = rawEvents.filter((event) => priorityFor(event) === 'attention' && !event.read).length;

  return <div className="owner-activity-notifications">
    <button aria-label={`${unread} unread staff updates`} className="owner-activity-button" onClick={() => setOpen((current) => !current)} type="button">
      <Bell aria-hidden="true" size={18} />
      {unread > 0 ? <span className="owner-activity-badge">{unread > 99 ? '99+' : unread}</span> : null}
    </button>

    {open ? <>
    <button
      aria-label="Close owner notifications"
      className="owner-activity-scrim"
      onClick={() => setOpen(false)}
      type="button"
    />
    <div className="owner-activity-popover" role="dialog" aria-modal="true" aria-label="Owner notifications">
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

      {activeTab === 'attention' && attention ? <div className="owner-activity-summary">
        <strong>{attention} item{attention === 1 ? '' : 's'} need attention</strong>
        <span>Requests, exceptions and problems that may need a decision.</span>
      </div> : null}

      <div className="owner-activity-list">
        {visibleEvents.length ? visibleEvents.map((event) => {
          const EventIcon = iconFor(event);
          const destination = destinationFor(event);
          return <article className={`${event.read ? '' : 'unread'} ${priorityFor(event)}`} key={event.id}>
            <div className="owner-activity-event-icon"><EventIcon size={15} /></div>
            <div className="owner-activity-event-body">
              <strong>{eventText(event)}</strong>
              {event.body && !event.grouped_checklist_count && eventText(event) !== event.body ? (
                <span className="owner-activity-event-detail">{event.body}</span>
              ) : null}
              <small>{[event.actor_name && !eventText(event).startsWith(event.actor_name) ? event.actor_name : null, event.business_name, formatWhen(event.created_at)].filter(Boolean).join(' · ')}</small>
              <div className="owner-activity-event-actions">
                <button onClick={() => openEvent(event)} type="button">{destination.label}<ChevronRight size={14} /></button>
                {!event.read ? <button disabled={working} onClick={() => markOneRead(event.grouped_event_ids || event.id)} type="button"><Check size={13} /> Mark read</button> : null}
              </div>
            </div>
          </article>;
        }) : <div className="owner-activity-empty">
          <ListFilter size={24} />
          <strong>{activeTab === 'attention' ? 'Nothing needs you right now' : `No ${NOTIFICATION_TABS.find((tab) => tab.id === activeTab)?.label.toLowerCase()} yet`}</strong>
          <span>{activeTab === 'attention' ? 'Routine activity stays in the Activity tab.' : 'New activity will appear here automatically.'}</span>
        </div>}
      </div>

      <div className="owner-activity-footer">
        <button className="owner-activity-review" onClick={reviewActivity} type="button">Open Staff Hub <ChevronRight size={16} /></button>
        {unread ? <button className="owner-activity-read" disabled={working} onClick={markAllRead} type="button"><CheckCheck size={15} /> Mark all read</button> : null}
      </div>
    </div>
    </> : null}
  </div>;
}
