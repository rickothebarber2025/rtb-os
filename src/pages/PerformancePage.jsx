import { useEffect, useMemo, useState } from 'react';
import { Award, BarChart3, Clock3, Download, TrendingUp, Users, WalletCards } from 'lucide-react';
import DataTable from '../components/DataTable';
import EmptyState from '../components/EmptyState';
import MetricCard from '../components/MetricCard';
import StatusBadge from '../components/StatusBadge';
import { getStaffAttendance, getStaffDailySales, syncSquareAttendance } from '../services/rtbService';
import { formatCompactCurrency, formatCurrency, formatNumber } from '../utils/formatters';
import { isAllBusinessesUnit } from '../utils/businessProfiles';
import { LOW_SALES_THRESHOLD } from '../utils/constants';
import { buildTeamPerformance } from '../utils/performanceEngine';

function monthLabel(value) {
  if (!value) return 'No month selected';
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date(`${value}T12:00:00`));
}

const TABS = ['overview', 'rankings', 'scorecards', 'attendance', 'growth', 'reviews'];

export default function PerformancePage({ businessUnit, monthlyPerformanceSummary = [], payrollRuns = [], performanceSummary = [], staff = [] }) {
  const allBusinessesView = isAllBusinessesUnit(businessUnit);
  const scopedBusinessId = allBusinessesView ? null : businessUnit?.id;
  const [tab, setTab] = useState('overview');
  const [attendance, setAttendance] = useState([]);
  const [attendanceLoading, setAttendanceLoading] = useState(true);
  const [attendanceSyncing, setAttendanceSyncing] = useState(false);
  const [attendanceError, setAttendanceError] = useState('');
  const [attendanceNotice, setAttendanceNotice] = useState('');
  const [dailySales, setDailySales] = useState([]);
  const [dailySalesLoading, setDailySalesLoading] = useState(true);
  const [dailySalesError, setDailySalesError] = useState('');
  const [certificateError, setCertificateError] = useState('');
  const [certificateLoading, setCertificateLoading] = useState(false);
  const availableMonths = useMemo(() => [...new Set(monthlyPerformanceSummary.map((row) => row.month_start))], [monthlyPerformanceSummary]);
  const [selectedMonth, setSelectedMonth] = useState(availableMonths[0] || '');

  const latestEntryByStaff = useMemo(() => {
    const byStaff = new Map();
    payrollRuns.flatMap((run) => (run.payroll_entries || []).map((entry) => ({ ...entry, week_label: run.week_label, week_start: run.week_start }))).forEach((entry) => {
      if (!entry.staff_id) return;
      const current = byStaff.get(entry.staff_id);
      if (!current || new Date(entry.week_start) > new Date(current.week_start)) byStaff.set(entry.staff_id, entry);
    });
    return byStaff;
  }, [payrollRuns]);

  async function loadAttendance() {
    setAttendanceLoading(true); setAttendanceError('');
    try { setAttendance((await getStaffAttendance(scopedBusinessId, 30)) || []); }
    catch (err) { setAttendanceError(err.message || 'Unable to load attendance.'); }
    finally { setAttendanceLoading(false); }
  }

  async function loadDailySales() {
    setDailySalesLoading(true); setDailySalesError('');
    try { setDailySales((await getStaffDailySales(scopedBusinessId, 14)) || []); }
    catch (err) { setDailySalesError(err.message || 'Unable to load daily sales.'); }
    finally { setDailySalesLoading(false); }
  }

  useEffect(() => { loadAttendance(); loadDailySales(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [scopedBusinessId]);
  useEffect(() => { if (!availableMonths.includes(selectedMonth)) setSelectedMonth(availableMonths[0] || ''); }, [availableMonths, selectedMonth]);

  const attendanceByStaff = useMemo(() => {
    const summary = new Map();
    attendance.forEach((record) => {
      if (!record.staff_id) return;
      const current = summary.get(record.staff_id) || { hours: 0, lateShifts: 0, shifts: 0 };
      const hours = record.clock_out ? (new Date(record.clock_out) - new Date(record.clock_in)) / 3600000 : 0;
      const parts = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, minute: 'numeric', timeZone: 'America/Toronto' }).formatToParts(new Date(record.clock_in));
      const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
      const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0);
      const day = new Date(record.clock_in).getDay();
      const expected = day === 0 ? 11 : 10;
      const late = ((hour - expected) * 60 + minute) > 15;
      summary.set(record.staff_id, { hours: current.hours + hours, lateShifts: current.lateShifts + (late ? 1 : 0), shifts: current.shifts + 1 });
    });
    return summary;
  }, [attendance]);

  const teamPerformance = useMemo(() => buildTeamPerformance({ attendanceByStaff, latestEntryByStaff, performanceSummary }), [attendanceByStaff, latestEntryByStaff, performanceSummary]);
  const activeScored = teamPerformance.filter((row) => staff.find((member) => member.id === row.staff_id)?.active !== false);
  const averageScore = activeScored.length ? Math.round(activeScored.reduce((sum, row) => sum + row.performanceScore.score, 0) / activeScored.length) : 0;
  const totals = performanceSummary.reduce((acc, row) => ({ netSales: acc.netSales + Number(row.total_net_sales || 0), weeks: acc.weeks + Number(row.weeks_recorded || 0) }), { netSales: 0, weeks: 0 });
  const needsAttention = activeScored.filter((row) => row.performanceScore.score < 65).length;
  const topScore = activeScored[0] || null;

  const weekDates = useMemo(() => {
    const now = new Date(); const diff = now.getDay() === 0 ? -6 : 1 - now.getDay(); const start = new Date(now); start.setDate(start.getDate() + diff); start.setHours(0, 0, 0, 0);
    return new Set(Array.from({ length: 7 }, (_, index) => { const date = new Date(start); date.setDate(date.getDate() + index); return date.toISOString().slice(0, 10); }));
  }, []);
  const weeklyProgress = useMemo(() => {
    const map = new Map(); dailySales.forEach((row) => { if (row.staff_id && weekDates.has(row.sale_date)) map.set(row.staff_id, (map.get(row.staff_id) || 0) + Number(row.net_sales || 0)); }); return map;
  }, [dailySales, weekDates]);

  const monthlyRows = useMemo(() => monthlyPerformanceSummary.filter((row) => row.month_start === selectedMonth && !row.exclude_from_leaderboard), [monthlyPerformanceSummary, selectedMonth]);
  const topPerformer = monthlyRows[0] || null;

  async function handleSyncAttendance() {
    setAttendanceSyncing(true); setAttendanceError(''); setAttendanceNotice('');
    try { const result = await syncSquareAttendance(scopedBusinessId, 30); setAttendanceNotice(`Synced ${result.shiftsInserted || 0} new and ${result.shiftsUpdated || 0} updated shifts.`); await loadAttendance(); }
    catch (err) { setAttendanceError(err.message || 'Attendance sync failed.'); }
    finally { setAttendanceSyncing(false); }
  }

  async function handleDownloadCertificate() {
    setCertificateError(''); setCertificateLoading(true);
    try { const { downloadStaffOfMonthCertificate } = await import('../utils/certificates'); await downloadStaffOfMonthCertificate({ businessUnit, generatedAt: new Date(`${selectedMonth}T12:00:00`), performer: topPerformer }); }
    catch (err) { setCertificateError(err.message || 'Unable to generate certificate.'); }
    finally { setCertificateLoading(false); }
  }

  return <div className="page-grid">
    <section className="panel full-span">
      <div className="section-header"><div><span>RTB Performance Engine</span><h2>Team performance cockpit</h2></div><StatusBadge tone={averageScore >= 75 ? 'success' : averageScore >= 65 ? 'gold' : 'warning'}>{averageScore}/100 team score</StatusBadge></div>
      <p className="subtle-text">One performance system for sales, reliability, growth, client results and RTB standards. Managers see the staff assigned to their permitted business scope.</p>
      {allBusinessesView ? <div className="alert warning"><strong>All Businesses selected</strong><span>Rankings combine both businesses. Select one business for location-specific coaching and awards.</span></div> : null}
      <div className="segmented-control" role="tablist">{TABS.map((item) => <button className={tab === item ? 'is-active' : ''} key={item} onClick={() => setTab(item)} type="button">{item.charAt(0).toUpperCase() + item.slice(1)}</button>)}</div>
    </section>

    {tab === 'overview' ? <>
      <section className="metrics-grid full-span">
        <MetricCard icon={TrendingUp} label="Team net sales" trend={`${formatNumber(totals.weeks)} recorded weeks`} value={formatCompactCurrency(totals.netSales)} />
        <MetricCard icon={BarChart3} label="RTB team score" trend="100-point performance model" value={`${averageScore}/100`} />
        <MetricCard icon={Users} label="Needs attention" trend="Below 65 score" value={needsAttention} />
        <MetricCard icon={Award} label="Top performer" trend={topScore ? `${topScore.performanceScore.score}/100` : 'No score yet'} value={topScore?.full_name || '—'} />
      </section>
      <section className="panel full-span"><div className="section-header"><div><span>Management priorities</span><h2>What needs attention now</h2></div></div>
        {activeScored.length ? <div className="feedback-cards">{activeScored.slice(0, 6).map((row) => <article className="feedback-card" key={row.staff_id}><div className="feedback-card__header"><div><strong>#{row.scoreRank} {row.full_name}</strong><span>{row.performanceScore.score}/100 · {formatCurrency(row.avg_weekly_net)} avg week</span></div><StatusBadge tone={row.performanceScore.status.tone}>{row.performanceScore.status.label}</StatusBadge></div><p>{row.performanceScore.summary}</p><p><strong>Next action:</strong> {row.performanceScore.action}</p></article>)}</div> : <EmptyState icon={BarChart3} title="No performance history" message="Finalize payroll to start scoring the team." />}
      </section>
    </> : null}

    {tab === 'rankings' ? <section className="panel full-span"><div className="section-header"><div><span>Rankings</span><h2>RTB team leaderboard</h2></div></div><DataTable><table><thead><tr><th>Rank</th><th>Staff</th><th>RTB Score</th><th>Total sales</th><th>Avg week</th><th>Goal</th><th>Attendance</th><th>Status</th></tr></thead><tbody>{activeScored.map((row) => { const att = attendanceByStaff.get(row.staff_id) || {}; const latest = latestEntryByStaff.get(row.staff_id); const goal = Math.min(100, Math.round((Number(latest?.net_sales || 0) / LOW_SALES_THRESHOLD) * 100)); return <tr key={row.staff_id}><td><strong>#{row.scoreRank}</strong></td><td><strong>{row.full_name}</strong><br/><small>{row.business_unit}</small></td><td><strong>{row.performanceScore.score}/100</strong></td><td>{formatCurrency(row.total_net_sales)}</td><td>{formatCurrency(row.avg_weekly_net)}</td><td>{goal}%</td><td>{att.shifts || 0} shifts · {att.lateShifts || 0} late</td><td><StatusBadge tone={row.performanceScore.status.tone}>{row.performanceScore.status.label}</StatusBadge></td></tr>; })}</tbody></table></DataTable></section> : null}

    {tab === 'scorecards' ? <section className="panel full-span"><div className="section-header"><div><span>Scorecards</span><h2>Why each person has their score</h2></div></div><div className="feedback-cards">{activeScored.map((row) => <article className="feedback-card" key={row.staff_id}><div className="feedback-card__header"><div><strong>{row.full_name}</strong><span>#{row.scoreRank} · {row.performanceScore.score}/100</span></div><StatusBadge tone={row.performanceScore.status.tone}>{row.performanceScore.status.label}</StatusBadge></div><div className="stat-list">{row.performanceScore.components.map((component) => <div key={component.key}><span>{component.label}</span><strong>{component.score}/{component.max}</strong></div>)}</div><p>{row.performanceScore.summary}</p><p><strong>Management action:</strong> {row.performanceScore.action}</p></article>)}</div></section> : null}

    {tab === 'attendance' ? <section className="panel full-span"><div className="section-header"><div><span>Attendance</span><h2>{attendance.length} shifts · last 30 days</h2></div><button className="secondary-button" disabled={attendanceSyncing} onClick={handleSyncAttendance} type="button"><Clock3 size={16}/>{attendanceSyncing ? 'Syncing...' : 'Sync Square attendance'}</button></div>{attendanceError ? <div className="alert danger">{attendanceError}</div> : null}{attendanceNotice ? <div className="alert success">{attendanceNotice}</div> : null}{attendanceLoading ? <p className="subtle-text">Loading attendance...</p> : <div className="stat-list">{activeScored.map((row) => { const a = attendanceByStaff.get(row.staff_id) || {}; return <div key={row.staff_id}><span>{row.full_name}</span><strong>{a.shifts || 0} shifts · {Number(a.hours || 0).toFixed(1)}h · {a.lateShifts || 0} late</strong></div>; })}</div>}</section> : null}

    {tab === 'growth' ? <section className="panel full-span"><div className="section-header"><div><span>Growth</span><h2>Current week toward the ${LOW_SALES_THRESHOLD} floor</h2></div></div>{dailySalesError ? <div className="alert danger">{dailySalesError}</div> : null}{dailySalesLoading ? <p className="subtle-text">Loading live sales...</p> : <div className="team-goal-grid">{activeScored.map((row) => { const total = weeklyProgress.get(row.staff_id) || 0; const pct = Math.min(100, Math.round(total / LOW_SALES_THRESHOLD * 100)); return <div className="team-goal-card" key={row.staff_id}><div className="team-goal-card__header"><strong>{row.full_name}</strong><span>{formatCurrency(total)}</span></div><div className={`staff-hub-progress-track ${pct >= 100 ? 'is-achieved' : ''}`}><span style={{ width: `${pct}%` }}/></div><small>{pct}% of weekly floor · best week {formatCurrency(row.best_week_net)}</small></div>; })}</div>}</section> : null}

    {tab === 'reviews' ? <>
      <section className="panel full-span"><div className="section-header"><div><span>Staff of the month</span><h2>Recognition & review</h2></div><div className="section-header__controls"><label className="field month-field"><span>Month</span><select disabled={!availableMonths.length} onChange={(e) => setSelectedMonth(e.target.value)} value={selectedMonth}>{!availableMonths.length ? <option value="">No saved months</option> : null}{availableMonths.map((month) => <option key={month} value={month}>{monthLabel(month)}</option>)}</select></label><button className="primary-button" disabled={!topPerformer || certificateLoading} onClick={handleDownloadCertificate} type="button"><Download size={17}/>{certificateLoading ? 'Generating...' : 'Download PDF'}</button></div></div>{topPerformer ? <div className="certificate-preview"><Award size={24}/><div><strong>{topPerformer.full_name}</strong><span>{monthLabel(selectedMonth)} · {formatCurrency(topPerformer.total_net_sales)} sales</span></div></div> : <EmptyState icon={Award} title="No monthly award data" message="Finalize payroll to create monthly rankings."/>}{certificateError ? <div className="alert danger">{certificateError}</div> : null}</section>
      <section className="panel full-span"><div className="section-header"><div><span>Manager review queue</span><h2>Coaching decisions</h2></div></div><div className="feedback-cards">{activeScored.map((row) => <article className="feedback-card" key={row.staff_id}><div className="feedback-card__header"><strong>{row.full_name}</strong><StatusBadge tone={row.performanceScore.status.tone}>{row.performanceScore.status.label}</StatusBadge></div><p>{row.performanceScore.summary}</p><p><strong>Recommended action:</strong> {row.performanceScore.action}</p></article>)}</div></section>
    </> : null}
  </div>;
}
