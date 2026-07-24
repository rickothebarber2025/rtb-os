import { Menu } from 'lucide-react';

const QUICK_NAV_IDS = ['dashboard', 'action-center', 'payroll', 'staff', 'performance', 'staff-hub'];

const SHORT_LABELS = {
  'action-center': 'Actions',
  dashboard: 'Home',
  payroll: 'Payroll',
  performance: 'Stats',
  'staff-hub': 'Hub',
  staff: 'Roster',
};

export default function MobileTabBar({ activePage, navBadges, navItems, onMoreClick, setActivePage }) {
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
