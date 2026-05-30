import { Scissors, X } from 'lucide-react';
import { NAV_ITEMS } from '../utils/constants';

export default function Sidebar({ activePage, isOpen, onClose, setActivePage }) {
  return (
    <aside className={`sidebar ${isOpen ? 'is-open' : ''}`}>
      <div className="sidebar__brand">
        <div className="brand-mark">
          <Scissors size={22} />
        </div>
        <div>
          <strong>RTB OS</strong>
          <span>Operations</span>
        </div>
        <button className="icon-button sidebar__close" type="button" onClick={onClose}>
          <X size={18} />
        </button>
      </div>

      <nav className="sidebar__nav" aria-label="Main navigation">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activePage === item.id;

          return (
            <button
              className={`nav-item ${active ? 'active' : ''}`}
              key={item.id}
              type="button"
              onClick={() => {
                setActivePage(item.id);
                onClose();
              }}
            >
              <Icon size={18} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="sidebar__footer">
        <span>RTB Lounge</span>
        <span>RTB Beauty Lounge</span>
      </div>
    </aside>
  );
}
