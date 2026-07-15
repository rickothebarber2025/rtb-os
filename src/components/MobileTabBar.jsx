import { Menu } from 'lucide-react';

const QUICK_NAV_IDS = ['staff-hub', 'dashboard', 'action-center', 'payroll', 'staff'];

const SHORT_LABELS = {
  'action-center': 'Actions',
  dashboard: 'Home',
  payroll: 'Payroll',
  'staff-hub': 'Hub',
  staff: 'Roster',
};

export default function MobileTabBar({ activePage, navItems, onMoreClick, setActivePage }) {
  const quickItems = QUICK_NAV_IDS.map((id) => navItems.find((item) => item.id === id)).filter(Boolean);
  const quickIds = new Set(quickItems.map((item) => item.id));
  const moreActive = !quickIds.has(activePage);
  const activeItem = navItems.find((item) => item.id === activePage);

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

          return (
            <button
              aria-current={active ? 'page' : undefined}
              className={`mobile-tabbar__item ${active ? 'active' : ''}`}
              key={item.id}
              type="button"
              onClick={() => setActivePage(item.id)}
            >
              <Icon size={20} />
              <span>{SHORT_LABELS[item.id] || item.label}</span>
            </button>
          );
        })}
        <button
          aria-current={moreActive ? 'page' : undefined}
          className={`mobile-tabbar__item ${moreActive ? 'active' : ''}`}
          type="button"
          onClick={onMoreClick}
        >
          <Menu size={20} />
          <span>More</span>
        </button>
      </nav>
    </div>
  );
}
