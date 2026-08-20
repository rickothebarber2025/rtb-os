import { supabase } from '../lib/supabaseClient';

function requireSupabase() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

async function invokeFinance(action, payload = {}) {
  const client = requireSupabase();
  const { data, error } = await client.functions.invoke('finance-api', { body: { action, ...payload } });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data || {};
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
}

export async function createFinanceObligation(payload) {
  const result = await invokeFinance('create_obligation', { businessId: payload.business_unit_id, payload });
  return result.obligation;
}

export async function deleteFinanceObligation(id, businessId) {
  await invokeFinance('delete_obligation', { id, businessId });
}

export async function askFinancialBuddy({ businessId, question }) {
  const client = requireSupabase();
  const { data, error } = await client.functions.invoke('financial-buddy', { body: { businessId, question } });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}
