import { CalendarDays, LogOut, Menu, RefreshCw } from 'lucide-react';
import BusinessUnitSelector from './BusinessUnitSelector';
import OwnerActivityNotifications from './OwnerActivityNotifications';
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
  const todayLabel = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    weekday: 'short',
  }).format(new Date());

  return (
    <header className="topbar">
      <div className="topbar__title">
        <button className="icon-button topbar__menu" type="button" onClick={onMenuClick}>
          <Menu size={20} />
        </button>
        <div>
          <span className="topbar__kicker">RTB OS</span>
          <h1>{pageTitle}</h1>
        </div>
      </div>

      <div className="topbar__actions">
        <div className="topbar__status" aria-label="Current date">
          <CalendarDays size={16} />
          <span>{todayLabel}</span>
        </div>
        <div className="topbar__business">
          <BusinessUnitSelector
            businessOptions={businessOptions}
            businessUnits={businessUnits}
            selectedBusinessUnitId={selectedBusinessUnitId}
            setSelectedBusinessUnitId={setSelectedBusinessUnitId}
          />
        </div>
        <div className="topbar__user-controls">
          {profile ? (
            <span className={`role-pill ${isOwnerProfile(profile) ? 'admin' : profile.role}`}>
              {getProfileRoleTitle(profile)}
            </span>
          ) : null}
          {isOwnerProfile(profile) ? (
            <OwnerActivityNotifications selectedBusinessUnitId={selectedBusinessUnitId} />
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
      </div>
    </header>
  );
}
