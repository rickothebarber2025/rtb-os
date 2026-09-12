import { X } from 'lucide-react';
import { getBusinessProfile } from '../utils/businessProfiles';

const PRIMARY_NAV_IDS = new Set([
  'dashboard',
  'action-center',
  'staff-hub',
  'staff',
  'payroll',
  'operations',
  'performance',
  'integrations',
]);

const GROUP_ORDER = ['Today', 'Team & Pay', 'Team Comms', 'Daily Ops', 'Client Flow', 'Control Room', 'Profile'];

function groupNavItems(items) {
  return items.reduce((result, item) => {
    const group = item.group || 'Today';
    return {
      ...result,
      [group]: [...(result[group] || []), item],
    };
  }, {});
}

function sortGroups(groups) {
  return Object.entries(groups).sort(([a], [b]) => {
    const aIndex = GROUP_ORDER.indexOf(a);
    const bIndex = GROUP_ORDER.indexOf(b);
    if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });
}

export default function Sidebar({
  activePage,
  businessOptions,
  isOpen,
  navBadges,
  navItems,
  onClose,
  selectedBusinessUnitId,
  setActivePage,
}) {
  const selectedBusiness = businessOptions?.find((unit) => unit.id === selectedBusinessUnitId);
  const brandProfile = getBusinessProfile(selectedBusiness);
  const shouldCondense = navItems.length > 8;
  const primaryItems = shouldCondense ? navItems.filter((item) => PRIMARY_NAV_IDS.has(item.id)) : navItems;
  const secondaryItems = shouldCondense ? navItems.filter((item) => !PRIMARY_NAV_IDS.has(item.id)) : [];
  const groups = groupNavItems(primaryItems);
  const secondaryGroups = groupNavItems(secondaryItems);
  const activeInSecondary = secondaryItems.some((item) => item.id === activePage);

  function renderNavButton(item, secondary = false) {
    const Icon = item.icon;
    const active = activePage === item.id;
    const badgeCount = Number(navBadges?.[item.id] || 0);

    return (
      <button
        className={`nav-item ${secondary ? 'nav-item--secondary' : ''} ${active ? 'active' : ''}`}
        key={item.id}
        type="button"
        data-nav-target={item.id}
        onClick={() => {
          setActivePage(item.id);
          onClose();
        }}
      >
        <Icon size={secondary ? 16 : 18} />
        <span>{item.label}</span>
        {badgeCount > 0 ? (
          <span className="nav-item__badge" aria-label={`${badgeCount} unread`}>
            {badgeCount > 99 ? '99+' : badgeCount}
          </span>
        ) : null}
      </button>
    );
  }

  return (
    <aside className={`sidebar ${isOpen ? 'is-open' : ''}`} aria-label="Main navigation drawer">
      <div className="sidebar__brand">
        <div className="brand-mark image-mark">
          <img src={brandProfile.logo_url} alt="" />
        </div>
        <div>
          <strong>RTB OS</strong>
          <span>{selectedBusiness?.name || 'Operations'}</span>
        </div>
        <button className="icon-button sidebar__close" type="button" onClick={onClose}>
          <X size={18} />
        </button>
      </div>

      <nav className="sidebar__nav" aria-label="Main navigation">
        {sortGroups(groups).map(([group, items]) => (
          <div className="nav-group" key={group}>
            <span className="nav-group__label">{group}</span>
            {items.map((item) => renderNavButton(item))}
          </div>
        ))}
        {secondaryItems.length ? (
          <details className="sidebar__more" open={activeInSecondary}>
            <summary>
              <span>More tools</span>
              <small>{secondaryItems.length}</small>
            </summary>
            <div className="sidebar__secondary-list">
              {sortGroups(secondaryGroups).map(([group, items]) => (
                <div className="nav-group nav-group--secondary" key={group}>
                  <span className="nav-group__label">{group}</span>
                  {items.map((item) => renderNavButton(item, true))}
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </nav>

      <div className="sidebar__footer">
        <div className="sidebar__status">
          <span className="status-dot" aria-hidden="true" />
          <strong>Live workspace</strong>
        </div>
        <span>{selectedBusiness?.name || 'Assigned business'}</span>
        <span>{businessOptions?.length > 1 ? `${businessOptions.length} accessible scopes` : 'Single-business view'}</span>
      </div>
    </aside>
  );
}
