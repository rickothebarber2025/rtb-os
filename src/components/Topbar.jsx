import { LogOut, Menu, RefreshCw } from 'lucide-react';
import BusinessUnitSelector from './BusinessUnitSelector';

export default function Topbar({
  businessUnits,
  onMenuClick,
  onRefresh,
  pageTitle,
  selectedBusinessUnitId,
  setSelectedBusinessUnitId,
  signOut,
  user,
}) {
  return (
    <header className="topbar">
      <div className="topbar__title">
        <button className="icon-button topbar__menu" type="button" onClick={onMenuClick}>
          <Menu size={20} />
        </button>
        <div>
          <span>RTB OS</span>
          <h1>{pageTitle}</h1>
        </div>
      </div>

      <div className="topbar__actions">
        <BusinessUnitSelector
          businessUnits={businessUnits}
          selectedBusinessUnitId={selectedBusinessUnitId}
          setSelectedBusinessUnitId={setSelectedBusinessUnitId}
        />
        <button className="icon-button" type="button" onClick={onRefresh} aria-label="Refresh data">
          <RefreshCw size={18} />
        </button>
        <div className="user-chip" title={user?.email || 'Signed in'}>
          {user?.email?.charAt(0).toUpperCase() || 'R'}
        </div>
        <button className="icon-button" type="button" onClick={signOut} aria-label="Sign out">
          <LogOut size={18} />
        </button>
      </div>
    </header>
  );
}
