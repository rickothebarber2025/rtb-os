import { LogOut, Menu, RefreshCw } from 'lucide-react';
import BusinessUnitSelector from './BusinessUnitSelector';
import { getRoleLabel } from '../utils/access';

export default function Topbar({
  businessOptions,
  businessUnits,
  onMenuClick,
  onRefresh,
  pageTitle,
  profile,
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
          businessOptions={businessOptions}
          businessUnits={businessUnits}
          selectedBusinessUnitId={selectedBusinessUnitId}
          setSelectedBusinessUnitId={setSelectedBusinessUnitId}
        />
        {profile ? (
          <span className={`role-pill ${profile.role}`}>{getRoleLabel(profile.role)}</span>
        ) : null}
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
