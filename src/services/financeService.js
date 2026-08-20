import { supabase } from '../lib/supabaseClient';

function requireSupabase() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

async function invokeFunction(name, body = {}) {
  const client = requireSupabase();
  const { data, error } = await client.functions.invoke(name, { body });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data || {};
}

async function invokeFinance(action, payload = {}) {
  return invokeFunction('finance-api', { action, ...payload });
}

export async function loadFinanceSnapshot(businessUnitId) {
  return invokeFinance('snapshot', { businessId: businessUnitId });
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

export async function confirmFinanceMatch(id, businessId) {
  return invokeFunction('finance-intelligence', { action: 'confirm_match', id, businessId });
}

export async function rejectFinanceMatch(id, businessId) {
  return invokeFunction('finance-intelligence', { action: 'reject_match', id, businessId });
}

export async function askFinancialBuddy({ businessId, question }) {
  return invokeFunction('financial-buddy', { businessId, question });
}
