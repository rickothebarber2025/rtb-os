import React, { useState, useEffect } from 'react';
import { fetchLiveRTBSnapshot, getStoredOperationsData } from '../lib/rtbDataStore';
import { RTBOperationsData } from '../types';
import { Database, RefreshCw } from 'lucide-react';

interface RevenueMatrixWidgetProps {
  onOpenDataConnect?: () => void;
}

export const RevenueMatrixWidget: React.FC<RevenueMatrixWidgetProps> = ({ onOpenDataConnect }) => {
  const [opsData, setOpsData] = useState<RTBOperationsData>(getStoredOperationsData);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [timeframe, setTimeframe] = useState<'today' | '14d' | 'month'>('today');
  const [sourceNote, setSourceNote] = useState<string>('Loading live RTB data...');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refreshLiveData = async () => {
    setIsRefreshing(true);
    try {
      const snapshot = await fetchLiveRTBSnapshot();
      setOpsData(snapshot.operations);
      const source = snapshot.operations.sourceTruth === 'supabase_cached' ? 'Supabase cached gateway' : snapshot.operations.sourceTruth;
      setSourceNote(snapshot.operations.todayAvailable ? `Live RTB data: ${source}` : `Today totals unavailable from ${source}; showing verified trailing totals.`);
    } catch (error: any) {
      setSourceNote(error.message || 'RTB live data unavailable.');
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    refreshLiveData();
    const handleUpdate = () => refreshLiveData();
    window.addEventListener('rtb-data-updated', handleUpdate);
    return () => window.removeEventListener('rtb-data-updated', handleUpdate);
  }, []);

  const loungeToday = opsData.todayByBusiness['RTB Lounge']?.netSales || 0;
  const beautyToday = opsData.todayByBusiness['RTB Beauty Lounge']?.netSales || 0;
  const todayTotal = loungeToday + beautyToday;

  const currentRevenue =
    timeframe === 'today' ? todayTotal :
    timeframe === '14d' ? opsData.sales14d :
    opsData.sales14d * 2.1;

  const goal =
    timeframe === 'today' ? 3200 :
    timeframe === '14d' ? 30000 :
    60000;

  const progressPercent = Math.min(100, Math.round((currentRevenue / goal) * 100));

  return (
    <div className="glass-panel rounded-xl p-4 col-span-1 md:col-span-2 xl:col-span-2 shadow-lg relative overflow-hidden">
      <div className="flex justify-between items-center border-b border-[#46464c]/40 pb-2 mb-3">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[#4cd7f6] text-lg">payments</span>
          <div>
            <h3 className="font-semibold text-base text-[#d4e4fa] flex items-center gap-2">
              <span>Dual-Shop Revenue Matrix</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">CAD ($)</span>
              {opsData.sourceTruth === 'csv_import' && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">Square CSV Active</span>
              )}
              {opsData.sourceTruth !== 'baseline_seed' && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">{opsData.sourceTruth.replace(/_/g, ' ')}</span>
              )}
            </h3>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onOpenDataConnect && (
            <button onClick={onOpenDataConnect} title="Connect Real Database or upload Square CSV" className="hidden sm:flex items-center gap-1 text-[11px] font-mono bg-cyan-950/80 hover:bg-cyan-900/80 text-cyan-300 px-2.5 py-1 rounded border border-cyan-800/60 transition-all cursor-pointer">
              <Database className="w-3 h-3 text-cyan-400" /><span>Connect Database</span>
            </button>
          )}
          <button onClick={refreshLiveData} disabled={isRefreshing} className="hidden sm:flex items-center gap-1 text-[11px] font-mono bg-[#0b1522] hover:bg-[#122131] text-emerald-300 px-2.5 py-1 rounded border border-emerald-800/60 transition-all cursor-pointer disabled:opacity-50">
            <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} /><span>Live Refresh</span>
          </button>

          <div className="flex bg-[#122131] rounded p-0.5 border border-[#273647] mr-1 text-xs font-mono">
            <button onClick={() => setTimeframe('today')} className={`px-2 py-0.5 rounded transition-all cursor-pointer ${timeframe === 'today' ? 'bg-[#273647] text-[#4cd7f6] font-bold' : 'text-gray-400 hover:text-white'}`}>Today</button>
            <button onClick={() => setTimeframe('14d')} className={`px-2 py-0.5 rounded transition-all cursor-pointer ${timeframe === '14d' ? 'bg-[#273647] text-[#4cd7f6] font-bold' : 'text-gray-400 hover:text-white'}`}>14 Days</button>
            <button onClick={() => setTimeframe('month')} className={`px-2 py-0.5 rounded transition-all cursor-pointer ${timeframe === 'month' ? 'bg-[#273647] text-[#4cd7f6] font-bold' : 'text-gray-400 hover:text-white'}`}>Month</button>
          </div>

          <span onClick={() => setIsCollapsed(!isCollapsed)} className="material-symbols-outlined text-[#c6c6cd] text-[18px] cursor-pointer hover:text-white select-none" title={isCollapsed ? 'Expand' : 'Collapse'}>{isCollapsed ? 'add' : 'remove'}</span>
        </div>
      </div>

      {!isCollapsed && (
        <div className="bg-[#122131] relative overflow-hidden border border-[#1e293b] rounded-lg flex flex-col p-4">
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:20px_20px] opacity-30 pointer-events-none"></div>

          <div className="z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
            <div>
              <div className="text-[11px] font-mono text-gray-400 uppercase tracking-wider">Combined Net Revenue ({timeframe === 'today' ? 'Today' : timeframe === '14d' ? '14-Day Trailing' : 'Monthly Projected'})</div>
              <div className="flex items-baseline gap-3 mt-0.5">
                <span className="text-3xl sm:text-4xl font-bold text-white tracking-tight font-sans">${currentRevenue.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                <span className="text-emerald-400 font-mono font-bold text-xs bg-emerald-950/70 px-2 py-0.5 rounded border border-emerald-800/60">{timeframe === 'today' && !opsData.todayAvailable ? 'UNAVAILABLE' : progressPercent >= 85 ? 'ON TARGET' : 'PACING'}</span>
              </div>
              <div className="text-[11px] text-gray-400 font-mono mt-1">{sourceNote}</div>
            </div>

            <div className="flex items-center gap-3 text-xs font-mono">
              <div className="p-2 rounded bg-[#0b1522] border border-[#273647]"><div className="text-[10px] text-gray-400">Target</div><div className="text-sm font-bold text-gray-200">${goal.toLocaleString()} CAD</div></div>
              <div className="p-2 rounded bg-[#0b1522] border border-[#273647]"><div className="text-[10px] text-gray-400">Pacing</div><div className="text-sm font-bold text-cyan-300">{progressPercent}%</div></div>
            </div>
          </div>

          <div className="w-full h-2 bg-[#273647] rounded-full overflow-hidden mb-4 relative z-10"><div className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-500 rounded-full" style={{ width: `${progressPercent}%` }}></div></div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 z-10">
            <div className="p-3 rounded-xl bg-[#0a1626]/90 border border-emerald-900/50 hover:border-emerald-500/50 transition-all">
              <div className="flex items-center justify-between mb-1"><div className="flex items-center gap-1.5 font-bold text-white text-xs"><span className="w-2 h-2 rounded-full bg-emerald-400"></span><span>RTB Lounge</span><span className="text-[10px] text-gray-400 font-mono font-normal">(306 Cumberland)</span></div><span className="text-[10px] font-mono text-emerald-300 bg-emerald-950 px-1.5 py-0.5 rounded border border-emerald-800">{opsData.todayByBusiness['RTB Lounge']?.orders || 0} orders</span></div>
              <div className="text-xl font-bold text-emerald-300 font-mono">${loungeToday.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              <div className="text-[10px] text-gray-400 font-mono mt-0.5">Barbering, Fades, Hot Towel & Braids</div>
            </div>

            <div className="p-3 rounded-xl bg-[#0a1626]/90 border border-purple-900/50 hover:border-purple-500/50 transition-all">
              <div className="flex items-center justify-between mb-1"><div className="flex items-center gap-1.5 font-bold text-white text-xs"><span className="w-2 h-2 rounded-full bg-purple-400"></span><span>RTB Beauty Lounge</span><span className="text-[10px] text-gray-400 font-mono font-normal">(Ottawa)</span></div><span className="text-[10px] font-mono text-purple-300 bg-purple-950 px-1.5 py-0.5 rounded border border-purple-800">{opsData.todayByBusiness['RTB Beauty Lounge']?.orders || 0} orders</span></div>
              <div className="text-xl font-bold text-purple-300 font-mono">${beautyToday.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              <div className="text-[10px] text-gray-400 font-mono mt-0.5">Nails, Lashes, Brow Shaping & Waxing</div>
            </div>
          </div>

          <div className="mt-3.5 flex gap-2 flex-wrap justify-between items-center pt-2.5 border-t border-[#1e293b] w-full text-xs font-mono z-10">
            <span className="text-[11px] text-gray-400">Source truth: {opsData.sourceTruth.replace(/_/g, ' ')}</span>
            <span className="text-[11px] text-cyan-300">14d orders: {opsData.orders14d || 0} · active staff: {opsData.activeStaffCount || 0}</span>
          </div>
        </div>
      )}
    </div>
  );
};
