import { supabase } from './supabaseClient';

function errorMessage(error, fallback = 'Request failed.') {
  return String(error?.message || error?.error || fallback);
}

function isAuthError(error) {
  const status = Number(error?.context?.status || error?.status || 0);
  const message = errorMessage(error, '').toLowerCase();
  return status === 401 || /jwt|session|unauthorized|not authenticated|invalid.*token|expired/.test(message);
}

async function invokeOnce(functionName, body) {
  const { data, error } = await supabase.functions.invoke(functionName, { body });
  if (error) throw error;
  if (data?.error) {
    const wrapped = new Error(data.error);
    wrapped.status = Number(data.status || 0);
    throw wrapped;
  }
  return data;
}

export async function invokeRtbFunction(functionName, body, { retryAuth = true } = {}) {
  if (!supabase) throw new Error('RTB OS is not configured.');

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData?.session) {
    throw new Error('Your RTB OS session has expired. Sign in to RTB OS once; Ada does not use a separate login.');
  }

  try {
    return await invokeOnce(functionName, body);
  } catch (error) {
    if (!retryAuth || !isAuthError(error)) throw error;

    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError || !refreshed?.session) {
      throw new Error('Your RTB OS session has expired. Sign in to RTB OS once; Ada does not use a separate login.');
    }

    return invokeOnce(functionName, body);
  }
}
