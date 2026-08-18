import { supabase } from '../lib/supabaseClient';

async function invoke(action, payload = {}) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.functions.invoke('textnow-messages', {
    body: { action, ...payload },
  });
  if (error) throw new Error(error.message || 'TextNow request failed.');
  if (data?.error) throw new Error(data.error);
  return data || {};
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
  return invoke('send', { number, message });
}
