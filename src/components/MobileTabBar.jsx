import { ClipboardCheck, Coffee, Home, Menu, Trophy } from 'lucide-react';

const QUICK_NAV_IDS = ['dashboard', 'action-center', 'payroll', 'staff', 'performance', 'staff-hub'];

const SHORT_LABELS = {
  'action-center': 'Actions',
  dashboard: 'Home',
  payroll: 'Payroll',
  performance: 'Stats',
  'staff-hub': 'Hub',
  staff: 'Roster',
};

// When inside Staff Hub, the global quick-nav above is mostly empty for
// regular staff -- they don't have access to Dashboard/Payroll/Roster/
// Performance as top-level pages, so it collapses down to just "Hub" and
// "More", wasting the bar. This shows Staff Hub's own most-used tabs
// instead, so switching between them doesn't require scrolling the
// horizontal tab strip at the top of the page.
const STAFF_HUB_QUICK_TABS = [
  { icon: ClipboardCheck, id: 'daily', label: 'Daily Ops' },
  { icon: Home, id: 'home', label: 'Today' },
  { icon: Trophy, id: 'spotlight', label: 'Spotlight' },
  { icon: Coffee, id: 'tips', label: 'Tips' },
];

export default function MobileTabBar({ activePage, navBadges, navItems, onMoreClick, setActivePage, setStaffHubTab, staffHubTab }) {
  const insideStaffHub = activePage === 'staff-hub' && typeof setStaffHubTab === 'function';

  if (insideStaffHub) {
    const moreActive = !STAFF_HUB_QUICK_TABS.some((tab) => tab.id === staffHubTab);

    return (
      <div className="mobile-app-nav">
        <div className="mobile-app-nav__handle">
          <span>{STAFF_HUB_QUICK_TABS.find((tab) => tab.id === staffHubTab)?.label || 'Staff Hub'}</span>
        </div>
        <nav className="mobile-tabbar" aria-label="Staff Hub quick navigation">
          {STAFF_HUB_QUICK_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = staffHubTab === tab.id;
            return (
              <button
                aria-current={active ? 'page' : undefined}
                aria-label={tab.label}
                className={`mobile-tabbar__item ${active ? 'active' : ''}`}
                key={tab.id}
                title={tab.label}
                type="button"
                onClick={() => setStaffHubTab(tab.id)}
              >
                <span className="mobile-tabbar__icon-wrap">
                  <Icon size={20} />
                </span>
                <span>{tab.label}</span>
              </button>
            );
          })}
          <button
            aria-current={moreActive ? 'page' : undefined}
            aria-label="More Staff Hub sections"
            className={`mobile-tabbar__item ${moreActive ? 'active' : ''}`}
            title="More"
            type="button"
            onClick={() => setStaffHubTab('more')}
          >
            <span className="mobile-tabbar__icon-wrap">
              <Menu size={20} />
            </span>
            <span>More</span>
          </button>
        </nav>
      </div>
    );
  }

  const quickItems = QUICK_NAV_IDS.map((id) => navItems.find((item) => item.id === id)).filter(Boolean);
  const quickIds = new Set(quickItems.map((item) => item.id));
  const moreActive = !quickIds.has(activePage);
  const activeItem = navItems.find((item) => item.id === activePage);
  const moreBadgeCount = navItems
    .filter((item) => !quickIds.has(item.id))
    .reduce((total, item) => total + Number(navBadges?.[item.id] || 0), 0);

  if (!quickItems.length) return null;

  return (
    <div className="mobile-app-nav">
      <div className="mobile-app-nav__handle">
        <span>{activeItem?.label || 'RTB OS'}</span>
      </div>
      <nav className="mobile-tabbar" aria-label="Quick navigation">
        {quickItems.map((item) => {
          const Icon = item.icon;
          const active = activePage === item.id;
          const badgeCount = Number(navBadges?.[item.id] || 0);

          return (
            <button
              aria-current={active ? 'page' : undefined}
              aria-label={item.label}
              className={`mobile-tabbar__item ${active ? 'active' : ''}`}
              key={item.id}
              title={item.label}
              type="button"
              onClick={() => setActivePage(item.id)}
            >
              <span className="mobile-tabbar__icon-wrap">
                <Icon size={20} />
                {badgeCount > 0 ? (
                  <span className="mobile-tabbar__badge" aria-label={`${badgeCount} unread`}>
                    {badgeCount > 99 ? '99+' : badgeCount}
                  </span>
                ) : null}
              </span>
              <span>{SHORT_LABELS[item.id] || item.label}</span>
            </button>
          );
        })}
        <button
          aria-current={moreActive ? 'page' : undefined}
          aria-label="Open full navigation"
          className={`mobile-tabbar__item ${moreActive ? 'active' : ''}`}
          title="More"
          type="button"
          onClick={onMoreClick}
        >
          <span className="mobile-tabbar__icon-wrap">
            <Menu size={20} />
            {moreBadgeCount > 0 ? (
              <span className="mobile-tabbar__badge" aria-label={`${moreBadgeCount} unread`}>
                {moreBadgeCount > 99 ? '99+' : moreBadgeCount}
              </span>
            ) : null}
          </span>
          <span>More</span>
        </button>
      </nav>
    </div>
  );
}
