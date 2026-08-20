import { useEffect, useState } from 'react';
import { Bot, FileUp, Plus, RefreshCw, Send, Trash2 } from 'lucide-react';
import {
  askFinancialBuddy,
  createFinanceObligation,
  createFinanceTransaction,
  deleteFinanceObligation,
  deleteFinanceTransaction,
  importFinanceCsv,
  loadFinanceSnapshot,
} from '../services/financeService';
import '../styles/financialBuddy.css';

const money = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });
const EMPTY_METRICS = { income: 0, expenses: 0, net: 0, recurring: 0 };
const QUICK_PROMPTS = [
  'What is putting the most pressure on cash flow this month?',
  'What recurring expenses should I review first?',
  'Based on the data here, what are my next three financial actions?',
];

export default function FinancialBuddyPage({ businessUnit, isAllBusinessesView, onRefresh }) {
  const businessId = businessUnit?.id;
  const [transactions, setTransactions] = useState([]);
  const [obligations, setObligations] = useState([]);
  const [metrics, setMetrics] = useState(EMPTY_METRICS);
  const [recentImports, setRecentImports] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [asking, setAsking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [transactionForm, setTransactionForm] = useState({ transaction_date: new Date().toISOString().slice(0, 10), direction: 'expense', amount: '', category: 'Operating expense', description: '' });
  const [obligationForm, setObligationForm] = useState({ name: '', amount: '', due_day: '1', frequency: 'monthly', category: 'Operating expense' });

  async function load() {
    if (!businessId || isAllBusinessesView) return;
    setLoading(true);
    setError('');
    try {
      const snapshot = await loadFinanceSnapshot(businessId);
      setTransactions(snapshot.transactions || []);
      setObligations(snapshot.obligations || []);
      setMetrics(snapshot.metrics || EMPTY_METRICS);
      setRecentImports(snapshot.recent_imports || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Finance data could not load.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [businessId, isAllBusinessesView]);

  async function refreshAll() {
    await load();
    onRefresh?.();
  }

  async function addTransaction(event) {
    event.preventDefault();
    if (!businessId || !transactionForm.description.trim() || Number(transactionForm.amount) <= 0) return;
    setError('');
    try {
      await createFinanceTransaction({
        ...transactionForm,
        business_unit_id: businessId,
        amount: Number(transactionForm.amount),
        description: transactionForm.description.trim(),
        source: 'manual',
      });
      setTransactionForm((current) => ({ ...current, amount: '', description: '' }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transaction could not be saved.');
    }
  }

  async function addObligation(event) {
    event.preventDefault();
    if (!businessId || !obligationForm.name.trim() || Number(obligationForm.amount) <= 0) return;
    setError('');
    try {
      await createFinanceObligation({
        ...obligationForm,
        business_unit_id: businessId,
        amount: Number(obligationForm.amount),
        due_day: Number(obligationForm.due_day),
        status: 'active',
      });
      setObligationForm((current) => ({ ...current, name: '', amount: '' }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Recurring obligation could not be saved.');
    }
  }

  async function removeTransaction(id) {
    setError('');
    try {
      await deleteFinanceTransaction(id, businessId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transaction could not be deleted.');
    }
  }

  async function removeObligation(id) {
    setError('');
    try {
      await deleteFinanceObligation(id, businessId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Obligation could not be deleted.');
    }
  }

  async function importCsv(event) {
    const file = event.target.files?.[0];
    if (!file || !businessId) return;
    setImporting(true);
    setError('');
    try {
      const csvText = await file.text();
      const result = await importFinanceCsv({ businessId, csvText, fileName: file.name });
      if (!result.transactions?.length) throw new Error('No transactions were imported.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'CSV import failed.');
    } finally {
      setImporting(false);
      event.target.value = '';
    }
  }

  async function ask(prompt = question) {
    const text = String(prompt || '').trim();
    if (!text || !businessId || isAllBusinessesView) return;
    setAsking(true);
    setError('');
    try {
      const result = await askFinancialBuddy({ businessId, question: text });
      setAnswer(result.answer || '');
      setQuestion('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Financial Buddy is unavailable.');
    } finally {
      setAsking(false);
    }
  }

  if (isAllBusinessesView) {
    return <section className="panel"><h1>Financial Buddy</h1><p>Choose one business first. Finance records are intentionally kept business-specific so RTB Lounge and RTB Beauty Lounge do not get mixed together.</p></section>;
  }

  return (
    <div className="financial-buddy">
      <section className="panel financial-buddy__hero">
        <div><span className="financial-buddy__eyebrow">Finance · {businessUnit?.name || 'Selected business'}</span><h1>Financial Buddy</h1><p>Supabase is the system of record for transactions, recurring commitments, imports, calculations, permissions, and AI context.</p></div>
        <button className="secondary-button" disabled={loading} onClick={refreshAll} type="button"><RefreshCw size={16} /> Refresh</button>
      </section>

      {error ? <div className="alert danger">{error}</div> : null}

      <section className="financial-buddy__metrics">
        <div className="financial-buddy__metric"><span>Income recorded this month</span><strong>{money.format(Number(metrics.income || 0))}</strong></div>
        <div className="financial-buddy__metric"><span>Expenses recorded this month</span><strong>{money.format(Number(metrics.expenses || 0))}</strong></div>
        <div className="financial-buddy__metric"><span>Recorded net cash flow</span><strong>{money.format(Number(metrics.net || 0))}</strong></div>
        <div className="financial-buddy__metric"><span>Monthly recurring commitments</span><strong>{money.format(Number(metrics.recurring || 0))}</strong></div>
      </section>

      <div className="financial-buddy__grid">
        <section className="panel">
          <div className="section-heading"><div><span className="financial-buddy__eyebrow">Transactions</span><h2>Money in and out</h2></div><label className="secondary-button" style={{ cursor: importing ? 'wait' : 'pointer' }}><FileUp size={16} /> {importing ? 'Importing…' : 'Import CSV'}<input accept=".csv,text/csv" disabled={importing} hidden onChange={importCsv} type="file" /></label></div>
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
          {recentImports.length ? <small className="financial-buddy__empty">Last Supabase import: {recentImports[0].file_name} · {recentImports[0].imported_count} imported · {recentImports[0].rejected_count} rejected.</small> : null}
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
        <div><span className="financial-buddy__eyebrow">Decision support</span><h2><Bot size={20} style={{ verticalAlign: 'middle' }} /> Ask Financial Buddy</h2><p>Financial Buddy reads the same Supabase finance records, payroll data, and business performance data used by the dashboard.</p></div>
        <div className="financial-buddy__quick">{QUICK_PROMPTS.map((prompt) => <button className="secondary-button" disabled={asking} key={prompt} onClick={() => ask(prompt)} type="button">{prompt}</button>)}</div>
        <textarea onChange={(e) => setQuestion(e.target.value)} placeholder="Example: Can I safely take on another $1,000 monthly expense based on what we know?" rows={3} value={question} />
        <button className="primary-button" disabled={asking || !question.trim()} onClick={() => ask()} type="button"><Send size={16} /> {asking ? 'Analyzing…' : 'Ask Financial Buddy'}</button>
        {answer ? <div className="financial-buddy__answer">{answer}</div> : null}
      </section>
    </div>
  );
}
