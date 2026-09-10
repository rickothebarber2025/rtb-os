import { useEffect } from 'react';
import { CalendarDays, LogOut, Menu, RefreshCw } from 'lucide-react';
import BusinessUnitSelector from './BusinessUnitSelector';
import OwnerActivityNotifications from './OwnerActivityNotifications';
import StaffNotifications from './StaffNotifications';
import { getEffectivePermissionsPayload, getProfileRoleTitle, isOwnerProfile } from '../lib/permissions.js';
import { ALL_BUSINESSES_ID } from '../utils/businessProfiles.js';

export default function Topbar({ businessOptions,businessUnits,onMenuClick,onRefresh,pageTitle,profile,selectedBusinessUnitId,setActivePage,setSelectedBusinessUnitId,setStaffHubTab,signOut,user,userPreferences }) {
  const displayLabel=userPreferences?.displayName||user?.email||'Signed in';const displayInitial=displayLabel.trim().charAt(0).toUpperCase()||'R';
  const todayLabel=new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',weekday:'short'}).format(new Date());
  const roleTemplate=getEffectivePermissionsPayload(profile).role_template;const wholeRtbCleaning=roleTemplate === 'operations_cleaning';
  useEffect(()=>{if(wholeRtbCleaning&&selectedBusinessUnitId!==ALL_BUSINESSES_ID)setSelectedBusinessUnitId(ALL_BUSINESSES_ID);},[selectedBusinessUnitId,setSelectedBusinessUnitId,wholeRtbCleaning]);
  return (
    <header className="topbar">
      <div className="topbar__title">
        <button aria-label="Open navigation menu" className="icon-button topbar__menu" type="button" onClick={onMenuClick}>
          <Menu aria-hidden="true" size={20} />
        </button>
        <div>
          <span className="topbar__kicker">RTB OS</span>
          <h1>{pageTitle}</h1>
        </div>
      </div>
      <div className="topbar__actions">
        <div className="topbar__context-pill" aria-label="Current RTB OS context">
          <div className="topbar__status" aria-label={`Current date: ${todayLabel}`}>
            <CalendarDays aria-hidden="true" size={16} />
            <span>{todayLabel}</span>
          </div>
          <div className="topbar__business">
            {wholeRtbCleaning ? (
              <div className="business-unit-selector" aria-label="Assigned business scope: Whole RTB, RTB Lounge and RTB Beauty Lounge">
                <strong>Whole RTB</strong>
                <small>RTB Lounge + RTB Beauty Lounge</small>
              </div>
            ) : (
              <BusinessUnitSelector
                businessOptions={businessOptions}
                businessUnits={businessUnits}
                selectedBusinessUnitId={selectedBusinessUnitId}
                setSelectedBusinessUnitId={setSelectedBusinessUnitId}
              />
            )}
          </div>
          {profile ? (
            <span className={`role-pill ${isOwnerProfile(profile) ? 'admin' : profile.role}`}>
              {getProfileRoleTitle(profile)}
            </span>
          ) : null}
          <div className="user-chip" aria-label={`Signed in as ${displayLabel}`} role="img">
            <span aria-hidden="true">{displayInitial}</span>
          </div>
        </div>
        <div className="topbar__user-controls">
          {isOwnerProfile(profile) ? (
            <OwnerActivityNotifications selectedBusinessUnitId={selectedBusinessUnitId} setActivePage={setActivePage} setStaffHubTab={setStaffHubTab} />
          ) : (
            <StaffNotifications setActivePage={setActivePage} setStaffHubTab={setStaffHubTab} />
          )}
          <button className="icon-button" type="button" onClick={onRefresh} aria-label="Refresh data">
            <RefreshCw aria-hidden="true" size={18} />
          </button>
          <button className="icon-button" type="button" onClick={signOut} aria-label="Sign out">
            <LogOut aria-hidden="true" size={18} />
          </button>
        </div>
      </div>
    </header>
  );
}
