import React, { useState } from 'react';

interface SalonIntelViewProps {
  onTriggerAction: (actionName: string) => void;
}

export const SalonIntelView: React.FC<SalonIntelViewProps> = ({ onTriggerAction }) => {
  const [stock, setStock] = useState([
    { name: 'Matte Clay Hair Pomade 100g', stock: 28, reorderAt: 10, status: 'OPTIMAL' },
    { name: 'Beard Growth & Conditioning Oil 50ml', stock: 4, reorderAt: 8, status: 'LOW_STOCK' },
    { name: 'Cooling Aftershave Tonic 250ml', stock: 19, reorderAt: 5, status: 'OPTIMAL' },
    { name: 'Scalp Detox Cleansing Shampoo 500ml', stock: 12, reorderAt: 8, status: 'OPTIMAL' },
  ]);

  const handleRestock = (index: number) => {
    setStock((prev) =>
      prev.map((item, i) => (i === index ? { ...item, stock: item.stock + 20, status: 'OPTIMAL' } : item))
    );
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      <div className="glass-panel rounded-xl p-4 col-span-1 md:col-span-2">
        <div className="flex justify-between items-center border-b border-[#46464c]/40 pb-2 mb-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#4cd7f6] text-lg">pie_chart</span>
            <h3 className="font-semibold text-base text-[#d4e4fa]">Salon Service & Product Intel</h3>
          </div>
          <span className="text-xs font-mono text-gray-400">REALTIME TELEMETRY</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <div className="bg-[#122131] p-3 rounded border border-[#273647]">
            <span className="text-xs text-gray-400 block font-mono">Top Service</span>
            <span className="text-lg font-bold text-[#d4e4fa]">Executive Haircut</span>
            <span className="text-xs text-[#22c55e] font-mono block mt-1">42% of revenue</span>
          </div>
          <div className="bg-[#122131] p-3 rounded border border-[#273647]">
            <span className="text-xs text-gray-400 block font-mono">Avg Ticket Size</span>
            <span className="text-lg font-bold text-[#4cd7f6]">$68.50</span>
            <span className="text-xs text-[#22c55e] font-mono block mt-1">+8.4% vs last week</span>
          </div>
          <div className="bg-[#122131] p-3 rounded border border-[#273647]">
            <span className="text-xs text-gray-400 block font-mono">Rebooking Rate</span>
            <span className="text-lg font-bold text-[#4ae176]">84.2%</span>
            <span className="text-xs text-[#4ae176] font-mono block mt-1">Target: &gt;80%</span>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-xs font-mono text-gray-300"><span>Signature Haircuts & Styling</span><span>54%</span></div>
          <div className="w-full bg-[#122131] h-2 rounded overflow-hidden"><div className="bg-[#06b6d4] h-full w-[54%]"></div></div>
          <div className="flex justify-between text-xs font-mono text-gray-300"><span>Beard Trims & Hot Towel Shaves</span><span>28%</span></div>
          <div className="w-full bg-[#122131] h-2 rounded overflow-hidden"><div className="bg-[#22c55e] h-full w-[28%]"></div></div>
          <div className="flex justify-between text-xs font-mono text-gray-300"><span>Retail Product Sales</span><span>18%</span></div>
          <div className="w-full bg-[#122131] h-2 rounded overflow-hidden"><div className="bg-[#ffb4ab] h-full w-[18%]"></div></div>
        </div>
      </div>

      <div className="glass-panel rounded-xl p-4 col-span-1">
        <div className="flex justify-between items-center border-b border-[#46464c]/40 pb-2 mb-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#ffb4ab] text-lg">inventory_2</span>
            <h3 className="font-semibold text-base text-[#d4e4fa]">Inventory Telemetry</h3>
          </div>
        </div>

        <div className="space-y-2.5">
          {stock.map((item, idx) => (
            <div key={idx} className="p-2.5 bg-[#122131] rounded border border-[#273647] flex justify-between items-center text-xs">
              <div className="pr-2">
                <span className="font-medium text-[#d4e4fa] block truncate max-w-[160px]">{item.name}</span>
                <span className="font-mono text-gray-400 block text-[11px]">Qty: <strong className={item.stock <= item.reorderAt ? 'text-[#ffb4ab]' : 'text-[#4cd7f6]'}>{item.stock}</strong> units</span>
              </div>
              {item.stock <= item.reorderAt ? (
                <button onClick={() => handleRestock(idx)} className="bg-[#93000a]/30 text-[#ffb4ab] border border-[#ffb4ab]/40 px-2 py-1 rounded font-mono text-[10px] font-bold hover:bg-[#93000a]/50">RESTOCK</button>
              ) : (
                <span className="font-mono text-[10px] text-[#4ae176] bg-[#4ae176]/10 px-2 py-0.5 rounded border border-[#4ae176]/30">OK</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export const MarketingWarRoomView: React.FC<SalonIntelViewProps> = ({ onTriggerAction }) => {
  const [playbook, setPlaybook] = useState<any>(null);
  const [drafts, setDrafts] = useState<any[]>([]);
  const [form, setForm] = useState({
    businessScope: 'RTB Lounge',
    channel: 'email',
    goal: 'bring past clients back into the chair this week',
    offer: '',
    audience: 'clients who already know RTB',
    tone: 'direct, premium, local, useful'
  });
  const [activeDraft, setActiveDraft] = useState<any>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  React.useEffect(() => {
    fetch('/api/marketing/playbook/status')
      .then((res) => res.json())
      .then((data) => {
        setPlaybook(data);
        setDrafts(data.drafts || []);
      })
      .catch((error) => setStatusMessage(error.message || 'Marketing playbook unavailable'));
  }, []);

  const updateForm = (key: string, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const generateDraft = async () => {
    setBusy(true);
    setStatusMessage(null);
    try {
      const res = await fetch('/api/marketing/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Draft failed');
      setActiveDraft(data);
      setDrafts((current) => [data, ...current.filter((item) => item.id !== data.id)].slice(0, 10));
      setStatusMessage('Draft created. Nothing was sent.');
    } catch (error: any) {
      setStatusMessage(error.message || 'Draft failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      <div className="glass-panel rounded-xl p-4 col-span-1 md:col-span-2">
        <div className="flex justify-between items-center border-b border-[#46464c]/40 pb-2 mb-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#ffb4ab] text-lg">campaign</span>
            <h3 className="font-semibold text-base text-[#d4e4fa]">RTB Marketing Machine</h3>
          </div>
          <button onClick={generateDraft} disabled={busy} className="bg-[#06b6d4] hover:bg-[#0891b2] disabled:opacity-50 text-black font-bold text-xs px-3 py-1.5 rounded font-mono flex items-center gap-1 transition-all active:scale-95 shadow">
            <span className="material-symbols-outlined text-sm">edit_square</span>{busy ? 'Generating' : 'Generate Draft'}
          </button>
        </div>

        {statusMessage && <div className="mb-3 p-2.5 bg-[#06b6d4]/10 border border-[#06b6d4]/40 text-[#4cd7f6] text-xs font-mono rounded">{statusMessage}</div>}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="space-y-2.5">
            <label className="block text-[10px] font-mono text-gray-400 uppercase">Business</label>
            <select value={form.businessScope} onChange={(event) => updateForm('businessScope', event.target.value)} className="w-full bg-[#122131] border border-[#273647] rounded px-3 py-2 text-sm text-[#d4e4fa]"><option>RTB Lounge</option><option>RTB Beauty Lounge</option><option>Both RTB businesses</option></select>
            <label className="block text-[10px] font-mono text-gray-400 uppercase">Channel</label>
            <select value={form.channel} onChange={(event) => updateForm('channel', event.target.value)} className="w-full bg-[#122131] border border-[#273647] rounded px-3 py-2 text-sm text-[#d4e4fa]"><option value="email">Email</option><option value="sms">SMS</option><option value="social">Social post</option><option value="paid-ad">Paid ad</option><option value="landing-page">Landing page</option></select>
            <label className="block text-[10px] font-mono text-gray-400 uppercase">Goal</label>
            <textarea value={form.goal} onChange={(event) => updateForm('goal', event.target.value)} className="w-full min-h-[74px] bg-[#122131] border border-[#273647] rounded px-3 py-2 text-sm text-[#d4e4fa]" />
            <label className="block text-[10px] font-mono text-gray-400 uppercase">Offer or next step</label>
            <input value={form.offer} onChange={(event) => updateForm('offer', event.target.value)} placeholder="Optional. Use verified offer only." className="w-full bg-[#122131] border border-[#273647] rounded px-3 py-2 text-sm text-[#d4e4fa]" />
            <label className="block text-[10px] font-mono text-gray-400 uppercase">Audience</label>
            <input value={form.audience} onChange={(event) => updateForm('audience', event.target.value)} className="w-full bg-[#122131] border border-[#273647] rounded px-3 py-2 text-sm text-[#d4e4fa]" />
          </div>

          <div className="bg-[#122131] border border-[#273647] rounded p-3 min-h-[360px]">
            {activeDraft ? (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] text-[#4ae176] font-mono uppercase">{activeDraft.status}</p><h4 className="mt-1 text-base font-bold text-[#d4e4fa]">{activeDraft.subject}</h4></div><span className="shrink-0 text-[10px] text-amber-300 border border-amber-500/40 rounded px-2 py-1">APPROVAL</span></div>
                <pre className="whitespace-pre-wrap text-xs leading-relaxed text-gray-300 bg-black/25 border border-[#273647] rounded p-3 max-h-56 overflow-auto">{activeDraft.body}</pre>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] font-mono"><div className="bg-black/25 rounded border border-[#273647] p-2"><span className="text-gray-500 block">Funnel</span><strong className="text-[#4cd7f6]">{activeDraft.funnelStage}</strong></div><div className="bg-black/25 rounded border border-[#273647] p-2"><span className="text-gray-500 block">Source truth</span><strong className="text-[#4ae176]">{activeDraft.sourceTruth}</strong></div></div>
                <div><p className="text-[10px] uppercase text-gray-500 mb-1">Metrics to watch</p><div className="flex flex-wrap gap-1.5">{(activeDraft.metrics || []).map((metric: string) => <span key={metric} className="text-[10px] border border-cyan-900/50 rounded px-2 py-1 text-cyan-300">{metric}</span>)}</div></div>
              </div>
            ) : (
              <div className="h-full min-h-[320px] grid place-items-center text-center"><div><span className="material-symbols-outlined text-4xl text-cyan-900">schema</span><p className="mt-3 text-sm text-gray-300">Pick the scope, channel, and goal.</p><p className="mt-1 text-xs text-gray-600">A.R.V.I.S. will generate a draft using the local marketing playbook.</p></div></div>
            )}
          </div>
        </div>
      </div>

      <div className="glass-panel rounded-xl p-4 col-span-1">
        <div className="flex justify-between items-center border-b border-[#46464c]/40 pb-2 mb-3"><div className="flex items-center gap-2"><span className="material-symbols-outlined text-[#4ae176] text-lg">account_tree</span><h3 className="font-semibold text-base text-[#d4e4fa]">Playbook Status</h3></div></div>
        <div className="space-y-3 font-mono text-xs">
          <div className="bg-[#122131] p-2.5 rounded border border-[#273647] flex justify-between"><span className="text-gray-400">Jared files</span><span className="font-bold text-[#4cd7f6]">{playbook ? `${playbook.availableFiles}/${playbook.totalFiles}` : 'checking'}</span></div>
          <div className="bg-[#122131] p-2.5 rounded border border-[#273647] flex justify-between"><span className="text-gray-400">Mode</span><span className="font-bold text-[#4ae176]">Draft only</span></div>
          <div className="bg-[#122131] p-2.5 rounded border border-[#273647] flex justify-between"><span className="text-gray-400">Send/post</span><span className="font-bold text-amber-300">Approval required</span></div>
          <div><p className="text-[10px] uppercase text-gray-500 mb-2">Recent drafts</p><div className="space-y-2">{drafts.slice(0, 5).map((draft) => <button key={draft.id} onClick={() => setActiveDraft(draft)} className="w-full text-left bg-black/25 border border-[#273647] rounded p-2 hover:border-cyan-700"><span className="block text-[#d4e4fa] truncate">{draft.subject}</span><span className="block text-[10px] text-gray-500 mt-1">{draft.businessScope} · {draft.channel}</span></button>)}{!drafts.length && <p className="text-[10px] text-gray-600 text-center py-3">No drafts yet.</p>}</div></div>
        </div>
      </div>
    </div>
  );
};
