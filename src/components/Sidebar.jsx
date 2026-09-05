import { X } from 'lucide-react';
import { getBusinessProfile } from '../utils/businessProfiles';

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
  const groups = navItems.reduce((result, item) => {
    const group = item.group || 'Workspace';
    return {
      ...result,
      [group]: [...(result[group] || []), item],
    };
  }, {});

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
        {Object.entries(groups).map(([group, items]) => (
          <div className="nav-group" key={group}>
            <span className="nav-group__label">{group}</span>
            {items.map((item) => {
              const Icon = item.icon;
              const active = activePage === item.id;
              const badgeCount = Number(navBadges?.[item.id] || 0);

              return (
                <button
                  className={`nav-item ${active ? 'active' : ''}`}
                  key={item.id}
                  type="button"
                  data-nav-target={item.id}
                  onClick={() => {
                    setActivePage(item.id);
                    onClose();
                  }}
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                  {badgeCount > 0 ? (
                    <span className="nav-item__badge" aria-label={`${badgeCount} unread`}>
                      {badgeCount > 99 ? '99+' : badgeCount}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="sidebar__footer">
        <div className="sidebar__status">
          <span className="status-dot" aria-hidden="true" />
          <strong>Live workspace</strong>
        </div>
        <span>RTB Lounge</span>
        <span>RTB Beauty Lounge</span>
      </div>
    </aside>
  );
}
