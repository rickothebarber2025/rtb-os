import { supabase } from '../lib/supabaseClient';

function requireSupabase() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

async function functionErrorMessage(error, fallback) {
  const response = error?.context;
  if (response?.json) {
    try {
      const body = await (response.clone ? response.clone() : response).json();
      return body?.error || body?.message || fallback || error.message;
    } catch { /* use fallback */ }
  }
  return fallback || error?.message || 'RTB OS could not complete the Finance request.';
}

async function invokeFunction(name, body = {}) {
  const client = requireSupabase();
  const { data, error } = await client.functions.invoke(name, { body });
  if (error) throw new Error(await functionErrorMessage(error));
  if (data?.error) throw new Error(data.error);
  return data || {};
}

async function invokeFinance(action, payload = {}) {
  return invokeFunction('finance-api', { action, ...payload });
}

export async function loadFinanceSnapshot(businessUnitId) {
  return invokeFinance('snapshot', { businessId: businessUnitId });
}

export async function loadFinancePaymentEvidence(businessUnitId) {
  const client = requireSupabase();
  const { data, error } = await client
    .from('finance_payment_confirmations')
    .select('id,business_unit_id,recipient_name,amount,deposited_at,payment_kind,category_hint,match_status,match_confidence,bank_transaction_id,payroll_entry_id,evidence,subject,updated_at')
    .eq('business_unit_id', businessUnitId)
    .order('deposited_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return data || [];
}

export async function syncFinancePaymentEvidence(businessId) {
  return invokeFunction('gmail-payroll-sync', {
    businessId,
    maxMessages: 250,
    query: 'newer_than:180d',
  });
}

export async function createFinanceTransaction(payload) {
  const result = await invokeFinance('create_transaction', { businessId: payload.business_unit_id, payload });
  return result.transaction;
}

export async function importFinanceCsv({ businessId, csvText, fileName }) {
  return invokeFinance('import_csv', { businessId, csvText, fileName });
}

export async function deleteFinanceTransaction(id, businessId) {
  await invokeFinance('delete_transaction', { id, businessId });
  await refreshFinanceIntelligence(businessId);
}

export async function createFinanceObligation(payload) {
  const result = await invokeFinance('create_obligation', { businessId: payload.business_unit_id, payload });
  return result.obligation;
}

export async function deleteFinanceObligation(id, businessId) {
  await invokeFinance('delete_obligation', { id, businessId });
}

export async function refreshFinanceIntelligence(businessId) {
  return invokeFunction('finance-intelligence', { action: 'full_refresh', businessId });
}

export async function loadFinanceIntelligence(businessId) {
  return invokeFunction('finance-intelligence', { action: 'snapshot', businessId });
}

export async function refreshFinanceWithEvidence(businessId) {
  let evidenceSync = null;
  let evidenceWarning = '';
  try {
    evidenceSync = await syncFinancePaymentEvidence(businessId);
  } catch (error) {
    evidenceWarning = error instanceof Error ? error.message : 'Gmail payment evidence could not sync.';
  }
  const intelligence = await refreshFinanceIntelligence(businessId);
  return { intelligence, evidenceSync, evidenceWarning };
}

export async function confirmFinanceMatch(id, businessId) {
  return invokeFunction('finance-intelligence', { action: 'confirm_match', id, businessId });
}

export async function rejectFinanceMatch(id, businessId) {
  return invokeFunction('finance-intelligence', { action: 'reject_match', id, businessId });
}

export async function askFinancialBuddy({ businessId, question }) {
  return invokeFunction('financial-buddy', { businessId, question });
}
