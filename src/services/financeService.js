import { supabase } from '../lib/supabaseClient';

function requireSupabase() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

function businessScoped(query, businessUnitId) {
  if (!businessUnitId || businessUnitId === 'all-businesses') return query;
  return query.eq('business_unit_id', businessUnitId);
}

export async function loadFinanceSnapshot(businessUnitId) {
  const client = requireSupabase();
  const [transactionsResult, obligationsResult] = await Promise.all([
    businessScoped(client.from('finance_transactions').select('*'), businessUnitId)
      .order('transaction_date', { ascending: false })
      .limit(250),
    businessScoped(client.from('finance_obligations').select('*'), businessUnitId)
      .order('due_day', { ascending: true }),
  ]);
  if (transactionsResult.error) throw transactionsResult.error;
  if (obligationsResult.error) throw obligationsResult.error;
  return { transactions: transactionsResult.data || [], obligations: obligationsResult.data || [] };
}

export async function createFinanceTransaction(payload) {
  const client = requireSupabase();
  const { data: authData } = await client.auth.getUser();
  const { data, error } = await client.from('finance_transactions').insert({ ...payload, created_by: authData?.user?.id || null }).select('*').single();
  if (error) throw error;
  return data;
}

export async function importFinanceTransactions(rows) {
  if (!rows.length) return [];
  const client = requireSupabase();
  const { data: authData } = await client.auth.getUser();
  const { data, error } = await client.from('finance_transactions').insert(rows.map((row) => ({ ...row, created_by: authData?.user?.id || null }))).select('*');
  if (error) throw error;
  return data || [];
}

export async function deleteFinanceTransaction(id) {
  const client = requireSupabase();
  const { error } = await client.from('finance_transactions').delete().eq('id', id);
  if (error) throw error;
}

export async function createFinanceObligation(payload) {
  const client = requireSupabase();
  const { data: authData } = await client.auth.getUser();
  const { data, error } = await client.from('finance_obligations').insert({ ...payload, created_by: authData?.user?.id || null }).select('*').single();
  if (error) throw error;
  return data;
}

export async function deleteFinanceObligation(id) {
  const client = requireSupabase();
  const { error } = await client.from('finance_obligations').delete().eq('id', id);
  if (error) throw error;
}

export async function askFinancialBuddy({ businessId, question }) {
  const client = requireSupabase();
  const { data, error } = await client.functions.invoke('financial-buddy', { body: { businessId, question } });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}
