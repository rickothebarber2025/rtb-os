import React, { useCallback, useEffect, useMemo, useState } from 'react';

type PayrollEntry = {
  staff_name_snapshot?: string;
  staff_name?: string;
  net_sales?: number;
  tips?: number;
  applied_commission_rate?: number;
  take_home?: number;
  deduction?: number;
};

type PayrollRun = {
  id?: string;
  business_name?: string;
  week_label?: string;
  week_start?: string;
  week_end?: string;
  status?: string;
  total_net_sales?: number;
  total_staff_payout?: number;
  total_deductions?: number;
  rtb_net?: number;
  payroll_entries?: PayrollEntry[];
  entries?: PayrollEntry[];
};

function money(value: unknown) {
  const amount = Number(value || 0);
  return amount.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' });
}

function readPayrollRuns(): PayrollRun[] {
  try {
    const raw = localStorage.getItem('rtb_os_snapshot_v1');
    if (!raw) return [];
    const snapshot = JSON.parse(raw);
    const runs = snapshot?.payload?.payrollRuns;
    return Array.isArray(runs) ? runs : [];
  } catch {
    return [];
  }
}

function runEntries(run?: PayrollRun | null): PayrollEntry[] {
  if (!run) return [];
  if (Array.isArray(run.payroll_entries)) return run.payroll_entries;
  if (Array.isArray(run.entries)) return run.entries;
  return [];
}

export const PayrollIntelligence: React.FC = () => {
  const [runs, setRuns] = useState<PayrollRun[]>(() => readPayrollRuns());
  const [question, setQuestion] = useState('Review the latest payroll and flag anything that needs owner attention.');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(() => setRuns(readPayrollRuns()), []);

  useEffect(() => {
    refresh();
    window.addEventListener('rtb-data-updated', refresh);
    return () => window.removeEventListener('rtb-data-updated', refresh);
  }, [refresh]);

  const latest = useMemo(() => {
    return [...runs].sort((a, b) => String(b.week_end || b.week_start || '').localeCompare(String(a.week_end || a.week_start || '')))[0] || null;
  }, [runs]);

  const entries = useMemo(() => runEntries(latest), [latest]);

  const aggregate = useMemo(() => runs.reduce((totals, run) => ({
    sales: totals.sales + Number(run.total_net_sales || 0),
    payout: totals.payout + Number(run.total_staff_payout || 0),
    deductions: totals.deductions + Number(run.total_deductions || 0),
    rtbNet: totals.rtbNet + Number(run.rtb_net || 0),
  }), { sales: 0, payout: 0, deductions: 0, rtbNet: 0 }), [runs]);

  const askPayrollAI = async () => {
    if (!question.trim()) return;
    if (!runs.length) {
      setError('No RTB OS payroll snapshot is available yet. Open RTB OS and refresh the live-data bridge.');
      return;
    }
    setBusy(true);
    setError('');
    setAnswer('');
    try {
      const response = await fetch('/api/payroll/assistant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          question: question.trim(),
          payrollContext: {
            sourceTruth: 'RTB OS / Supabase',
            latestRun: latest,
            recentRuns: runs.slice(0, 12),
          },
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `Payroll AI failed (${response.status})`);
      setAnswer(body.answer || 'No payroll analysis returned.');
    } catch (err: any) {
      setError(err?.message || 'Payroll AI is unavailable.');
    } finally {
      setBusy(false);
    }
  };

  if (!runs.length) {
    return (
      <div className="glass-panel rounded-xl p-6 border border-amber-500/30">
        <div className="text-amber-300 font-mono text-sm">PAYROLL DATA WAITING</div>
        <h2 className="text-xl font-bold mt-2">RTB Payroll Intelligence</h2>
        <p className="text-sm text-slate-400 mt-2">This module does not invent payroll. It activates when the RTB OS / Supabase payroll snapshot reaches Neural Workbench.</p>
        <button onClick={refresh} className="mt-4 px-3 py-2 rounded bg-cyan-500/15 border border-cyan-400/40 text-cyan-300 text-xs font-mono">REFRESH LIVE DATA</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-mono text-emerald-400">SOURCE: RTB OS / SUPABASE</div>
          <h1 className="text-xl font-bold text-white">Payroll Intelligence</h1>
          <p className="text-xs text-slate-400">Weekly payroll, commission review and owner-facing AI analysis. Payroll edits remain governed by RTB OS.</p>
        </div>
        <button onClick={refresh} className="px-3 py-2 rounded bg-[#122131] border border-[#273647] text-xs font-mono text-cyan-300">Refresh</button>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <div className="glass-panel rounded-xl p-4"><span className="text-[10px] text-slate-500 font-mono">LATEST WEEK SALES</span><div className="text-xl font-bold mt-1">{money(latest?.total_net_sales)}</div><div className="text-[10px] text-slate-500 mt-1">{latest?.week_label || `${latest?.week_start || ''} → ${latest?.week_end || ''}`}</div></div>
        <div className="glass-panel rounded-xl p-4"><span className="text-[10px] text-slate-500 font-mono">STAFF PAYOUT</span><div className="text-xl font-bold mt-1 text-cyan-300">{money(latest?.total_staff_payout)}</div><div className="text-[10px] text-slate-500 mt-1">{entries.length} payroll entries</div></div>
        <div className="glass-panel rounded-xl p-4"><span className="text-[10px] text-slate-500 font-mono">DEDUCTIONS</span><div className="text-xl font-bold mt-1 text-amber-300">{money(latest?.total_deductions)}</div><div className="text-[10px] text-slate-500 mt-1">Verified run value</div></div>
        <div className="glass-panel rounded-xl p-4"><span className="text-[10px] text-slate-500 font-mono">RTB NET</span><div className="text-xl font-bold mt-1 text-emerald-300">{money(latest?.rtb_net)}</div><div className="text-[10px] text-slate-500 mt-1">Status: {latest?.status || 'unknown'}</div></div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="glass-panel rounded-xl p-4 xl:col-span-2">
          <div className="flex justify-between border-b border-[#273647] pb-2 mb-3"><h3 className="font-semibold">Latest Payroll Entries</h3><span className="text-[10px] font-mono text-slate-500">READ ONLY</span></div>
          <div className="overflow-auto max-h-[360px]">
            <table className="w-full text-xs">
              <thead className="text-left text-slate-500 font-mono"><tr><th className="py-2">Staff</th><th>Sales</th><th>Tips</th><th>Rate</th><th>Deductions</th><th>Take Home</th></tr></thead>
              <tbody>
                {entries.map((entry, index) => <tr key={`${entry.staff_name_snapshot || entry.staff_name || 'staff'}-${index}`} className="border-t border-[#273647]/70"><td className="py-2.5 text-white">{entry.staff_name_snapshot || entry.staff_name || 'Unknown'}</td><td>{money(entry.net_sales)}</td><td>{money(entry.tips)}</td><td>{Number(entry.applied_commission_rate || 0)}%</td><td>{money(entry.deduction)}</td><td className="text-emerald-300 font-semibold">{money(entry.take_home)}</td></tr>)}
              </tbody>
            </table>
          </div>
        </div>

        <div className="glass-panel rounded-xl p-4">
          <h3 className="font-semibold">Payroll AI Analyst</h3>
          <p className="text-[11px] text-slate-500 mt-1">Ask about commission, missing entries, unusual payouts, week-over-week movement or owner review items.</p>
          <textarea value={question} onChange={(event) => setQuestion(event.target.value)} className="w-full mt-3 min-h-[110px] bg-[#0b1322] border border-[#273647] rounded p-3 text-xs text-slate-200" />
          <button onClick={askPayrollAI} disabled={busy} className="mt-2 w-full px-3 py-2 rounded bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-xs font-bold">{busy ? 'Analyzing…' : 'Analyze Payroll'}</button>
          {error && <div className="mt-3 p-2 rounded border border-rose-500/40 bg-rose-950/30 text-rose-300 text-xs">{error}</div>}
          {answer && <div className="mt-3 p-3 rounded border border-cyan-500/30 bg-cyan-950/20 text-xs leading-relaxed whitespace-pre-wrap text-slate-200">{answer}</div>}
        </div>
      </div>

      <div className="glass-panel rounded-xl p-4">
        <div className="text-[10px] font-mono text-slate-500">LOADED HISTORY</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-2 text-sm"><div><span className="text-slate-500 block text-[10px]">Runs</span><strong>{runs.length}</strong></div><div><span className="text-slate-500 block text-[10px]">Net Sales</span><strong>{money(aggregate.sales)}</strong></div><div><span className="text-slate-500 block text-[10px]">Staff Payout</span><strong>{money(aggregate.payout)}</strong></div><div><span className="text-slate-500 block text-[10px]">RTB Net</span><strong>{money(aggregate.rtbNet)}</strong></div></div>
      </div>
    </div>
  );
};
