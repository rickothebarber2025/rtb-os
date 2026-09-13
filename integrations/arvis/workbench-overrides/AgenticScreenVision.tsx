import React, { useEffect, useRef, useState } from 'react';
import { Activity, AlertCircle, Eye, Monitor, PlayCircle, RefreshCw, Scan, StopCircle } from 'lucide-react';
import type { ScreenVisionAnalysis } from '../types';

const DEFAULT_PROMPT = 'Inspect the current screen. Identify visible apps/windows, important UI state, errors, warnings, and the single most useful next action. Never invent metrics that are not visible.';

export const AgenticScreenVision: React.FC = () => {
  const [connected, setConnected] = useState(false);
  const [watching, setWatching] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [image, setImage] = useState<string>('');
  const [analysis, setAnalysis] = useState<ScreenVisionAnalysis | null>(null);
  const [history, setHistory] = useState<ScreenVisionAnalysis[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const timer = useRef<number | null>(null);

  const refreshStatus = async () => {
    try {
      const res = await fetch('/api/arvis/screen/status');
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `A.R.V.I.S. screen status failed (${res.status})`);
      setConnected(true);
      setWatching(Boolean(body?.running || body?.watching || body?.active));
      setError(null);
    } catch (e: any) {
      setConnected(false);
      setWatching(false);
      setError(e?.message || 'A.R.V.I.S. screen perception is offline.');
    }
  };

  const setWatch = async (on: boolean) => {
    setError(null);
    try {
      const res = await fetch('/api/arvis/screen/watch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ on, intervalMs: 2500 }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `Screen watch failed (${res.status})`);
      setConnected(true);
      setWatching(on);
      if (on) await analyzeFrame();
    } catch (e: any) {
      setError(e?.message || 'Could not control A.R.V.I.S. screen watch.');
    }
  };

  const analyzeFrame = async () => {
    if (analyzing) return;
    setAnalyzing(true);
    setError(null);
    try {
      const shotRes = await fetch('/api/arvis/browser/screenshot', { cache: 'no-store' });
      const shot = await shotRes.json();
      if (!shotRes.ok) throw new Error(shot.error || `Native screenshot failed (${shotRes.status})`);
      if (!shot.image) throw new Error('A.R.V.I.S. returned no screen image. Check macOS Screen Recording permission.');
      setImage(shot.image);

      const visionRes = await fetch('/api/gemini/screen-vision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: shot.image, prompt }),
      });
      const body = await visionRes.json();
      if (!visionRes.ok) throw new Error(body.error || `Vision analysis failed (${visionRes.status})`);
      if (body.isSimulated) throw new Error('Vision backend returned simulated perception. Fake fallback is disabled.');
      const next = body as ScreenVisionAnalysis;
      setAnalysis(next);
      setHistory(prev => [next, ...prev].slice(0, 10));
      setConnected(true);
    } catch (e: any) {
      setError(e?.message || 'Live screen perception failed.');
    } finally {
      setAnalyzing(false);
    }
  };

  useEffect(() => { refreshStatus(); }, []);
  useEffect(() => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    if (watching) timer.current = window.setInterval(analyzeFrame, 12000);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [watching, prompt]);

  return (
    <div className="flex-1 flex flex-col h-full bg-[#080d1a] text-slate-100 overflow-y-auto p-6 font-mono">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-cyan-900/30">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-cyan-500/10 border border-cyan-400/40 flex items-center justify-center text-cyan-400"><Eye className="w-5 h-5" /></div>
          <div><h1 className="text-xl font-sans font-bold text-white">AGENTIC SCREEN VISION & UI PERCEPTION</h1><p className="text-xs text-slate-400">Live native macOS perception through A.R.V.I.S. No synthetic screen or invented metrics.</p></div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`px-2 py-1 rounded text-[10px] border ${connected ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10' : 'text-rose-300 border-rose-500/40 bg-rose-500/10'}`}>{connected ? 'A.R.V.I.S. CONNECTED' : 'PERCEPTION OFFLINE'}</span>
          <button onClick={() => setWatch(!watching)} className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold border ${watching ? 'bg-amber-500/20 border-amber-400 text-amber-300' : 'bg-slate-800 border-slate-700 text-slate-300'}`}>{watching ? <Activity className="w-4 h-4" /> : <PlayCircle className="w-4 h-4" />} {watching ? 'Auto-Watch ON' : 'Start Native Watch'}</button>
          <button onClick={analyzeFrame} disabled={analyzing} className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white text-xs font-semibold">{analyzing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Scan className="w-4 h-4" />} {analyzing ? 'Perceiving…' : 'Analyze Live Screen'}</button>
        </div>
      </div>

      {error && <div className="mt-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex gap-2"><AlertCircle className="w-4 h-4 shrink-0" /><span>{error}</span></div>}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mt-6">
        <div className="lg:col-span-7 space-y-4">
          <div className="rounded-xl border border-cyan-800/40 bg-black overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-900/80 border-b border-cyan-900/30 text-xs flex justify-between"><span className="flex items-center gap-2"><Monitor className="w-4 h-4 text-cyan-400" /> LIVE NATIVE DISPLAY FRAME</span><span className="text-slate-500">{analysis?.timestamp || 'waiting for capture'}</span></div>
            <div className="aspect-video flex items-center justify-center bg-black">{image ? <img src={image} className="w-full h-full object-contain" alt="Current A.R.V.I.S. screen capture" /> : <div className="text-slate-500 text-sm text-center px-8"><Monitor className="w-10 h-10 mx-auto mb-3 opacity-40" />Run Analyze Live Screen. A.R.V.I.S. will capture the actual Mac display.</div>}</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4"><label className="text-[11px] text-slate-400">PERCEPTION INSTRUCTION</label><textarea value={prompt} onChange={e => setPrompt(e.target.value)} className="mt-2 w-full min-h-24 bg-slate-950 border border-slate-700 rounded-lg p-3 text-xs text-slate-200" /></div>
        </div>

        <div className="lg:col-span-5 space-y-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4"><h2 className="font-semibold text-white mb-3">Current perception</h2>{analysis ? <div className="space-y-4 text-xs"><div><div className="text-cyan-400 mb-1">RAW</div><div className="text-slate-300 whitespace-pre-wrap">{analysis.rawPerception}</div></div><div><div className="text-amber-400 mb-1">VISIBLE ISSUES</div>{analysis.uiErrors?.length ? analysis.uiErrors.map((x, i) => <div key={i} className="mb-2 p-2 bg-amber-500/10 border border-amber-500/20 rounded"><b>{x.type}</b> · {x.description}</div>) : <div className="text-slate-500">No visible UI errors reported.</div>}</div><div><div className="text-emerald-400 mb-1">NEXT ACTIONS</div>{analysis.recommendations?.map((x, i) => <div key={i} className="mb-2">{i + 1}. {x}</div>)}</div></div> : <div className="text-slate-500 text-xs">No live perception yet.</div>}</div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4"><h2 className="font-semibold text-white mb-3">Perception history</h2><div className="space-y-2 max-h-64 overflow-auto">{history.length ? history.map((x, i) => <div key={i} className="p-2 rounded bg-slate-950 border border-slate-800 text-[11px]"><div className="text-slate-500">{x.timestamp}</div><div className="text-slate-300 mt-1 line-clamp-3">{x.rawPerception}</div></div>) : <div className="text-slate-500 text-xs">No captures yet.</div>}</div></div>
        </div>
      </div>
    </div>
  );
};
