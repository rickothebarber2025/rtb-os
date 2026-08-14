import {
  AlertCircle,
  AlertTriangle,
  BadgeDollarSign,
  BellRing,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Store,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import AdminChecklistDashboard from '../components/AdminChecklistDashboard';
import DataTable from '../components/DataTable';
import EmptyState from '../components/EmptyState';
import MetricCard from '../components/MetricCard';
import StatusBadge from '../components/StatusBadge';
import { buildActionCenterItems, getActionCenterSummary, getPriorityIcon } from '../utils/actionCenter';
import { canManagePayroll, canUsePayroll } from '../utils/access';
import { getBusinessProfile, isAllBusinessesUnit } from '../utils/businessProfiles';
import { getLatestShopStatus } from '../utils/dailyOperations';
import {
  formatCompactCurrency,
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercent,
} from '../utils/formatters';
import { buildOperationalChecks } from '../utils/operations';
import { buildRoleWorkspace } from '../utils/workspaces';

const OPERATION_ICONS = {
  danger: AlertCircle,
  muted: Clock3,
  success: CheckCircle2,
  warning: AlertTriangle,
};

const MOBILE_BREAKPOINT = '(max-width: 900px)';

function formatBestPostingWindows(hourMap) {
  const entries = Object.entries(hourMap || {}).map(([hour, count]) => [Number(hour), Number(count) || 0]);
  if (!entries.length) return 'Not enough data yet';
  const max = Math.max(...entries.map(([, count]) => count));
  if (max <= 0) return 'Not enough data yet';
  const threshold = max * 0.85;
  const topHours = entries.filter(([, count]) => count >= threshold).map(([hour]) => hour).sort((a, b) => a - b);
  const formatHour = (hour) => {
    const period = hour >= 12 ? 'PM' : 'AM';
    const display = hour % 12 === 0 ? 12 : hour % 12;
    return `${display} ${period}`;
  };
  if (topHours.length === 1) return formatHour(topHours[0]);
  if (topHours.length === 24) return 'All day';
  const n = topHours.length;
  const gaps = topHours.map((hour, i) => {
    const next = topHours[(i + 1) % n];
    return ((next - hour + 24) % 24) || 24;
  });
  const breakIndices = gaps.map((gap, i) => (gap > 1 ? i : -1)).filter((i) => i !== -1);
  const seams = breakIndices.length ? breakIndices : [gaps.indexOf(Math.max(...gaps))];
  const blocks = seams.map((seamIndex, i) => {
    const nextSeamIndex = seams[(i + 1) % seams.length];
    const start = topHours[(seamIndex + 1) % n];
    const end = topHours[nextSeamIndex];
    return { start, end };
  });
  const formatBlock = (block) =>
    block.start === block.end ? formatHour(block.start) : `${formatHour(block.start)}-${formatHour((block.end + 1) % 24)}`;
  return blocks.slice(0, 2).sort((a, b) => a.start - b.start).map(formatBlock).join(' and ');
}

function getNumber(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && value !== '') {
      const number = Number(value);
      if (Number.isFinite(number)) return number;
    }
  }
  return 0;
}

function readSectionFromUrl() {
  if (typeof window === 'undefined') return 'overview';
  return new URLSearchParams(window.location.search).get('section') || 'overview';
}

function panelAccessibility(section, suffix = section) {
  return {
    'aria-labelledby': `dashboard-tab-${section}`,
    'data-mobile-group': section,
    id: `dashboard-panel-${suffix}`,
    role: 'tabpanel',
  };
}

export default function DashboardPage({
  accessProfile,
  actionCenter,
  businessUnit,
  businessUnits,
  instagramInsights,
  masterDashboard,
  masterDashboardUpdatedAt,
  navItems,
  payrollRuns,
  performanceSummary,
  navigateTo,
  setActivePage,
  squareStatus,
  staff,
  staffHub,
}) {
  const payrollAllowed = canUsePayroll(accessProfile);
  const payrollEditable = canManagePayroll(accessProfile);
  const allBusinessesView = isAllBusinessesUnit(businessUnit);
  const shopStatusByBusiness = (businessUnits || []).map((unit) => ({
    id: unit.id,
    name: unit.name,
    status: getLatestShopStatus((staffHub?.shopStatusEvents || []).filter((event) => event.business_unit_id === unit.id)),
  }));
  const canStartPayroll = payrollEditable && !allBusinessesView;
  const businessProfile = getBusinessProfile(businessUnit);
  const activeStaff = staff.filter((member) => member.active);
  const fixedRateStaff = activeStaff.filter((member) => member.fixed_rate);
  const autoAdjustEligible = activeStaff.filter((member) => !member.fixed_rate && member.tier !== 'probation');
  const latestRun = payrollRuns[0];
  const performanceTotal = performanceSummary.reduce((total, row) => total + Number(row.total_net_sales || 0), 0);
  const topPerformers = performanceSummary.filter((row) => !row.exclude_from_leaderboard).slice(0, 5);
  const isBeautyLounge = businessUnit?.name === 'RTB Beauty Lounge';
  const booksySummary = businessUnit?.name === 'RTB Lounge' ? masterDashboard?.summary : null;
  const squareSummary = isBeautyLounge ? masterDashboard?.summary : null;
  const appointmentSummary = booksySummary || squareSummary;
  const appointmentMetrics = useMemo(() => ({
    bookings: getNumber(appointmentSummary, ['totalBookings', 'bookingCount', 'appointments', 'totalAppointments', 'transactions']),
    revenue: getNumber(appointmentSummary, ['ytdRevenue', 'totalRevenue', 'appointmentRevenue', 'revenue', 'netSales']),
    clients: getNumber(appointmentSummary, ['clientCount', 'uniqueClients', 'clients', 'customerCount', 'customers']),
    noShows: getNumber(appointmentSummary, ['noShows', 'noShowCount', 'missedAppointments', 'no_show_count']),
  }), [appointmentSummary]);
  const hasAppointmentData = Boolean(appointmentSummary && Object.keys(appointmentSummary).length);
  const hasTeamData = activeStaff.length > 0 || performanceSummary.length > 0;
  const operationalChecks = buildOperationalChecks({
    activeStaffCount: activeStaff.length,
    appointmentUpdatedAt: masterDashboard ? masterDashboardUpdatedAt || masterDashboard.updatedAt : null,
    businessUnitName: businessUnit?.name,
    latestRun,
    payrollAllowed,
    squareStatus,
  });
  const actionItems = buildActionCenterItems({
    accessProfile,
    actionCenter,
    businessUnitId: allBusinessesView ? null : businessUnit?.id,
    contentSubmissions: staffHub?.contentSubmissions || [],
    payrollRuns,
    staff,
    tasks: staffHub?.tasks || [],
    timeOffRequests: staffHub?.timeOffRequests || [],
  });
  const actionSummary = getActionCenterSummary(actionItems);
  const topActions = actionItems.slice(0, 3);
  const workspace = buildRoleWorkspace(accessProfile, navItems, businessUnit);
  const tabListRef = useRef(null);
  const [mobileTab, setMobileTab] = useState(readSectionFromUrl);

  const mobileTabs = useMemo(() => {
    const tabs = [{ id: 'overview', label: 'Overview' }];
    if (actionSummary.total > 0) tabs.push({ id: 'actions', label: 'Actions', count: actionSummary.total });
    if (hasAppointmentData) tabs.push({ id: 'appointments', label: 'Appointments' });
    if (hasTeamData) tabs.push({ id: 'team', label: 'Team' });
    if (payrollAllowed) tabs.push({ id: 'finance', label: 'Finance' });
    return tabs;
  }, [actionSummary.total, hasAppointmentData, hasTeamData, payrollAllowed]);

  const tabControlIds = useMemo(() => ({
    overview: [
      'dashboard-panel-overview-workspace',
      'dashboard-panel-overview-priority',
      'dashboard-panel-overview-metrics',
      ...(instagramInsights ? ['dashboard-panel-overview-marketing'] : []),
      'dashboard-panel-overview-profile',
      'dashboard-panel-overview-checks',
      'dashboard-panel-overview-checklists',
    ],
    actions: ['dashboard-panel-actions'],
    appointments: ['dashboard-panel-appointments'],
    team: ['dashboard-panel-team-performance', 'dashboard-panel-team-roster'],
    finance: ['dashboard-panel-finance'],
  }), [instagramInsights]);

  const availableTabIds = useMemo(() => new Set(mobileTabs.map((tab) => tab.id)), [mobileTabs]);
  const mobileGroupClass = (id) => (mobileTab === id ? 'is-active-mobile-tab' : '');

  useEffect(() => {
    if (availableTabIds.has(mobileTab)) return;
    setMobileTab('overview');
    const url = new URL(window.location.href);
    url.searchParams.set('section', 'overview');
    window.history.replaceState(window.history.state, '', url);
  }, [availableTabIds, mobileTab]);

  useEffect(() => {
    function handlePopState() {
      const requested = readSectionFromUrl();
      setMobileTab(availableTabIds.has(requested) ? requested : 'overview');
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [availableTabIds]);

  function selectMobileTab(id, { historyMode = 'push', focus = false } = {}) {
    if (!availableTabIds.has(id)) return;
    setMobileTab(id);
    const url = new URL(window.location.href);
    url.searchParams.set('section', id);
    if (historyMode === 'replace') window.history.replaceState(window.history.state, '', url);
    else window.history.pushState({ ...window.history.state, dashboardSection: id }, '', url);
    if (window.matchMedia(MOBILE_BREAKPOINT).matches) {
      window.requestAnimationFrame(() => {
        tabListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        if (focus) document.getElementById(`dashboard-tab-${id}`)?.focus();
      });
    }
  }

  function handleTabKeyDown(event, currentIndex) {
    let nextIndex = null;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % mobileTabs.length;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + mobileTabs.length) % mobileTabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = mobileTabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    selectMobileTab(mobileTabs[nextIndex].id, { focus: true });
  }

  return (
    <div className="page-grid dashboard-page">
      <section className="hero-panel dashboard-hero">
        <div className="hero-brand-lockup">
          <div className="hero-brand-logo"><img src={businessProfile.logo_url} alt="" /></div>
          <div>
            <span className="eyebrow">{allBusinessesView ? 'Combined view' : businessProfile.business_type}</span>
            <h2>{businessUnit?.name || 'RTB OS'}</h2>
            <p>{allBusinessesView ? 'Reports and rankings from both businesses.' : `${businessProfile.booking_platform || 'Appointments'} and ${businessProfile.pos_platform || 'POS'} operations.`}</p>
          </div>
        </div>
        {canStartPayroll ? <button className="primary-button" type="button" onClick={() => setActivePage('payroll')}>New payroll run</button> : null}
      </section>

      {shopStatusByBusiness.length ? (
        <section className="panel full-span dashboard-shop-status-strip">
          {shopStatusByBusiness.map((business) => (
            <div className="dashboard-shop-status-item" key={business.id}>
              <Store size={18} />
              <div><span>{business.name}</span><strong>{business.status.label}</strong></div>
              <StatusBadge tone={business.status.status === 'open' ? 'success' : 'gold'}>{business.status.status}</StatusBadge>
            </div>
          ))}
        </section>
      ) : null}

      <nav aria-label="Dashboard sections" className="dashboard-mobile-tabs" data-managed="react" ref={tabListRef} role="tablist">
        {mobileTabs.map((tab, index) => (
          <button
            aria-controls={(tabControlIds[tab.id] || []).join(' ')}
            aria-selected={mobileTab === tab.id}
            className={`dashboard-mobile-tabs__item ${mobileTab === tab.id ? 'active' : ''}`}
            id={`dashboard-tab-${tab.id}`}
            key={tab.id}
            onClick={() => selectMobileTab(tab.id)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
            role="tab"
            tabIndex={mobileTab === tab.id ? 0 : -1}
            type="button"
          >
            <span>{tab.label}</span>
            {tab.count ? <span className="mobile-nav-count" aria-label={`${tab.count} open items`}>{tab.count}</span> : null}
          </button>
        ))}
      </nav>

      <section {...panelAccessibility('overview', 'overview-workspace')} className={`panel full-span workspace-panel ${mobileGroupClass('overview')}`}>
        <div className="section-header"><div><span>{workspace.roleTitle}</span><h2>Quick actions</h2></div><StatusBadge tone={workspace.editableModules.length ? 'gold' : 'muted'}>{workspace.editableModules.length ? `${workspace.editableModules.length} edit areas` : 'View only'}</StatusBadge></div>
        <div className="workspace-grid">
          <div className="workspace-card"><span>Open</span><div className="workspace-actions">{workspace.focusPages.map((page) => <button className="secondary-button small" key={page.id} type="button" onClick={() => setActivePage(page.id)}>{page.label}</button>)}</div></div>
          <div className="workspace-card"><span>Status</span><div className="workspace-status-pills">{workspace.onboarding.map((item) => <div className={item.complete ? 'complete' : 'open'} key={item.label} title={item.detail}><CheckCircle2 size={16} /><strong>{item.label}</strong></div>)}</div></div>
          <div className="workspace-card"><span>Role</span>{workspace.responsibilities.length ? <ul className="compact-list workspace-mini-list">{workspace.responsibilities.slice(0, 3).map((item) => <li key={item}>{item}</li>)}</ul> : <p className="subtle-text">No role notes yet.</p>}</div>
        </div>
      </section>

      <section {...panelAccessibility('overview', 'overview-priority')} className={`panel full-span priority-board ${mobileGroupClass('overview')}`}>
        <div className="section-header"><div><span>Priority board</span><h2>What needs attention right now</h2></div><StatusBadge tone={actionSummary.total ? 'warning' : 'success'}>{actionSummary.total ? `${actionSummary.total} open` : 'Everything clear'}</StatusBadge></div>
        <div className="priority-board__layout">
          <div className="priority-board__summary">
            <div className="priority-board__stats"><div className="priority-board__stat"><strong>{actionSummary.total}</strong><span>open actions</span></div><div className="priority-board__stat"><strong>{actionSummary.urgent}</strong><span>urgent / high</span></div></div>
            <p>RTB OS highlights the work that needs follow-up first so you can act quickly instead of hunting through reports.</p>
            {actionSummary.total ? <button className="primary-button" type="button" onClick={() => selectMobileTab('actions')}>Review open actions</button> : null}
          </div>
          <div className="priority-board__list">{topActions.length ? topActions.map((item) => { const Icon = getPriorityIcon(item.category); return <button className={`priority-board__item ${item.priority}`} key={item.id} onClick={() => (navigateTo ? navigateTo(item.page, item.pageTarget) : setActivePage(item.page))} type="button"><div className="priority-board__item-icon"><Icon size={18} /></div><span><strong>{item.title}</strong><small>{item.detail}</small></span></button>; }) : <div className="empty-state compact"><h3>No urgent priorities</h3><p>This view looks clear right now.</p></div>}</div>
        </div>
      </section>

      <section {...panelAccessibility('overview', 'overview-metrics')} className={`metrics-grid stat-strip ${mobileGroupClass('overview')}`}>
        <MetricCard icon={Users} label="Active staff" trend={`${fixedRateStaff.length} fixed-rate`} value={activeStaff.length} />
        <MetricCard icon={CircleDollarSign} label={payrollAllowed ? 'Latest payroll' : 'Appointment revenue'} trend={payrollAllowed ? latestRun?.week_label || 'No runs yet' : appointmentSummary?.periodLabel || 'Import appointment data'} value={payrollAllowed ? (latestRun ? formatCompactCurrency(latestRun.total_net_sales) : '$0') : formatCompactCurrency(appointmentMetrics.revenue)} />
        <MetricCard icon={TrendingUp} label="Recorded sales" trend={`${performanceSummary.length} staff profiles`} value={formatCompactCurrency(performanceTotal)} />
      </section>

      {instagramInsights ? <section {...panelAccessibility('overview', 'overview-marketing')} className={`panel full-span ${mobileGroupClass('overview')}`}><div className="section-header"><div><span>Marketing</span><h2>Instagram performance</h2></div><StatusBadge tone="muted">Synced {new Date(instagramInsights.synced_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}</StatusBadge></div><div className="workspace-grid"><div className="workspace-card"><span>Best times to post</span><strong>{formatBestPostingWindows(instagramInsights.online_followers_by_hour)}</strong><small>Based on when your followers are actually online</small></div><div className="workspace-card"><span>Followers</span><strong>{instagramInsights.followers_count ?? '—'}</strong></div><div className="workspace-card"><span>Reach, last 7 days</span><strong>{instagramInsights.reach_7d ?? '—'}</strong></div><div className="workspace-card"><span>Avg. engagement rate</span><strong>{instagramInsights.avg_engagement_rate != null ? `${instagramInsights.avg_engagement_rate}%` : '—'}</strong></div></div></section> : null}

      <section {...panelAccessibility('overview', 'overview-profile')} className={`panel full-span ${mobileGroupClass('overview')}`}><div className="section-header"><div><span>Setup</span><h2>Business profile</h2></div></div><div className="snapshot-grid"><div><CalendarDays size={18} /><span>Booking</span><strong>{businessProfile.booking_platform || 'Manual'}</strong></div><div><CircleDollarSign size={18} /><span>POS</span><strong>{businessProfile.pos_platform || 'Square'}</strong></div><div><Users size={18} /><span>Instagram</span><strong>{businessProfile.instagram_format || 'Manual'}</strong></div></div></section>

      <section {...panelAccessibility('overview', 'overview-checks')} className={`panel full-span ${mobileGroupClass('overview')}`}><div className="section-header"><div><span>Operations</span><h2>Checks</h2></div></div><div className="operations-grid">{operationalChecks.map((check) => { const Icon = OPERATION_ICONS[check.tone] || Clock3; return <button className={`operation-check ${check.tone}`} key={check.label} onClick={() => setActivePage(check.action)} type="button"><Icon size={18} /><span><strong>{check.label}</strong><small>{check.detail}</small></span></button>; })}</div></section>

      <div {...panelAccessibility('overview', 'overview-checklists')} className={mobileGroupClass('overview')}><AdminChecklistDashboard businessUnitId={allBusinessesView ? null : businessUnit?.id} /></div>

      <section {...panelAccessibility('actions', 'actions')} className={`panel full-span action-center-snapshot ${mobileGroupClass('actions')}`}><div className="section-header"><div><span>Action Center</span><h2>Attention</h2></div><button className="ghost-button" type="button" onClick={() => setActivePage('action-center')}><BellRing size={16} />Open Action Center</button></div>{topActions.length ? <div className="dashboard-action-list">{topActions.map((item) => { const Icon = getPriorityIcon(item.category); return <button className={`dashboard-action-item ${item.priority}`} key={item.id} type="button" onClick={() => setActivePage(item.page)}><Icon size={18} /><span><strong>{item.title}</strong><small>{item.detail}</small></span></button>; })}</div> : <div className="empty-state compact"><h3>No open actions</h3><p>Action Center is clear for this view.</p></div>}<div className="action-center-snapshot__footer"><StatusBadge tone={actionSummary.urgent ? 'warning' : actionSummary.total ? 'gold' : 'success'}>{actionSummary.total ? `${actionSummary.total} open actions` : 'Clear'}</StatusBadge><span>{actionSummary.automatic} automatic / {actionSummary.manual} manual</span></div></section>

      {hasAppointmentData ? <section {...panelAccessibility('appointments', 'appointments')} className={`panel full-span dashboard-appointments ${mobileGroupClass('appointments')}`}><div className="section-header"><div><span>Appointments</span><h2>Booking activity</h2></div>{appointmentSummary?.periodLabel ? <StatusBadge tone="muted">{appointmentSummary.periodLabel}</StatusBadge> : null}</div><div className="metrics-grid dashboard-appointment-metrics"><MetricCard icon={CalendarDays} label="Bookings" trend="Appointment records" value={formatNumber(appointmentMetrics.bookings)} /><MetricCard icon={CircleDollarSign} label="Revenue" trend="Appointment revenue" value={formatCompactCurrency(appointmentMetrics.revenue)} /><MetricCard icon={Users} label="Clients" trend="Unique / recorded clients" value={formatNumber(appointmentMetrics.clients)} /><MetricCard icon={AlertCircle} label="No-shows" trend="Missed appointments" value={formatNumber(appointmentMetrics.noShows)} /></div></section> : null}

      <section {...panelAccessibility('team', 'team-performance')} className={`panel ${mobileGroupClass('team')}`}><div className="section-header"><div><span>Performance</span><h2>Leaderboard</h2></div></div>{topPerformers.length ? <DataTable><table className="leaderboard-table"><thead><tr><th>#</th><th>Staff</th><th>Role</th><th>Net sales</th></tr></thead><tbody>{topPerformers.map((row, index) => <tr key={row.staff_id || row.full_name}><td>{index + 1}</td><td>{row.full_name}</td><td>{row.role || 'Staff'}</td><td>{formatCompactCurrency(row.total_net_sales)}</td></tr>)}</tbody></table></DataTable> : <EmptyState icon={TrendingUp} title="No performance history" message="Performance history will appear here when records exist." />}</section>

      <section {...panelAccessibility('team', 'team-roster')} className={`panel ${mobileGroupClass('team')}`}><div className="section-header"><div><span>Roster</span><h2>Commission profile</h2></div></div><div className="stat-list"><div><span>Active staff</span><strong>{activeStaff.length}</strong></div><div><span>Average commission</span><strong>{activeStaff.length ? formatPercent(activeStaff.reduce((total, member) => total + Number(member.commission_rate || 0), 0) / activeStaff.length) : '0%'}</strong></div><div><span>Auto-adjust eligible</span><strong>{autoAdjustEligible.length}</strong></div><div><span>Inactive profiles</span><strong>{staff.filter((member) => !member.active).length}</strong></div></div></section>

      {payrollAllowed ? <section {...panelAccessibility('finance', 'finance')} className={`panel two-thirds ${mobileGroupClass('finance')}`}><div className="section-header"><div><span>Finance</span><h2>Recent payroll runs</h2></div><button className="ghost-button" type="button" onClick={() => setActivePage('payroll')}>Open payroll</button></div>{payrollRuns.length ? <DataTable><table><thead><tr><th>Week</th><th>Status</th><th>Net sales</th><th>Staff payout</th><th>RTB net</th><th>Created</th></tr></thead><tbody>{payrollRuns.slice(0, 6).map((run) => <tr key={run.id}><td>{run.week_label}</td><td><StatusBadge tone={run.status === 'locked' ? 'success' : 'warning'}>{run.status}</StatusBadge></td><td>{formatCurrency(run.total_net_sales)}</td><td>{formatCurrency(run.total_staff_payout)}</td><td>{formatCurrency(run.rtb_net)}</td><td>{formatDate(run.created_at)}</td></tr>)}</tbody></table></DataTable> : <EmptyState icon={BadgeDollarSign} title="No payroll runs" message="Draft the first run for this business unit." action={<button className="ghost-button" type="button" onClick={() => setActivePage('payroll')}>Start payroll</button>} />}</section> : null}
    </div>
  );
}
