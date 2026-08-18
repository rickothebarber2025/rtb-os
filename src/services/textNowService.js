import { supabase } from '../lib/supabaseClient';

async function invoke(action, options = {}) {
  if (!supabase) throw new Error('Supabase is not configured.');

  const query = new URLSearchParams({ action });
  if (options.number) query.set('number', options.number);
  if (options.limit) query.set('limit', String(options.limit));

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error('Your RTB OS session has expired.');

  const base = `${supabase.supabaseUrl}/functions/v1/textnow-messages?${query.toString()}`;
  const response = await fetch(base, {
    method: options.body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: supabase.supabaseKey,
      'Content-Type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || payload?.detail || 'TextNow request failed.');
  return payload;
}

export function getTextNowStatus() {
  return invoke('health');
}

export function getTextNowMessages(limit = 100) {
  return invoke('messages', { limit });
}

export function getTextNowConversation(number, limit = 100) {
  return invoke('conversation', { number, limit });
}

export function sendTextNowSms(number, message) {
  return invoke('send', { body: { number, message } });
}
