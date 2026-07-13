import { LogOut, Menu, RefreshCw } from 'lucide-react';
import BusinessUnitSelector from './BusinessUnitSelector';
import { getProfileRoleTitle, isOwnerProfile } from '../lib/permissions.js';

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
  userPreferences,
}) {
  const displayLabel = userPreferences?.displayName || user?.email || 'Signed in';
  const displayInitial = displayLabel.trim().charAt(0).toUpperCase() || 'R';

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
          <span className={`role-pill ${isOwnerProfile(profile) ? 'admin' : profile.role}`}>
            {getProfileRoleTitle(profile)}
          </span>
        ) : null}
        <button className="icon-button" type="button" onClick={onRefresh} aria-label="Refresh data">
          <RefreshCw size={18} />
        </button>
        <div className="user-chip" title={displayLabel}>
          {displayInitial}
        </div>
        <button className="icon-button" type="button" onClick={signOut} aria-label="Sign out">
          <LogOut size={18} />
        </button>
      </div>
    </header>
  );
}
