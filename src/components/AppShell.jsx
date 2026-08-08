import { useMemo, useState } from 'react';
import GeminiOpsBrief from './GeminiOpsBrief';
import MobileTabBar from './MobileTabBar';
import Sidebar from './Sidebar';
import StaffCareerCoach from './StaffCareerCoach';
import Topbar from './Topbar';
import { getBusinessProfile } from '../utils/businessProfiles';

export default function AppShell({
  activePage,
  businessOptions,
  businessUnits,
  children,
  navBadges,
  onRefresh,
  navItems,
  profile,
  selectedBusinessUnitId,
  setActivePage,
  setSelectedBusinessUnitId,
  signOut,
  user,
  userPreferences,
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pageTitle = useMemo(
    () => navItems.find((item) => item.id === activePage)?.label || 'Dashboard',
    [activePage, navItems],
  );
  const selectedBusiness = businessOptions?.find((unit) => unit.id === selectedBusinessUnitId);
  const businessTheme = getBusinessProfile(selectedBusiness).portal_theme || 'theme-combined';
  const preferredTheme =
    userPreferences?.themePreference && userPreferences.themePreference !== 'auto'
      ? `theme-${userPreferences.themePreference}`
      : businessTheme;
  const densityClass =
    userPreferences?.density === 'compact' ? 'density-compact' : 'density-comfortable';
  const navigationClass =
    userPreferences?.navigationStyle === 'full' ? 'nav-full' : 'nav-simple';
  const motionClass = userPreferences?.reduceMotion ? 'motion-reduced' : 'motion-standard';

  const sidebarClass = sidebarOpen ? 'sidebar-open' : 'sidebar-closed';
  const pageClass = `page-${activePage}`;

  return (
    <div
      className={`app-shell ${preferredTheme} ${densityClass} ${navigationClass} ${motionClass} ${sidebarClass}`}
    >
      <div className="app-ambient" aria-hidden="true" />
      <Sidebar
        activePage={activePage}
        businessOptions={businessOptions}
        isOpen={sidebarOpen}
        navBadges={navBadges}
        navItems={navItems}
        onClose={() => setSidebarOpen(false)}
        selectedBusinessUnitId={selectedBusinessUnitId}
        setActivePage={setActivePage}
      />
      {sidebarOpen ? (
        <button className="scrim" type="button" onClick={() => setSidebarOpen(false)} />
      ) : null}
      <div className="main-area">
        <Topbar
          businessUnits={businessUnits}
          businessOptions={businessOptions}
          onMenuClick={() => setSidebarOpen(true)}
          onRefresh={onRefresh}
          pageTitle={pageTitle}
          profile={profile}
          selectedBusinessUnitId={selectedBusinessUnitId}
          setSelectedBusinessUnitId={setSelectedBusinessUnitId}
          signOut={signOut}
          user={user}
          userPreferences={userPreferences}
        />
        <main className={`content ${pageClass}`}>
          {activePage === 'staff-hub' ? <StaffCareerCoach /> : null}
          <GeminiOpsBrief activePage={activePage} businessUnitId={selectedBusinessUnitId} />
          {children}
        </main>
        <MobileTabBar
          activePage={activePage}
          navBadges={navBadges}
          navItems={navItems}
          onMoreClick={() => setSidebarOpen(true)}
          setActivePage={setActivePage}
        />
      </div>
    </div>
  );
}
