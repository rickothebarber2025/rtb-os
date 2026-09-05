import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, CheckCheck, X } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import '../styles/staffNotifications.css';

function formatWhen(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric' }).format(date);
}

function notificationDestination(notification) {
  const type = String(notification?.notification_type || '').toLowerCase();
  if (/clean|opening|closing|shift|attendance|task|inventory|maintenance|shop_status/.test(type)) {
    return { page: 'staff-hub', tab: 'daily' };
  }
  if (/announcement|policy|update/.test(type)) return { page: 'staff-hub', tab: 'home' };
  if (/performance|coaching|goal/.test(type)) return { page: 'staff-hub', tab: 'stats' };
  return { page: 'staff-hub', tab: 'daily' };
}

export default function StaffNotifications({ setActivePage, setStaffHubTab }) {
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState(true);
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from('staff_operation_notifications')
      .select('id,staff_id,business_unit_id,notification_type,title,body,read_at,created_at')
      .order('created_at', { ascending: false })
      .limit(60);
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

  const unread = useMemo(() => notifications.filter((item) => !item.read_at).length, [notifications]);

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
    if (!notification.read_at) await markRead([notification.id]);
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
        <div className="staff-notifications__popover">
          <div className="staff-notifications__header">
            <div>
              <strong>Notifications</strong>
              <small>{unread ? `${unread} unread` : 'You’re caught up'}</small>
            </div>
            <div className="staff-notifications__actions">
              <button disabled={!unread || working} onClick={markAllRead} type="button">
                <CheckCheck aria-hidden="true" size={15} /> Mark all read
              </button>
              <button aria-label="Close notifications" onClick={() => setOpen(false)} type="button">
                <X aria-hidden="true" size={16} />
              </button>
            </div>
          </div>

          <div className="staff-notifications__list">
            {notifications.length ? notifications.map((notification) => (
              <button
                className={`staff-notifications__item ${notification.read_at ? '' : 'unread'}`}
                key={notification.id}
                onClick={() => openNotification(notification)}
                type="button"
              >
                <span className="staff-notifications__dot" aria-hidden="true" />
                <span>
                  <strong>{notification.title}</strong>
                  {notification.body ? <span>{notification.body}</span> : null}
                  <small>{formatWhen(notification.created_at)}</small>
                </span>
              </button>
            )) : <p className="staff-notifications__empty">No notifications yet.</p>}
          </div>
        </div>
      ) : null}
    </div>
  );
}
