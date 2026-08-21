import { useMemo, useState } from 'react';
import { CalendarDays, Clock3, Megaphone, Sparkles, Target } from 'lucide-react';
import StatusBadge from '../components/StatusBadge';
import { formatMarketingDate, getMarketingCalendar } from '../utils/marketingCalendar.js';

const FILTERS = [
  ['all', 'All'],
  ['school', 'School'],
  ['holiday', 'Holidays'],
  ['seasonal', 'Seasonal'],
  ['retail', 'Retail'],
];

function statusTone(status) {
  if (status === 'now') return 'danger';
  if (status === 'plan-now') return 'warning';
  if (status === 'prepare') return 'gold';
  return 'muted';
}

function statusLabel(item) {
  if (item.status === 'now') return item.daysUntil === 0 ? 'Today' : `${item.daysUntil}d away`;
  if (item.status === 'plan-now') return 'Launch now';
  if (item.status === 'prepare') return `Prep in ${Math.max(0, item.launchDaysUntil)}d`;
  return `${item.daysUntil}d away`;
}

function businessMatches(item, businessUnit) {
  if (!businessUnit || item.businesses === 'both') return true;
  const name = String(businessUnit.name || '').toLowerCase();
  if (item.businesses === 'beauty') return name.includes('beauty');
  if (item.businesses === 'lounge') return !name.includes('beauty');
  return true;
}

export default function MarketingCalendarPage({ businessUnit }) {
  const [filter, setFilter] = useState('all');
  const [showAll, setShowAll] = useState(false);
  const today = useMemo(() => new Date(), []);
  const calendar = useMemo(() => getMarketingCalendar(today), [today]);

  const relevant = useMemo(() => calendar
    .filter((item) => filter === 'all' || item.category === filter)
    .filter((item) => businessMatches(item, businessUnit)), [businessUnit, calendar, filter]);

  const visible = showAll ? relevant : relevant.slice(0, 12);
  const next = relevant[0];
  const actionNow = relevant.filter((item) => ['now', 'plan-now', 'prepare'].includes(item.status)).slice(0, 4);

  return (
    <div className="page-grid marketing-calendar-page">
      <section className="hero-panel full-span">
        <div>
          <span className="eyebrow">RTB Marketing Intelligence</span>
          <h2>Promotion calendar</h2>
          <p>
            Automatic Canadian holidays, Ottawa school dates and seasonal demand windows. RTB OS tells you when to start planning before the rush arrives.
          </p>
        </div>
        <div className="business-chip-list">
          <StatusBadge tone="success">Automatic yearly dates</StatusBadge>
          <StatusBadge tone="gold">Ottawa school calendar verified</StatusBadge>
        </div>
      </section>

      <section className="metrics-grid full-span">
        <div className="panel integration-metric-card">
          <CalendarDays size={20} />
          <div><strong>{next ? formatMarketingDate(next.date) : '—'}</strong><span>Next opportunity</span></div>
        </div>
        <div className="panel integration-metric-card">
          <Megaphone size={20} />
          <div><strong>{actionNow.length}</strong><span>Campaigns to prepare</span></div>
        </div>
        <div className="panel integration-metric-card">
          <Target size={20} />
          <div><strong>{relevant.length}</strong><span>Upcoming opportunities</span></div>
        </div>
      </section>

      {actionNow.length ? (
        <section className="panel full-span">
          <div className="section-header">
            <div>
              <span>What to work on now</span>
              <h2>Upcoming campaign actions</h2>
            </div>
          </div>
          <div className="ops-checklist-grid">
            {actionNow.map((item) => (
              <article className="ops-checklist-card" key={`${item.id}-${item.date.toISOString()}`}>
                <div className="ops-hire-card__top">
                  <div>
                    <StatusBadge tone={statusTone(item.status)}>{statusLabel(item)}</StatusBadge>
                    <h3>{item.name}</h3>
                    <span>{formatMarketingDate(item.date)}</span>
                  </div>
                  <Sparkles size={20} />
                </div>
                <p>{item.opportunity}</p>
                <div className="ops-progress-meta">
                  <span>Recommended campaign launch</span>
                  <strong>{formatMarketingDate(item.launchDate)}</strong>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="panel full-span">
        <div className="section-header">
          <div>
            <span>Promotion planner</span>
            <h2>Upcoming dates</h2>
          </div>
          <div className="access-filter-tabs" role="tablist" aria-label="Marketing calendar filters">
            {FILTERS.map(([id, label]) => (
              <button className={filter === id ? 'active' : ''} key={id} onClick={() => setFilter(id)} type="button">
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="access-card-list">
          {visible.map((item) => (
            <article className="access-card" key={`${item.id}-${item.date.toISOString()}`}>
              <div className="access-card__header">
                <div>
                  <span className="eyebrow">{item.category}</span>
                  <h3>{item.name}</h3>
                  <span className="subtle-text">{formatMarketingDate(item.date)}</span>
                </div>
                <StatusBadge tone={statusTone(item.status)}>{statusLabel(item)}</StatusBadge>
              </div>

              <p>{item.opportunity}</p>

              <div className="business-chip-list">
                <StatusBadge tone="muted"><Clock3 size={12} /> Start {item.leadDays} days early</StatusBadge>
                <StatusBadge tone="muted">{item.businesses === 'both' ? 'Both businesses' : item.businesses === 'beauty' ? 'Beauty Lounge' : 'RTB Lounge'}</StatusBadge>
              </div>

              <div className="template-preview">
                <div>
                  <strong>Launch target: {formatMarketingDate(item.launchDate)}</strong>
                  <span>{item.source}</span>
                </div>
              </div>
            </article>
          ))}
        </div>

        {relevant.length > 12 ? (
          <div className="action-row">
            <button className="secondary-button" type="button" onClick={() => setShowAll((value) => !value)}>
              {showAll ? 'Show next 12' : `Show all ${relevant.length}`}
            </button>
          </div>
        ) : null}
      </section>

      <section className="panel full-span">
        <div className="section-header">
          <div>
            <span>Verified local school data</span>
            <h2>Ottawa back-to-school intelligence</h2>
          </div>
        </div>
        <p>
          The 2026–2027 OCDSB and OCSB calendars both list Tuesday, September 1, 2026 as the first day of school. RTB OS uses that verified local date plus winter break, March Break and end-of-school windows for campaign timing.
        </p>
        <div className="alert warning">
          Future school-year calendars are only treated as verified after the Ottawa boards publish and approve them. General Canadian holiday dates continue to calculate automatically every year.
        </div>
      </section>
    </div>
  );
}
