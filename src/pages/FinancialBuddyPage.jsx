import { useEffect, useMemo, useState } from 'react';
import Papa from 'papaparse';
import { Bot, FileUp, Plus, RefreshCw, Send, Trash2 } from 'lucide-react';
import {
  askFinancialBuddy,
  createFinanceObligation,
  createFinanceTransaction,
  deleteFinanceObligation,
  deleteFinanceTransaction,
  importFinanceTransactions,
  loadFinanceSnapshot,
} from '../services/financeService';
import '../styles/financialBuddy.css';

const money = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });
const QUICK_PROMPTS = [
  'What is putting the most pressure on cash flow this month?',
  'What recurring expenses should I review first?',
  'Based on the data here, what are my next three financial actions?',
];

function normalizedMonthlyAmount(row) {
  const amount = Number(row.amount || 0);
  switch (row.frequency) {
    case 'weekly': return amount * 52 / 12;
    case 'biweekly': return amount * 26 / 12;
    case 'quarterly': return amount / 3;
    case 'yearly': return amount / 12;
    default: return amount;
  }
}

function csvKey(row, names) {
  return Object.keys(row || {}).find((candidate) => names.some((name) => candidate.toLowerCase().includes(name)));
}

function csvValue(row, names) {
  const key = csvKey(row, names);
  return key ? row[key] : undefined;
}

function parseMoney(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).replace(/[,$()\s]/g, '').trim();
  const number = Number(normalized);
  if (!Number.isFinite(number)) return null;
  return String(value).includes('(') && number > 0 ? -number : number;
}

function transactionFromCsv(raw, businessId) {
  const description = String(csvValue(raw, ['description', 'merchant', 'payee', 'details', 'memo', 'name']) || '').trim();
  const dateRaw = String(csvValue(raw, ['transaction date', 'posted date', 'date']) || '').trim();
  const debitKey = csvKey(raw, ['debit', 'withdrawal', 'money out', 'charge']);
  const creditKey = csvKey(raw, ['credit', 'deposit', 'money in', 'payment received']);
  const amountKey = csvKey(raw, ['amount']);

  const debit = debitKey ? parseMoney(raw[debitKey]) : null;
  const credit = creditKey ? parseMoney(raw[creditKey]) : null;
  const signedAmount = amountKey ? parseMoney(raw[amountKey]) : null;

  let direction;
  let amount;
  if (debit !== null && Math.abs(debit) > 0) {
    direction = 'expense';
    amount = Math.abs(debit);
  } else if (credit !== null && Math.abs(credit) > 0) {
    direction = 'income';
    amount = Math.abs(credit);
  } else if (signedAmount !== null && signedAmount !== 0) {
    direction = signedAmount < 0 ? 'expense' : 'income';
    amount = Math.abs(signedAmount);
  }

  if (!description || !direction || !amount || !Number.isFinite(amount)) return null;
  return {
    business_unit_id: businessId,
    transaction_date: /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : new Date().toISOString().slice(0, 10),
    direction,
    amount,
    category: 'Imported',
    description,
    source: 'csv',
  };
}

export default function FinancialBuddyPage({ businessUnit, isAllBusinessesView, onRefresh }) {
  const businessId = businessUnit?.id;
  const [transactions, setTransactions] = useState([]);
  const [obligations, setObligations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [asking, setAsking] = useState(false);
  const [transactionForm, setTransactionForm] = useState({ transaction_date: new Date().toISOString().slice(0, 10), direction: 'expense', amount: '', category: 'Operating expense', description: '' });
  const [obligationForm, setObligationForm] = useState({ name: '', amount: '', due_day: '1', frequency: 'monthly', category: 'Operating expense' });

  async function load() {
    if (!businessId || isAllBusinessesView) return;
    setLoading(true); setError('');
    try {
      const snapshot = await loadFinanceSnapshot(businessId);
      setTransactions(snapshot.transactions);
      setObligations(snapshot.obligations);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Finance data could not load.');
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [businessId, isAllBusinessesView]);

  const metrics = useMemo(() => {
    const now = new Date();
    const month = now.toISOString().slice(0, 7);
    const current = transactions.filter((row) => String(row.transaction_date || '').startsWith(month));
    const income = current.filter((row) => row.direction === 'income').reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const expenses = current.filter((row) => row.direction === 'expense').reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const recurring = obligations.filter((row) => row.status === 'active').reduce((sum, row) => sum + normalizedMonthlyAmount(row), 0);
    return { income, expenses, net: income - expenses, recurring };
  }, [obligations, transactions]);

  async function addTransaction(event) {
    event.preventDefault();
    if (!businessId || !transactionForm.description.trim() || Number(transactionForm.amount) <= 0) return;
    setError(''); setNotice('');
    try {
      const row = await createFinanceTransaction({ ...transactionForm, business_unit_id: businessId, amount: Number(transactionForm.amount), description: transactionForm.description.trim(), source: 'manual' });
      setTransactions((current) => [row, ...current]);
      setTransactionForm((current) => ({ ...current, amount: '', description: '' }));
      setNotice('Transaction saved.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Transaction could not be saved.'); }
  }

  async function addObligation(event) {
    event.preventDefault();
    if (!businessId || !obligationForm.name.trim() || Number(obligationForm.amount) <= 0) return;
    setError(''); setNotice('');
    try {
      const row = await createFinanceObligation({ ...obligationForm, business_unit_id: businessId, amount: Number(obligationForm.amount), due_day: Number(obligationForm.due_day), status: 'active' });
      setObligations((current) => [...current, row].sort((a, b) => a.due_day - b.due_day));
      setObligationForm((current) => ({ ...current, name: '', amount: '' }));
      setNotice('Recurring commitment saved.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Recurring obligation could not be saved.'); }
  }

  async function removeTransaction(id) {
    setError('');
    try { await deleteFinanceTransaction(id); setTransactions((current) => current.filter((row) => row.id !== id)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Transaction could not be deleted.'); }
  }

  async function removeObligation(id) {
    setError('');
    try { await deleteFinanceObligation(id); setObligations((current) => current.filter((row) => row.id !== id)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Obligation could not be deleted.'); }
  }

  function importCsv(event) {
    const file = event.target.files?.[0];
    if (!file || !businessId) return;
    setError(''); setNotice('');
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async ({ data }) => {
        try {
          const rows = data.map((raw) => transactionFromCsv(raw, businessId)).filter(Boolean);
          if (!rows.length) throw new Error('No recognizable transactions were found. The CSV needs a description plus an amount, debit/withdrawal, or credit/deposit column.');
          const inserted = await importFinanceTransactions(rows);
          setTransactions((current) => [...inserted, ...current]);
          setNotice(`Imported ${inserted.length} transactions. Review imported rows before relying on the totals.`);
        } catch (err) { setError(err instanceof Error ? err.message : 'CSV import failed.'); }
        finally { event.target.value = ''; }
      },
      error: () => setError('CSV import failed. Check the statement format and try again.'),
    });
  }

  async function ask(prompt = question) {
    const text = String(prompt || '').trim();
    if (!text || !businessId || isAllBusinessesView) return;
    setAsking(true); setError('');
    try {
      const result = await askFinancialBuddy({ businessId, question: text });
      setAnswer(result.answer || ''); setQuestion('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Financial Buddy is unavailable.'); }
    finally { setAsking(false); }
  }

  if (isAllBusinessesView) {
    return <section className="panel"><h1>Financial Buddy</h1><p>Choose one business first. Finance records are intentionally kept business-specific so the businesses do not get mixed together.</p></section>;
  }

  return (
    <div className="financial-buddy">
      <section className="panel financial-buddy__hero">
        <div><span className="financial-buddy__eyebrow">Finance · {businessUnit?.name || 'Selected business'}</span><h1>Financial Buddy</h1><p>Track the money that leaves the business, recurring commitments, and the financial decisions that need attention.</p></div>
        <button className="secondary-button" disabled={loading} onClick={() => { load(); onRefresh?.(); }} type="button"><RefreshCw size={16} /> Refresh</button>
      </section>

      {error ? <div className="alert danger">{error}</div> : null}
      {notice ? <div className="alert success">{notice}</div> : null}

      <section className="financial-buddy__metrics">
        <div className="financial-buddy__metric"><span>Income recorded this month</span><strong>{money.format(metrics.income)}</strong></div>
        <div className="financial-buddy__metric"><span>Expenses recorded this month</span><strong>{money.format(metrics.expenses)}</strong></div>
        <div className="financial-buddy__metric"><span>Recorded net cash flow</span><strong>{money.format(metrics.net)}</strong></div>
        <div className="financial-buddy__metric"><span>Monthly recurring commitments</span><strong>{money.format(metrics.recurring)}</strong></div>
      </section>

      <div className="financial-buddy__grid">
        <section className="panel">
          <div className="section-heading"><div><span className="financial-buddy__eyebrow">Transactions</span><h2>Money in and out</h2></div><label className="secondary-button" style={{ cursor: 'pointer' }}><FileUp size={16} /> Import CSV<input accept=".csv,text/csv" hidden onChange={importCsv} type="file" /></label></div>
          <p className="financial-buddy__empty">CSV imports detect separate debit/credit columns first; signed amount columns use negative as expense and positive as income. Always review imported rows.</p>
          <form className="financial-buddy__form" onSubmit={addTransaction}>
            <label>Date<input type="date" value={transactionForm.transaction_date} onChange={(e) => setTransactionForm((v) => ({ ...v, transaction_date: e.target.value }))} /></label>
            <label>Type<select value={transactionForm.direction} onChange={(e) => setTransactionForm((v) => ({ ...v, direction: e.target.value }))}><option value="expense">Expense</option><option value="income">Income</option></select></label>
            <label>Amount<input min="0.01" step="0.01" type="number" value={transactionForm.amount} onChange={(e) => setTransactionForm((v) => ({ ...v, amount: e.target.value }))} /></label>
            <label>Category<input value={transactionForm.category} onChange={(e) => setTransactionForm((v) => ({ ...v, category: e.target.value }))} /></label>
            <label className="full">Description<input placeholder="Rent, supplies, Square deposit…" value={transactionForm.description} onChange={(e) => setTransactionForm((v) => ({ ...v, description: e.target.value }))} /></label>
            <button className="primary-button full" type="submit"><Plus size={16} /> Add transaction</button>
          </form>
          <div className="financial-buddy__list">
            {transactions.length ? transactions.slice(0, 25).map((row) => <div className="financial-buddy__row" key={row.id}><div><strong>{row.description}</strong><br /><small>{row.transaction_date} · {row.category} · {row.source}</small></div><strong className={row.direction === 'income' ? 'financial-buddy__amount--income' : 'financial-buddy__amount--expense'}>{row.direction === 'income' ? '+' : '-'}{money.format(Number(row.amount || 0))}</strong><button aria-label="Delete transaction" className="ghost-button small" onClick={() => removeTransaction(row.id)} type="button"><Trash2 size={15} /></button></div>) : <p className="financial-buddy__empty">No finance transactions recorded yet. Start manually or import a CSV statement.</p>}
          </div>
        </section>

        <section className="panel">
          <span className="financial-buddy__eyebrow">Recurring commitments</span><h2>Bills & obligations</h2>
          <form className="financial-buddy__form" onSubmit={addObligation}>
            <label className="full">Name<input placeholder="Commercial rent" value={obligationForm.name} onChange={(e) => setObligationForm((v) => ({ ...v, name: e.target.value }))} /></label>
            <label>Amount<input min="0.01" step="0.01" type="number" value={obligationForm.amount} onChange={(e) => setObligationForm((v) => ({ ...v, amount: e.target.value }))} /></label>
            <label>Due day<input max="31" min="1" type="number" value={obligationForm.due_day} onChange={(e) => setObligationForm((v) => ({ ...v, due_day: e.target.value }))} /></label>
            <label>Frequency<select value={obligationForm.frequency} onChange={(e) => setObligationForm((v) => ({ ...v, frequency: e.target.value }))}><option value="weekly">Weekly</option><option value="biweekly">Biweekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option><option value="other">Other</option></select></label>
            <label>Category<input value={obligationForm.category} onChange={(e) => setObligationForm((v) => ({ ...v, category: e.target.value }))} /></label>
            <button className="primary-button full" type="submit"><Plus size={16} /> Add recurring cost</button>
          </form>
          <div className="financial-buddy__list">{obligations.length ? obligations.map((row) => <div className="financial-buddy__row" key={row.id}><div><strong>{row.name}</strong><br /><small>Due {row.due_day} · {row.frequency}</small></div><strong>{money.format(Number(row.amount || 0))}</strong><button aria-label="Delete obligation" className="ghost-button small" onClick={() => removeObligation(row.id)} type="button"><Trash2 size={15} /></button></div>) : <p className="financial-buddy__empty">Add rent, utilities, debt payments, subscriptions, and other recurring commitments.</p>}</div>
        </section>
      </div>

      <section className="panel financial-buddy__ask">
        <div><span className="financial-buddy__eyebrow">Decision support</span><h2><Bot size={20} style={{ verticalAlign: 'middle' }} /> Ask Financial Buddy</h2><p>Financial Buddy reads this business's finance records plus relevant RTB OS payroll/performance data. It does not invent bank balances or missing numbers.</p></div>
        <div className="financial-buddy__quick">{QUICK_PROMPTS.map((prompt) => <button className="secondary-button" disabled={asking} key={prompt} onClick={() => ask(prompt)} type="button">{prompt}</button>)}</div>
        <textarea onChange={(e) => setQuestion(e.target.value)} placeholder="Example: Can I safely take on another $1,000 monthly expense based on what we know?" rows={3} value={question} />
        <button className="primary-button" disabled={asking || !question.trim()} onClick={() => ask()} type="button"><Send size={16} /> {asking ? 'Analyzing…' : 'Ask Financial Buddy'}</button>
        {answer ? <div className="financial-buddy__answer">{answer}</div> : null}
      </section>
    </div>
  );
}
