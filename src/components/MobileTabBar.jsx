import { useEffect } from 'react';
import { CircleDollarSign, ClipboardCheck, Home, Menu } from 'lucide-react';
import { getEffectivePermissionsPayload } from '../lib/permissions.js';

const QUICK_NAV_IDS = ['dashboard', 'action-center', 'payroll', 'staff', 'staff-hub'];

const SHORT_LABELS = {
  'action-center': 'Actions',
  dashboard: 'Home',
  payroll: 'Payroll',
  'staff-hub': 'Hub',
  staff: 'Roster',
};

const STAFF_HUB_QUICK_TABS = [
  { icon: Home, id: 'home', label: 'Home' },
  { icon: ClipboardCheck, id: 'daily', label: 'Work' },
  { icon: CircleDollarSign, id: 'money', label: 'Money' },
];

function isOperationsCleaning(profile) {
  if (!profile) return false;
  const payload = getEffectivePermissionsPayload(profile);
  return payload.role_template === 'operations_cleaning' || profile.user_type === 'contractor' && payload.role_title === 'Operations Cleaning';
}

export default function MobileTabBar({ activePage, navBadges, navItems, onMoreClick, profile, setActivePage, setStaffHubTab, staffHubTab }) {
  const insideStaffHub = activePage === 'staff-hub' && typeof setStaffHubTab === 'function';
  const cleanerPortal = insideStaffHub && isOperationsCleaning(profile);

  useEffect(() => {
    if (cleanerPortal && staffHubTab !== 'daily') setStaffHubTab('daily');
  }, [cleanerPortal, setStaffHubTab, staffHubTab]);

  if (cleanerPortal) {
    return (
      <div className="mobile-app-nav mobile-app-nav--cleaning">
        <div className="mobile-app-nav__handle"><span>Operations Cleaning</span></div>
        <nav className="mobile-tabbar mobile-tabbar--cleaning" aria-label="Operations Cleaning navigation">
          <button aria-current="page" aria-label="Cleaning workspace" className="mobile-tabbar__item active" title="Cleaning" type="button" data-nav-target="staff-hub:daily" onClick={() => setStaffHubTab('daily')}>
            <span className="mobile-tabbar__icon-wrap"><ClipboardCheck size={20} /></span>
            <span>Cleaning</span>
          </button>
        </nav>
      </div>
    );
  }

  if (insideStaffHub) {
    const moreActive = !STAFF_HUB_QUICK_TABS.some((tab) => tab.id === staffHubTab);
    return (
      <div className="mobile-app-nav">
        <div className="mobile-app-nav__handle">
          <span>{STAFF_HUB_QUICK_TABS.find((tab) => tab.id === staffHubTab)?.label || (staffHubTab === 'stats' ? 'Growth' : 'Team')}</span>
        </div>
        <nav className="mobile-tabbar mobile-tabbar--hub" aria-label="Staff Hub navigation">
          {STAFF_HUB_QUICK_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = staffHubTab === tab.id;
            return (
              <button aria-current={active ? 'page' : undefined} aria-label={tab.label} className={`mobile-tabbar__item ${active ? 'active' : ''}`} key={tab.id} title={tab.label} type="button" data-nav-target={`staff-hub:${tab.id}`} onClick={() => setStaffHubTab(tab.id)}>
                <span className="mobile-tabbar__icon-wrap"><Icon size={20} /></span>
                <span>{tab.label}</span>
              </button>
            );
          })}
          <button aria-current={moreActive ? 'page' : undefined} aria-label="Open Growth and Team sections" className={`mobile-tabbar__item ${moreActive ? 'active' : ''}`} title="More" type="button" data-nav-target="staff-hub:more" onClick={() => setStaffHubTab('more')}>
            <span className="mobile-tabbar__icon-wrap"><Menu size={20} /></span>
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
      <div className="mobile-app-nav__handle"><span>{activeItem?.label || 'RTB OS'}</span></div>
      <nav className="mobile-tabbar mobile-tabbar--main" aria-label="Quick navigation">
        {quickItems.map((item) => {
          const Icon = item.icon;
          const active = activePage === item.id;
          const badgeCount = Number(navBadges?.[item.id] || 0);
          return (
            <button aria-current={active ? 'page' : undefined} aria-label={item.label} className={`mobile-tabbar__item ${active ? 'active' : ''}`} key={item.id} title={item.label} type="button" data-nav-target={item.id} onClick={() => setActivePage(item.id)}>
              <span className="mobile-tabbar__icon-wrap">
                <Icon size={20} />
                {badgeCount > 0 ? <span className="mobile-tabbar__badge" aria-label={`${badgeCount} unread`}>{badgeCount > 99 ? '99+' : badgeCount}</span> : null}
              </span>
              <span>{SHORT_LABELS[item.id] || item.label}</span>
            </button>
          );
        })}
        <button aria-current={moreActive ? 'page' : undefined} aria-label="Open full navigation" className={`mobile-tabbar__item ${moreActive ? 'active' : ''}`} title="More" type="button" data-nav-target="navigation-drawer" onClick={onMoreClick}>
          <span className="mobile-tabbar__icon-wrap">
            <Menu size={20} />
            {moreBadgeCount > 0 ? <span className="mobile-tabbar__badge" aria-label={`${moreBadgeCount} unread`}>{moreBadgeCount > 99 ? '99+' : moreBadgeCount}</span> : null}
          </span>
          <span>More</span>
        </button>
      </nav>
    </div>
  );
}
