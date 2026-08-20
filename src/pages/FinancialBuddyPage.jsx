import { useEffect, useMemo, useState } from 'react';
import { Bot, CalendarDays, CheckCircle2, FileUp, MailCheck, Plus, RefreshCw, Send, Trash2, XCircle } from 'lucide-react';
import {
  askFinancialBuddy,
  confirmFinanceMatch,
  createFinanceObligation,
  createFinanceTransaction,
  deleteFinanceObligation,
  deleteFinanceTransaction,
  importFinanceCsv,
  loadFinanceIntelligence,
  loadFinancePaymentEvidence,
  loadFinanceSnapshot,
  refreshFinanceWithEvidence,
  rejectFinanceMatch,
} from '../services/financeService';
import '../styles/financialBuddy.css';

const money = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });
const EMPTY_METRICS = { income: 0, expenses: 0, net: 0, recurring: 0 };
const EMPTY_INTELLIGENCE = { reconciliations: [], recurring_patterns: [], calendar: [], forecasts: [] };
const QUICK_PROMPTS = [
  'What is putting the most pressure on cash flow this month?',
  'What payments are still unmatched or need my attention?',
  'What does my 30-day cash-flow forecast suggest I should do next?',
];

function confidenceLabel(score) {
  if (score >= 90) return 'Confirmed-quality';
  if (score >= 75) return 'Probable';
  return 'Possible';
}

function evidenceStatus(row) {
  if (row.match_status === 'confirmed') return 'Email + payroll + bank confirmed';
  if (row.bank_transaction_id) return 'Email + bank matched · review';
  if (row.payroll_entry_id) return 'Email + payroll matched · awaiting bank';
  if (row.payment_kind === 'payroll') return 'Email identifies staff payment · awaiting bank';
  return 'Email evidence · needs classification';
}

export default function FinancialBuddyPage({ businessUnit, isAllBusinessesView, onRefresh }) {
  const businessId = businessUnit?.id;
  const [transactions, setTransactions] = useState([]);
  const [obligations, setObligations] = useState([]);
  const [metrics, setMetrics] = useState(EMPTY_METRICS);
  const [recentImports, setRecentImports] = useState([]);
  const [intelligence, setIntelligence] = useState(EMPTY_INTELLIGENCE);
  const [paymentEvidence, setPaymentEvidence] = useState([]);
  const [loading, setLoading] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [error, setError] = useState('');
  const [syncNotice, setSyncNotice] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [asking, setAsking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [transactionForm, setTransactionForm] = useState({ transaction_date: new Date().toISOString().slice(0, 10), direction: 'expense', amount: '', category: 'Operating expense', description: '' });
  const [obligationForm, setObligationForm] = useState({ name: '', amount: '', due_day: '1', frequency: 'monthly', category: 'Operating expense' });

  async function load({ clearError = true } = {}) {
    if (!businessId || isAllBusinessesView) return;
    setLoading(true); if (clearError) setError('');
    try {
      const [snapshot, intel, evidence] = await Promise.all([
        loadFinanceSnapshot(businessId),
        loadFinanceIntelligence(businessId),
        loadFinancePaymentEvidence(businessId),
      ]);
      setTransactions(snapshot.transactions || []);
      setObligations(snapshot.obligations || []);
      setMetrics(snapshot.metrics || EMPTY_METRICS);
      setRecentImports(snapshot.recent_imports || []);
      setIntelligence({ ...EMPTY_INTELLIGENCE, ...intel });
      setPaymentEvidence(evidence || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Finance data could not load.');
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [businessId, isAllBusinessesView]);

  async function recalculate() {
    if (!businessId) return;
    setRecalculating(true); setError(''); setSyncNotice('');
    try {
      const result = await refreshFinanceWithEvidence(businessId);
      setIntelligence({ ...EMPTY_INTELLIGENCE, ...(result.intelligence || {}) });
      if (result.evidenceWarning) {
        setSyncNotice(`Finance recalculated. Gmail auto-sync needs attention: ${result.evidenceWarning}`);
      } else if (result.evidenceSync) {
        setSyncNotice(`Payment evidence checked automatically · ${result.evidenceSync.stored || 0} email confirmations updated.`);
      }
      await load({ clearError: false });
      onRefresh?.();
    } catch (err) { setError(err instanceof Error ? err.message : 'Finance intelligence could not refresh.'); }
    finally { setRecalculating(false); }
  }

  async function addTransaction(event) {
    event.preventDefault();
    if (!businessId || !transactionForm.description.trim() || Number(transactionForm.amount) <= 0) return;
    setError('');
    try {
      await createFinanceTransaction({ ...transactionForm, business_unit_id: businessId, amount: Number(transactionForm.amount), description: transactionForm.description.trim(), source: 'manual' });
      setTransactionForm((current) => ({ ...current, amount: '', description: '' }));
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Transaction could not be saved.'); }
  }

  async function addObligation(event) {
    event.preventDefault();
    if (!businessId || !obligationForm.name.trim() || Number(obligationForm.amount) <= 0) return;
    setError('');
    try {
      await createFinanceObligation({ ...obligationForm, business_unit_id: businessId, amount: Number(obligationForm.amount), due_day: Number(obligationForm.due_day), status: 'active' });
      setObligationForm((current) => ({ ...current, name: '', amount: '' }));
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Recurring obligation could not be saved.'); }
  }

  async function removeTransaction(id) {
    setError('');
    try { await deleteFinanceTransaction(id, businessId); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Transaction could not be deleted.'); }
  }

  async function removeObligation(id) {
    setError('');
    try { await deleteFinanceObligation(id, businessId); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Obligation could not be deleted.'); }
  }

  async function importCsv(event) {
    const file = event.target.files?.[0];
    if (!file || !businessId) return;
    setImporting(true); setError(''); setSyncNotice('');
    try {
      const csvText = await file.text();
      const result = await importFinanceCsv({ businessId, csvText, fileName: file.name });
      if (!result.transactions?.length) throw new Error('No transactions were imported.');
      await recalculate();
    } catch (err) { setError(err instanceof Error ? err.message : 'CSV import failed.'); }
    finally { setImporting(false); event.target.value = ''; }
  }

  async function reviewMatch(id, approve) {
    setError('');
    try {
      if (approve) await confirmFinanceMatch(id, businessId); else await rejectFinanceMatch(id, businessId);
      const intel = await loadFinanceIntelligence(businessId);
      setIntelligence({ ...EMPTY_INTELLIGENCE, ...intel });
    } catch (err) { setError(err instanceof Error ? err.message : 'Reconciliation could not be updated.'); }
  }

  async function ask(prompt = question) {
    const text = String(prompt || '').trim();
    if (!text || !businessId || isAllBusinessesView) return;
    setAsking(true); setError('');
    try { const result = await askFinancialBuddy({ businessId, question: text }); setAnswer(result.answer || ''); setQuestion(''); }
    catch (err) { setError(err instanceof Error ? err.message : 'Financial Buddy is unavailable.'); }
    finally { setAsking(false); }
  }

  const evidenceSummary = useMemo(() => ({
    total: paymentEvidence.length,
    confirmed: paymentEvidence.filter((row) => row.match_status === 'confirmed').length,
    awaitingBank: paymentEvidence.filter((row) => !row.bank_transaction_id && row.payment_kind === 'payroll').length,
    bankMatched: paymentEvidence.filter((row) => Boolean(row.bank_transaction_id)).length,
  }), [paymentEvidence]);

  if (isAllBusinessesView) {
    return <section className="panel"><h1>Financial Buddy</h1><p>Choose one business first. Finance records, reconciliation and forecasting stay business-specific so the two locations are never mixed together.</p></section>;
  }

  const suggestedMatches = (intelligence.reconciliations || []).filter((row) => row.status === 'suggested');
  const confirmedMatches = (intelligence.reconciliations || []).filter((row) => row.status === 'confirmed');

  return (
    <div className="financial-buddy">
      <section className="panel financial-buddy__hero">
        <div><span className="financial-buddy__eyebrow">Finance · {businessUnit?.name || 'Selected business'}</span><h1>Financial Buddy</h1><p>One Supabase financial system for revenue, payroll, Gmail payment evidence, imported bank activity, reconciliation, recurring expenses, calendar planning and forecasts.</p></div>
        <button className="secondary-button" disabled={recalculating} onClick={recalculate} type="button"><RefreshCw size={16} /> {recalculating ? 'Analyzing…' : 'Recalculate finance'}</button>
      </section>

      {error ? <div className="alert danger">{error}</div> : null}
      {syncNotice ? <div className="alert info">{syncNotice}</div> : null}

      <section className="financial-buddy__metrics">
        <div className="financial-buddy__metric"><span>Income recorded this month</span><strong>{money.format(Number(metrics.income || 0))}</strong></div>
        <div className="financial-buddy__metric"><span>Expenses recorded this month</span><strong>{money.format(Number(metrics.expenses || 0))}</strong></div>
        <div className="financial-buddy__metric"><span>Recorded net cash flow</span><strong>{money.format(Number(metrics.net || 0))}</strong></div>
        <div className="financial-buddy__metric"><span>Monthly recurring commitments</span><strong>{money.format(Number(metrics.recurring || 0))}</strong></div>
      </section>

      <section className="panel">
        <div className="section-heading"><div><span className="financial-buddy__eyebrow">Automatic payment evidence</span><h2><MailCheck size={20} style={{ verticalAlign: 'middle' }} /> Gmail + payroll + bank</h2></div><span>{evidenceSummary.confirmed} three-way confirmed</span></div>
        <div className="financial-buddy__metrics">
          <div className="financial-buddy__metric"><span>Email confirmations</span><strong>{evidenceSummary.total}</strong></div>
          <div className="financial-buddy__metric"><span>Matched to bank</span><strong>{evidenceSummary.bankMatched}</strong></div>
          <div className="financial-buddy__metric"><span>Awaiting bank statement</span><strong>{evidenceSummary.awaitingBank}</strong></div>
          <div className="financial-buddy__metric"><span>Three-way confirmed</span><strong>{evidenceSummary.confirmed}</strong></div>
        </div>
        <div className="financial-buddy__list">
          {paymentEvidence.slice(0, 20).map((row) => <div className="financial-buddy__row" key={row.id}><div><strong>{row.recipient_name}</strong><br /><small>{String(row.deposited_at || '').slice(0, 10)} · {evidenceStatus(row)} · {row.match_confidence || 0}% confidence</small></div><strong>{money.format(Number(row.amount || 0))}</strong></div>)}
          {!paymentEvidence.length ? <p className="financial-buddy__empty">No payment confirmations have been captured for this business yet. Connect Google in Connections and Financial Buddy will scan trusted Interac confirmations automatically.</p> : null}
        </div>
        {evidenceSummary.awaitingBank > 0 && !recentImports.length ? <div className="alert warning">{evidenceSummary.awaitingBank} staff payment confirmation{evidenceSummary.awaitingBank === 1 ? '' : 's'} are waiting for bank-statement evidence. Import this business's bank CSV once; matching runs automatically after import.</div> : null}
      </section>

      <section className="panel">
        <div className="section-heading"><div><span className="financial-buddy__eyebrow">Prediction</span><h2>Cash-flow outlook</h2></div><CalendarDays size={20} /></div>
        <div className="financial-buddy__metrics">{(intelligence.forecasts || []).map((row) => <div className="financial-buddy__metric" key={row.id}><span>{row.horizon_days}-day forecast · {row.risk_level}</span><strong>{money.format(Number(row.expected_net || 0))}</strong><small>In {money.format(Number(row.expected_in || 0))} · Out {money.format(Number(row.expected_out || 0))}</small></div>)}</div>
        {!intelligence.forecasts?.length ? <p className="financial-buddy__empty">Recalculate Finance to build the first 7/30/60/90-day forecast.</p> : null}
      </section>

      <div className="financial-buddy__grid">
        <section className="panel">
          <div className="section-heading"><div><span className="financial-buddy__eyebrow">Bank reconciliation</span><h2>Suggested matches</h2></div><span>{confirmedMatches.length} confirmed</span></div>
          <div className="financial-buddy__list">
            {suggestedMatches.slice(0, 20).map((row) => <div className="financial-buddy__row" key={row.id}><div><strong>{row.match_label}</strong><br /><small>{confidenceLabel(row.confidence)} · {row.confidence}% · expected {money.format(Number(row.expected_amount || 0))} · bank {money.format(Number(row.actual_amount || 0))}</small></div><div className="financial-buddy__actions"><button className="ghost-button small" onClick={() => reviewMatch(row.id, true)} title="Confirm match" type="button"><CheckCircle2 size={16} /></button><button className="ghost-button small" onClick={() => reviewMatch(row.id, false)} title="Reject match" type="button"><XCircle size={16} /></button></div></div>)}
            {!suggestedMatches.length ? <p className="financial-buddy__empty">No suggested bank matches need review. Gmail-only payment evidence is shown above until a bank statement is available.</p> : null}
          </div>
        </section>
        <section className="panel"><span className="financial-buddy__eyebrow">Detected automatically</span><h2>Recurring patterns</h2><div className="financial-buddy__list">{(intelligence.recurring_patterns || []).slice(0, 20).map((row) => <div className="financial-buddy__row" key={row.id}><div><strong>{row.label}</strong><br /><small>{row.cadence} · {row.occurrence_count} occurrences · {row.confidence}% confidence · next {row.next_expected_date || 'unknown'}</small></div><strong>{row.direction === 'income' ? '+' : '-'}{money.format(Number(row.avg_amount || 0))}</strong></div>)}{!intelligence.recurring_patterns?.length ? <p className="financial-buddy__empty">Recurring patterns appear after enough imported bank history is available.</p> : null}</div></section>
      </div>

      <section className="panel"><div className="section-heading"><div><span className="financial-buddy__eyebrow">Financial calendar</span><h2>Upcoming 90 days</h2></div><CalendarDays size={20} /></div><div className="financial-buddy__list">{(intelligence.calendar || []).slice(0, 40).map((row) => <div className="financial-buddy__row" key={row.id}><div><strong>{row.event_date} · {row.label}</strong><br /><small>{row.event_type} · {row.status} · {row.confidence}% confidence</small></div><strong className={row.direction === 'income' ? 'financial-buddy__amount--income' : 'financial-buddy__amount--expense'}>{row.direction === 'income' ? '+' : '-'}{money.format(Number(row.expected_amount || 0))}</strong></div>)}{!intelligence.calendar?.length ? <p className="financial-buddy__empty">Recalculate Finance to generate upcoming obligations and predicted recurring cash movements.</p> : null}</div></section>

      <div className="financial-buddy__grid">
        <section className="panel">
          <div className="section-heading"><div><span className="financial-buddy__eyebrow">Transactions</span><h2>Money in and out</h2></div><label className="secondary-button" style={{ cursor: importing ? 'wait' : 'pointer' }}><FileUp size={16} /> {importing ? 'Importing…' : 'Import bank CSV'}<input accept=".csv,text/csv" disabled={importing} hidden onChange={importCsv} type="file" /></label></div>
          <form className="financial-buddy__form" onSubmit={addTransaction}>
            <label>Date<input type="date" value={transactionForm.transaction_date} onChange={(e) => setTransactionForm((v) => ({ ...v, transaction_date: e.target.value }))} /></label>
            <label>Type<select value={transactionForm.direction} onChange={(e) => setTransactionForm((v) => ({ ...v, direction: e.target.value }))}><option value="expense">Expense</option><option value="income">Income</option></select></label>
            <label>Amount<input min="0.01" step="0.01" type="number" value={transactionForm.amount} onChange={(e) => setTransactionForm((v) => ({ ...v, amount: e.target.value }))} /></label>
            <label>Category<input value={transactionForm.category} onChange={(e) => setTransactionForm((v) => ({ ...v, category: e.target.value }))} /></label>
            <label className="full">Description<input placeholder="Rent, supplies, owner transfer…" value={transactionForm.description} onChange={(e) => setTransactionForm((v) => ({ ...v, description: e.target.value }))} /></label>
            <button className="primary-button full" type="submit"><Plus size={16} /> Add transaction</button>
          </form>
          <div className="financial-buddy__list">{transactions.length ? transactions.slice(0, 25).map((row) => <div className="financial-buddy__row" key={row.id}><div><strong>{row.description}</strong><br /><small>{row.transaction_date} · {row.category} · {row.source}</small></div><strong className={row.direction === 'income' ? 'financial-buddy__amount--income' : 'financial-buddy__amount--expense'}>{row.direction === 'income' ? '+' : '-'}{money.format(Number(row.amount || 0))}</strong><button aria-label="Delete transaction" className="ghost-button small" onClick={() => removeTransaction(row.id)} type="button"><Trash2 size={15} /></button></div>) : <p className="financial-buddy__empty">No finance transactions recorded yet.</p>}</div>
          {recentImports.length ? <small className="financial-buddy__empty">Last import: {recentImports[0].file_name} · {recentImports[0].imported_count} imported · {recentImports[0].rejected_count} rejected.</small> : null}
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
          <div className="financial-buddy__list">{obligations.length ? obligations.map((row) => <div className="financial-buddy__row" key={row.id}><div><strong>{row.name}</strong><br /><small>Due {row.due_day} · {row.frequency}</small></div><strong>{money.format(Number(row.amount || 0))}</strong><button aria-label="Delete obligation" className="ghost-button small" onClick={() => removeObligation(row.id)} type="button"><Trash2 size={15} /></button></div>) : <p className="financial-buddy__empty">Add rent, utilities, debt payments, subscriptions and other known commitments.</p>}</div>
        </section>
      </div>

      <section className="panel financial-buddy__ask">
        <div><span className="financial-buddy__eyebrow">Decision support</span><h2><Bot size={20} style={{ verticalAlign: 'middle' }} /> Ask Financial Buddy</h2><p>Financial Buddy uses the same Supabase transactions, payroll, payment evidence, reconciliation status, calendar and cash-flow forecasts shown above.</p></div>
        <div className="financial-buddy__quick">{QUICK_PROMPTS.map((prompt) => <button className="secondary-button" disabled={asking} key={prompt} onClick={() => ask(prompt)} type="button">{prompt}</button>)}</div>
        <textarea onChange={(e) => setQuestion(e.target.value)} placeholder="Example: What expenses are coming in the next 30 days and where is the biggest cash-flow risk?" rows={3} value={question} />
        <button className="primary-button" disabled={asking || !question.trim()} onClick={() => ask()} type="button"><Send size={16} /> {asking ? 'Analyzing…' : 'Ask Financial Buddy'}</button>
        {answer ? <div className="financial-buddy__answer">{answer}</div> : null}
      </section>
      {loading ? <span className="financial-buddy__empty">Refreshing Finance…</span> : null}
    </div>
  );
}
