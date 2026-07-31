import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, CheckCheck, X } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import '../styles/ownerActivityNotifications.css';

function formatWhen(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const diff = Date.now() - date.getTime();
  const minutes = Math.max(0, Math.floor(diff / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric' }).format(date);
}

export default function OwnerActivityNotifications({ selectedBusinessUnitId }) {
  const [feed, setFeed] = useState({ events: [], unread_count: 0 });
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState(true);
  const [working, setWorking] = useState(false);

  const businessId = useMemo(
    () => (selectedBusinessUnitId === 'all-businesses' ? null : selectedBusinessUnitId || null),
    [selectedBusinessUnitId],
  );

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.rpc('get_owner_activity_feed', {
      p_business_unit_id: businessId,
      p_limit: 80,
    });
    if (error) {
      setAvailable(false);
      return;
    }
    setAvailable(true);
    setFeed(data || { events: [], unread_count: 0 });
  }, [businessId]);

  useEffect(() => {
    load();
    if (!supabase) return undefined;
    const channel = supabase
      .channel(`owner-activity-${businessId || 'all'}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'owner_activity_events' },
        (payload) => {
          if (!businessId || payload.new?.business_unit_id === businessId) load();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [businessId, load]);

  async function markAllRead() {
    if (!supabase || !feed.unread_count) return;
    setWorking(true);
    const { error } = await supabase.rpc('mark_owner_activity_read', { p_event_ids: null });
    if (!error) await load();
    setWorking(false);
  }

  if (!available) return null;

  const unread = Number(feed.unread_count || 0);
  const events = Array.isArray(feed.events) ? feed.events : [];

  return (
    <div className="owner-activity-notifications">
      <button
        aria-label={`${unread} unread staff activity notifications`}
        className="owner-activity-button"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <Bell size={18} />
        {unread > 0 ? <span className="owner-activity-badge">{unread > 99 ? '99+' : unread}</span> : null}
      </button>

      {open ? (
        <div className="owner-activity-popover">
          <div className="owner-activity-header">
            <div>
              <strong>Staff activity</strong>
              <small>{unread ? `${unread} unread` : 'Everything reviewed'}</small>
            </div>
            <div className="owner-activity-header-actions">
              <button disabled={!unread || working} onClick={markAllRead} type="button">
                <CheckCheck size={15} /> Mark all read
              </button>
              <button aria-label="Close notifications" onClick={() => setOpen(false)} type="button">
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="owner-activity-list">
            {events.length ? events.map((event) => (
              <article className={event.read ? '' : 'unread'} key={event.id}>
                <div className="owner-activity-dot" />
                <div>
                  <strong>{event.title}</strong>
                  <p>{event.body || event.actor_name || 'Staff activity recorded'}</p>
                  <small>
                    {[event.actor_name, event.business_name, formatWhen(event.created_at)].filter(Boolean).join(' · ')}
                  </small>
                </div>
              </article>
            )) : (
              <p className="owner-activity-empty">No staff activity has been recorded yet.</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
