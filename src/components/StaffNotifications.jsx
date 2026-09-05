import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, CheckCheck, ChevronRight, X } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import '../styles/staffNotifications.css';

const TABS = [
  { id: 'for-you', label: 'For You' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'updates', label: 'Updates' },
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

function categoryFor(notification) {
  const type = String(notification?.notification_type || '').toLowerCase();
  if (/task|walkin|clean|opening|closing|inventory|maintenance|shop_status/.test(type)) return 'tasks';
  if (/time_off|schedule|shift|attendance/.test(type)) return 'schedule';
  if (/announcement|policy|update|performance|coaching|goal/.test(type)) return 'updates';
  return 'updates';
}

function needsAttention(notification) {
  if (notification.read_at) return false;
  const type = String(notification?.notification_type || '').toLowerCase();
  return /task_assigned|task_reopened|walkin_assignment|walkin_reminder|time_off|maintenance|inventory|closing|opening/.test(type);
}

function notificationDestination(notification) {
  const type = String(notification?.notification_type || '').toLowerCase();
  if (/time_off|schedule|shift|attendance/.test(type)) return { page: 'staff-hub', tab: 'schedule' };
  if (/announcement|policy|update/.test(type)) return { page: 'staff-hub', tab: 'home' };
  if (/performance|coaching|goal/.test(type)) return { page: 'staff-hub', tab: 'stats' };
  return { page: 'staff-hub', tab: 'daily' };
}

function groupNotifications(rows) {
  const groups = new Map();
  rows.forEach((notification) => {
    const key = [notification.notification_type, notification.title, notification.body || ''].join('::');
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { ...notification, ids: [notification.id], count: 1, unreadCount: notification.read_at ? 0 : 1 });
      return;
    }
    existing.ids.push(notification.id);
    existing.count += 1;
    if (!notification.read_at) existing.unreadCount += 1;
  });
  return [...groups.values()];
}

function filteredNotifications(rows, tab) {
  if (tab === 'all') return rows;
  if (tab === 'for-you') return rows.filter(needsAttention);
  return rows.filter((item) => categoryFor(item) === tab);
}

export default function StaffNotifications({ setActivePage, setStaffHubTab }) {
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState(true);
  const [working, setWorking] = useState(false);
  const [activeTab, setActiveTab] = useState('for-you');

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from('staff_operation_notifications')
      .select('id,staff_id,business_unit_id,notification_type,title,body,read_at,created_at')
      .order('created_at', { ascending: false })
      .limit(80);
    if (error) {
      setAvailable(false);
      return;
    }
    setAvailable(true);
    setNotifications(data || []);
  }, []);

  useEffect(() => {
    load();
    if (!supabase) return undefined;

    const refreshFromPush = () => load();
    window.addEventListener('rtb:notification-received', refreshFromPush);

    const channel = supabase
      .channel('my-operation-notifications')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'staff_operation_notifications' }, () => load())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'staff_operation_notifications' }, () => load())
      .subscribe();

    return () => {
      window.removeEventListener('rtb:notification-received', refreshFromPush);
      supabase.removeChannel(channel);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);

  const unread = useMemo(() => notifications.filter((item) => !item.read_at).length, [notifications]);
  const grouped = useMemo(() => groupNotifications(notifications), [notifications]);
  const visible = useMemo(() => filteredNotifications(grouped, activeTab), [activeTab, grouped]);
  const attentionCount = useMemo(() => grouped.filter(needsAttention).length, [grouped]);

  async function markRead(ids) {
    if (!supabase || !ids.length) return;
    const { error } = await supabase
      .from('staff_operation_notifications')
      .update({ read_at: new Date().toISOString() })
      .in('id', ids);
    if (!error) await load();
  }

  async function markAllRead() {
    const ids = notifications.filter((item) => !item.read_at).map((item) => item.id);
    if (!ids.length) return;
    setWorking(true);
    await markRead(ids);
    setWorking(false);
  }

  async function openNotification(notification) {
    if (notification.unreadCount) await markRead(notification.ids || [notification.id]);
    const destination = notificationDestination(notification);
    if (destination.tab && typeof setStaffHubTab === 'function') setStaffHubTab(destination.tab);
    if (destination.page && typeof setActivePage === 'function') setActivePage(destination.page);
    setOpen(false);
  }

  if (!available) return null;

  return (
    <div className="staff-notifications">
      <button
        aria-label={`${unread} unread notifications`}
        className="staff-notifications__button"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <Bell aria-hidden="true" size={18} />
        {unread > 0 ? <span className="staff-notifications__badge">{unread > 99 ? '99+' : unread}</span> : null}
      </button>

      {open ? (
        <div className="staff-notifications__backdrop" role="presentation" onClick={() => setOpen(false)}>
          <section className="staff-notifications__popover" role="dialog" aria-modal="true" aria-label="Notifications" onClick={(event) => event.stopPropagation()}>
            <div className="staff-notifications__header">
              <div>
                <strong>Notifications</strong>
                <small>{attentionCount ? `${attentionCount} item${attentionCount === 1 ? '' : 's'} need attention` : unread ? `${unread} unread` : 'You’re caught up'}</small>
              </div>
              <div className="staff-notifications__actions">
                <button disabled={!unread || working} onClick={markAllRead} type="button">
                  <CheckCheck aria-hidden="true" size={15} /> Mark all read
                </button>
                <button aria-label="Close notifications" onClick={() => setOpen(false)} type="button">
                  <X aria-hidden="true" size={18} />
                </button>
              </div>
            </div>

            <nav className="staff-notifications__tabs" aria-label="Notification categories">
              {TABS.map((tab) => (
                <button className={activeTab === tab.id ? 'active' : ''} key={tab.id} onClick={() => setActiveTab(tab.id)} type="button">
                  {tab.label}
                </button>
              ))}
            </nav>

            <div className="staff-notifications__list">
              {visible.length ? visible.map((notification) => (
                <button
                  className={`staff-notifications__item ${notification.unreadCount ? 'unread' : ''}`}
                  key={`${notification.notification_type}-${notification.id}`}
                  onClick={() => openNotification(notification)}
                  type="button"
                >
                  <span className="staff-notifications__dot" aria-hidden="true" />
                  <span className="staff-notifications__copy">
                    <span className="staff-notifications__title-row">
                      <strong>{notification.title}</strong>
                      {notification.count > 1 ? <em>×{notification.count}</em> : null}
                    </span>
                    {notification.body ? <span>{notification.body}</span> : null}
                    <small>{formatWhen(notification.created_at)}</small>
                  </span>
                  <ChevronRight aria-hidden="true" size={16} />
                </button>
              )) : <div className="staff-notifications__empty"><CheckCheck size={22} /><strong>Nothing here</strong><span>{activeTab === 'for-you' ? 'Anything that needs your action will appear here.' : 'No notifications in this section.'}</span></div>}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
