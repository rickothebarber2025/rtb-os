const CHANNEL_NAME = 'rtb-os-events-v1';
const WINDOW_EVENT = 'rtb:app-event';

let channel = null;

function getChannel() {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null;
  if (!channel) channel = new BroadcastChannel(CHANNEL_NAME);
  return channel;
}

function normalizeEvent(type, detail = {}) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    type: String(type || 'data.changed'),
    detail: detail && typeof detail === 'object' ? detail : {},
    timestamp: new Date().toISOString(),
  };
}

export function emitAppEvent(type, detail = {}, options = {}) {
  if (typeof window === 'undefined') return null;
  const event = normalizeEvent(type, detail);

  window.dispatchEvent(new CustomEvent(WINDOW_EVENT, { detail: event }));

  if (options.broadcast !== false) {
    try { getChannel()?.postMessage(event); } catch { /* cross-tab sync is best effort */ }
  }

  return event;
}

export function onAppEvent(handler) {
  if (typeof window === 'undefined' || typeof handler !== 'function') return () => {};

  const handleWindow = (event) => handler(event.detail || null, { remote: false });
  window.addEventListener(WINDOW_EVENT, handleWindow);

  const broadcast = getChannel();
  const handleBroadcast = (event) => handler(event.data || null, { remote: true });
  broadcast?.addEventListener('message', handleBroadcast);

  return () => {
    window.removeEventListener(WINDOW_EVENT, handleWindow);
    broadcast?.removeEventListener('message', handleBroadcast);
  };
}

export function emitDataChanged(source, detail = {}) {
  return emitAppEvent('data.changed', { source, ...detail });
}

export function emitAccessChanged(userId, detail = {}) {
  return emitAppEvent('access.changed', { userId, ...detail });
}

export function emitNavigationRequest(page, target = null, detail = {}) {
  return emitAppEvent('navigation.request', { page, target, ...detail });
}

export function emitNotificationChanged(detail = {}) {
  return emitAppEvent('notifications.changed', detail);
}
