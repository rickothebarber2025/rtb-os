import { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  Scissors,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react';
import DataTable from '../components/DataTable';
import EmptyState from '../components/EmptyState';
import MetricCard from '../components/MetricCard';
import { saveAppSetting, startSquareConnection, syncSquareAppointments } from '../services/rtbService';
import { parseBooksyReport } from '../utils/booksyReport';
import {
  formatCompactCurrency,
  formatCurrency,
  formatNumber,
} from '../utils/formatters';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'staff', label: 'Staff' },
  { id: 'services', label: 'Services' },
  { id: 'clients', label: 'Clients' },
  { id: 'schedule', label: 'Schedule' },
];

function getRows(rows) {
  return Array.isArray(rows) ? rows : [];
}

function getMax(rows, key) {
  return Math.max(...getRows(rows).map((row) => Number(row[key] || 0)), 1);
}

function BarRow({ color = 'var(--gold)', label, max, meta, value }) {
  const percent = Math.min(100, (Number(value || 0) / Math.max(Number(max || 0), 1)) * 100);

  return (
    <div className="insight-bar-row">
      <span>{label}</span>
      <div className="bar-track" aria-hidden="true">
        <div className="bar-fill" style={{ background: color, width: `${percent}%` }} />
      </div>
      <strong>{meta}</strong>
    </div>
  );
}

function InsightTabs({ activeTab, setActiveTab }) {
  return (
    <div className="insight-tabs" role="tablist" aria-label="Appointment insights views">
      {TABS.map((tab) => (
        <button
          className={activeTab === tab.id ? 'active' : ''}
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          role="tab"
          type="button"
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function getAppointmentSource(businessUnit) {
  if (businessUnit?.name === 'RTB Beauty Lounge') {
    return {
      dataLabel: 'Square Appointments data',
      emptyMessage:
        'RTB Beauty Lounge uses Square Appointments. Import Square Appointments data to fill this page.',
      emptyTitle: 'Square Appointments data not loaded yet',
      name: 'Square Appointments',
      unit: 'RTB Beauty Lounge',
    };
  }

  return {
    dataLabel: 'Booksy data',
    emptyMessage: 'RTB Lounge uses Booksy. Import the Booksy master dashboard data to fill this page.',
    emptyTitle: 'No Booksy insights loaded',
    name: 'Booksy',
    unit: 'RTB Lounge',
  };
}

function OverviewTab({ data, setActiveTab, sourceName }) {
  const months = getRows(data.monthlyRevenue);
  const staff = getRows(data.staff);
  const services = getRows(data.services);
  const segments = getRows(data.clientSegments);
  const summary = data.summary || {};
  const maxMonthlyRevenue = getMax(months, 'revenue');
  const maxStaffRevenue = getMax(staff, 'revenue');
  const maxServiceRevenue = getMax(services, 'revenue');
  const maxSegmentCount = getMax(segments, 'count');

  return (
    <>
      <section className="insight-alert full-span">
        <AlertTriangle size={20} />
        <div>
          {summary.reportMode === 'booksy_file_import' ? (
            <>
              <strong>Booksy report imported</strong>
              <span>
                This view is built from the latest CSV or TSV report uploaded into RTB OS.
              </span>
            </>
          ) : sourceName === 'Square Appointments' ? (
            <>
              <strong>Square Appointments sync is active</strong>
              <span>
                Square booking data is pulled server-side and saved into RTB OS for RTB Beauty
                Lounge.
              </span>
            </>
          ) : (
            <>
              <strong>{formatNumber(summary.slippingAwayClients)} clients are slipping away</strong>
              <span>
                A reactivation campaign against the inactive client list is the biggest near-term
                revenue opportunity in this data set.
              </span>
            </>
          )}
        </div>
      </section>

      <section className="metrics-grid full-span">
        <MetricCard
          icon={TrendingUp}
          label="YTD revenue"
          trend={summary.periodLabel || 'Current period'}
          value={formatCompactCurrency(summary.ytdRevenue)}
        />
        <MetricCard
          icon={Scissors}
          label="Completed appts"
          trend="2026 bookings"
          value={formatNumber(summary.completedAppointments)}
        />
        <MetricCard
          icon={Users}
          label="All-time clients"
          trend={`${formatNumber(summary.allTimeBookings)} bookings`}
          value={formatNumber(summary.allTimeClients)}
        />
        <MetricCard
          icon={TrendingDown}
          label="No-shows"
          trend="Across client base"
          value={formatNumber(summary.noShows)}
        />
      </section>

      <section className="panel two-thirds">
        <div className="section-header">
          <div>
            <span>Revenue</span>
            <h2>Monthly revenue</h2>
          </div>
          <strong className="section-kpi">{formatCurrency(summary.ytdRevenue)}</strong>
        </div>
        <div className="month-chart">
          {months.map((month) => {
            const height = Math.max(8, (Number(month.revenue || 0) / maxMonthlyRevenue) * 100);

            return (
              <div className="month-chart__item" key={month.month}>
                <span>{formatCompactCurrency(month.revenue)}</span>
                <div className="month-chart__track">
                  <div
                    className={month.partial ? 'month-chart__bar partial' : 'month-chart__bar'}
                    style={{ height: `${height}%` }}
                  />
                </div>
                <strong>{month.month}</strong>
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <div className="section-header">
          <div>
            <span>Clients</span>
            <h2>New vs returning</h2>
          </div>
        </div>
        <div className="split-meter">
          <div style={{ width: `${Number(summary.newRevenueShare || 0)}%` }} />
          <div style={{ width: `${Number(summary.returningRevenueShare || 0)}%` }} />
        </div>
        <div className="split-stats">
          <div>
            <span>New clients</span>
            <strong>{formatNumber(summary.newClients)}</strong>
            <small>{summary.newRevenueShare}% of revenue</small>
          </div>
          <div>
            <span>Returning</span>
            <strong>{formatNumber(summary.returningClients)}</strong>
            <small>{summary.returningRevenueShare}% of revenue</small>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="section-header">
          <div>
            <span>Staff</span>
            <h2>Revenue by barber</h2>
          </div>
          <button className="ghost-button small" type="button" onClick={() => setActiveTab('staff')}>
            Open
          </button>
        </div>
        <div className="insight-list">
          {staff.slice(0, 5).map((member) => (
            <BarRow
              color={member.color}
              key={member.name}
              label={member.name}
              max={maxStaffRevenue}
              meta={formatCompactCurrency(member.revenue)}
              value={member.revenue}
            />
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="section-header">
          <div>
            <span>Services</span>
            <h2>Top services</h2>
          </div>
          <button
            className="ghost-button small"
            type="button"
            onClick={() => setActiveTab('services')}
          >
            Open
          </button>
        </div>
        <div className="insight-list">
          {services.slice(0, 5).map((service) => (
            <BarRow
              color="var(--green)"
              key={service.name}
              label={service.name}
              max={maxServiceRevenue}
              meta={formatCompactCurrency(service.revenue)}
              value={service.revenue}
            />
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="section-header">
          <div>
            <span>Segments</span>
            <h2>Client segments</h2>
          </div>
          <button className="ghost-button small" type="button" onClick={() => setActiveTab('clients')}>
            Open
          </button>
        </div>
        <div className="insight-list">
          {segments.map((segment) => (
            <BarRow
              color={segment.color}
              key={segment.label}
              label={segment.label}
              max={maxSegmentCount}
              meta={formatNumber(segment.count)}
              value={segment.count}
            />
          ))}
        </div>
      </section>
    </>
  );
}

function StaffTab({ data }) {
  const [sort, setSort] = useState('revenue');
  const staff = useMemo(
    () => [...getRows(data.staff)].sort((a, b) => Number(b[sort] || 0) - Number(a[sort] || 0)),
    [data.staff, sort],
  );
  const maxRevenue = getMax(staff, 'revenue');

  return (
    <section className="panel full-span">
      <div className="section-header">
        <div>
          <span>Booksy staff data</span>
          <h2>Staff revenue and occupancy</h2>
        </div>
        <div className="toolbar inline">
          {[
            ['revenue', 'Revenue'],
            ['appointments', 'Appointments'],
            ['occupancy', 'Occupancy'],
          ].map(([key, label]) => (
            <button
              className={sort === key ? 'active' : ''}
              key={key}
              onClick={() => setSort(key)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="staff-insight-grid">
        {staff.map((member) => (
          <article className="staff-insight-card" key={member.name}>
            <div>
              <strong>{member.name}</strong>
              <span>
                {formatNumber(member.appointments)} appts total, {formatNumber(member.mayAppointments)} in May
              </span>
            </div>
            <b>{formatCurrency(member.revenue)}</b>
            <BarRow
              color={member.color}
              label="Revenue"
              max={maxRevenue}
              meta={`${Math.round((Number(member.revenue || 0) / Number(data.summary?.ytdRevenue || 1)) * 100)}%`}
              value={member.revenue}
            />
            <div className="mini-stats">
              <span>Occupancy <strong>{member.occupancy ? `${member.occupancy}%` : 'Not tracked'}</strong></span>
              <span>Visit time <strong>{member.visitTime || 'Not tracked'}</strong></span>
              <span>Work hours <strong>{member.workHours || 'Not tracked'}</strong></span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ServicesTab({ data }) {
  const [sort, setSort] = useState('revenue');
  const services = useMemo(
    () =>
      [...getRows(data.services)].sort(
        (a, b) => Number(b[sort] || 0) - Number(a[sort] || 0),
      ),
    [data.services, sort],
  );

  return (
    <section className="panel full-span">
      <div className="section-header">
        <div>
          <span>Service mix</span>
          <h2>Revenue, volume, and cancellation risk</h2>
        </div>
        <div className="toolbar inline">
          {[
            ['revenue', 'Revenue'],
            ['count', 'Volume'],
            ['cancelRate', 'Cancel rate'],
          ].map(([key, label]) => (
            <button
              className={sort === key ? 'active' : ''}
              key={key}
              onClick={() => setSort(key)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <DataTable>
        <table>
          <thead>
            <tr>
              <th>Service</th>
              <th>Revenue</th>
              <th>Appts</th>
              <th>Cancelled</th>
              <th>Cancel rate</th>
            </tr>
          </thead>
          <tbody>
            {services.map((service) => (
              <tr key={service.name}>
                <td>
                  <div className="person-cell">
                    <strong>{service.name}</strong>
                    <span>{service.fullName}</span>
                  </div>
                </td>
                <td>{formatCurrency(service.revenue)}</td>
                <td>{formatNumber(service.count)}</td>
                <td>{formatNumber(service.cancelled)}</td>
                <td>
                  <strong
                    className={
                      Number(service.cancelRate || 0) >= 30 ? 'danger-text' : 'success-text'
                    }
                  >
                    {service.cancelRate}%
                  </strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataTable>
    </section>
  );
}

function ClientsTab({ data }) {
  const segments = getRows(data.clientSegments);
  const topClients = getRows(data.topClients);
  const summary = data.summary || {};
  const maxSegmentCount = getMax(segments, 'count');

  return (
    <>
      <section className="metrics-grid full-span">
        <MetricCard
          icon={Users}
          label="Total clients"
          trend="Since 2019"
          value={formatNumber(summary.allTimeClients)}
        />
        <MetricCard
          icon={AlertTriangle}
          label="Slipping away"
          trend="Inactive clients"
          value={formatNumber(summary.slippingAwayClients)}
        />
        <MetricCard
          icon={TrendingUp}
          label="Returning"
          trend="Active loyal base"
          value={formatNumber(summary.returningBase)}
        />
        <MetricCard
          icon={TrendingDown}
          label="No-shows"
          trend="All-time"
          value={formatNumber(summary.noShows)}
        />
      </section>

      <section className="panel">
        <div className="section-header">
          <div>
            <span>Clients</span>
            <h2>Segment mix</h2>
          </div>
        </div>
        <div className="insight-list">
          {segments.map((segment) => (
            <BarRow
              color={segment.color}
              key={segment.label}
              label={segment.label}
              max={maxSegmentCount}
              meta={`${formatNumber(segment.count)} clients`}
              value={segment.count}
            />
          ))}
        </div>
      </section>

      <section className="panel two-thirds">
        <div className="section-header">
          <div>
            <span>Top clients</span>
            <h2>All-time value</h2>
          </div>
        </div>
        <DataTable>
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Bookings</th>
                <th>No-shows</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {topClients.map((client) => (
                <tr key={client.name}>
                  <td>{client.name}</td>
                  <td>{formatNumber(client.bookings)}</td>
                  <td>{formatNumber(client.noShows)}</td>
                  <td>{formatCurrency(client.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTable>
      </section>
    </>
  );
}

function ScheduleTab({ data }) {
  const [view, setView] = useState('upcoming');
  const rows =
    view === 'upcoming'
      ? getRows(data.upcomingAppointments)
      : getRows(data.recentTransactions);
  const total = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);

  return (
    <>
      <section className="metrics-grid full-span">
        <MetricCard
          icon={CalendarDays}
          label={view === 'upcoming' ? 'Forecasted' : 'Day total'}
          trend={view === 'upcoming' ? 'Pre-booked only' : 'Recent transactions'}
          value={formatCurrency(total)}
        />
        <MetricCard
          icon={Scissors}
          label="Appointments"
          trend={view === 'upcoming' ? 'Upcoming list' : 'Recent list'}
          value={formatNumber(rows.length)}
        />
      </section>

      <section className="panel full-span">
        <div className="section-header">
          <div>
            <span>Appointments</span>
            <h2>{view === 'upcoming' ? 'Upcoming schedule' : 'Recent transactions'}</h2>
          </div>
          <div className="toolbar inline">
            {[
              ['upcoming', 'Upcoming'],
              ['recent', 'Recent'],
            ].map(([key, label]) => (
              <button
                className={view === key ? 'active' : ''}
                key={key}
                onClick={() => setView(key)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <DataTable>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Client</th>
                <th>Service</th>
                <th>Staff</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.date}-${row.client}-${index}`}>
                  <td>{row.date}</td>
                  <td>{row.client}</td>
                  <td>{row.service}</td>
                  <td>{row.staffer}</td>
                  <td>{row.amount ? formatCurrency(row.amount) : 'Free'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTable>
      </section>
    </>
  );
}

export default function BooksyInsightsPage({ businessUnit, masterDashboard, onRefresh }) {
  const [activeTab, setActiveTab] = useState('overview');
  const [actionError, setActionError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [actionLoading, setActionLoading] = useState('');
  const booksyInputRef = useRef(null);
  const source = getAppointmentSource(businessUnit);
  const hasData = Boolean(masterDashboard);

  async function handleSquareConnect() {
    setActionError('');
    setActionMessage('');
    setActionLoading('connect');

    try {
      const result = await startSquareConnection(businessUnit.id);
      window.location.assign(result.authorizationUrl);
    } catch (err) {
      setActionError(err.message || 'Square connection could not start.');
      setActionLoading('');
    }
  }

  async function handleSquareSync() {
    setActionError('');
    setActionMessage('');
    setActionLoading('sync');

    try {
      const result = await syncSquareAppointments(businessUnit.id);
      setActionMessage(`Square synced ${formatNumber(result.bookingsSynced)} bookings.`);
      await onRefresh?.();
    } catch (err) {
      setActionError(err.message || 'Square sync failed.');
    } finally {
      setActionLoading('');
    }
  }

  async function handleBooksyImport(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setActionError('');
    setActionMessage('');
    setActionLoading('booksy');

    try {
      const text = await file.text();
      const dashboard = parseBooksyReport(text, file.name);
      await saveAppSetting('rtb_master_dashboard', dashboard);
      setActionMessage(`Booksy imported ${formatNumber(dashboard.summary.allTimeBookings)} rows.`);
      setActiveTab('overview');
      await onRefresh?.();
    } catch (err) {
      setActionError(err.message || 'Booksy import failed.');
    } finally {
      setActionLoading('');
      event.target.value = '';
    }
  }

  const booksyActions =
    source.name === 'Booksy' ? (
      <div className="stack">
        {actionError ? <div className="alert danger">{actionError}</div> : null}
        {actionMessage ? <div className="alert success">{actionMessage}</div> : null}
        <input
          ref={booksyInputRef}
          className="sr-only"
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
          onChange={handleBooksyImport}
        />
        <div className="action-row">
          <button
            className="primary-button"
            disabled={Boolean(actionLoading)}
            type="button"
            onClick={() => booksyInputRef.current?.click()}
          >
            {actionLoading === 'booksy' ? 'Importing...' : 'Import Booksy Report'}
          </button>
          <span className="subtle-text">CSV or TSV export</span>
        </div>
      </div>
    ) : null;

  if (!hasData) {
    const squareActions =
      source.name === 'Square Appointments' && businessUnit?.id ? (
        <div className="stack">
          {actionError ? <div className="alert danger">{actionError}</div> : null}
          {actionMessage ? <div className="alert success">{actionMessage}</div> : null}
          <div className="action-row">
            <button
              className="primary-button"
              disabled={Boolean(actionLoading)}
              type="button"
              onClick={handleSquareConnect}
            >
              {actionLoading === 'connect' ? 'Opening Square...' : 'Connect Square'}
            </button>
            <button
              className="secondary-button"
              disabled={Boolean(actionLoading)}
              type="button"
              onClick={handleSquareSync}
            >
              {actionLoading === 'sync' ? 'Syncing...' : 'Sync Square'}
            </button>
          </div>
        </div>
      ) : null;

    return (
      <div className="page-grid">
        <section className="hero-panel insights-hero">
          <div>
            <span className="eyebrow">{source.dataLabel}</span>
            <h2>{businessUnit?.name || source.unit}</h2>
            <p>
              {source.name} is the appointment source for {businessUnit?.name || source.unit}.
            </p>
          </div>
          <div className="hero-meta">
            <strong>{source.name}</strong>
            <span>Waiting for import</span>
          </div>
        </section>

        <section className="panel full-span">
          <EmptyState
            icon={CalendarDays}
            title={source.emptyTitle}
            message={source.emptyMessage}
            action={squareActions || booksyActions}
          />
        </section>
      </div>
    );
  }

  return (
    <div className="page-grid">
      <section className="hero-panel insights-hero">
        <div>
          <span className="eyebrow">{source.dataLabel}</span>
          <h2>{masterDashboard.businessUnit || businessUnit?.name || 'RTB Lounge'}</h2>
          <p>
            Revenue, clients, services, staff activity, and schedule data from the master
            dashboard import.
          </p>
        </div>
        <div className="hero-meta">
          <strong>{masterDashboard.summary?.periodLabel || 'Current period'}</strong>
          <span>{source.name} · {masterDashboard.location || 'RTB Lounge'}</span>
        </div>
      </section>

      {source.name === 'Booksy' ? (
        <section className="panel full-span">
          <div className="section-header">
            <div>
              <span>Booksy import</span>
              <h2>Upload a weekly or monthly report</h2>
            </div>
          </div>
          {booksyActions}
        </section>
      ) : null}

      <section className="full-span">
        <InsightTabs activeTab={activeTab} setActiveTab={setActiveTab} />
      </section>

      {activeTab === 'overview' ? (
        <OverviewTab
          data={masterDashboard}
          setActiveTab={setActiveTab}
          sourceName={source.name}
        />
      ) : null}
      {activeTab === 'staff' ? <StaffTab data={masterDashboard} /> : null}
      {activeTab === 'services' ? <ServicesTab data={masterDashboard} /> : null}
      {activeTab === 'clients' ? <ClientsTab data={masterDashboard} /> : null}
      {activeTab === 'schedule' ? <ScheduleTab data={masterDashboard} /> : null}
    </div>
  );
}
