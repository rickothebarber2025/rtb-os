import { useMemo, useState } from 'react';
import AccessibilityRuntime from './AccessibilityRuntime';
import BehavioralMomentumBar from './BehavioralMomentumBar';
import GeminiOpsBrief from './GeminiOpsBrief';
import InteractionTelemetry from './InteractionTelemetry';
import MobileTabBar from './MobileTabBar';
import PageErrorBoundary from './PageErrorBoundary';
import PushNotificationsManager from './PushNotificationsManager';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { getBusinessProfile } from '../utils/businessProfiles';

export default function AppShell({
  activePage,
  behavioralSignals,
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
  setStaffHubTab,
  signOut,
  staffHubTab,
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
    <div className={`app-shell ${preferredTheme} ${densityClass} ${navigationClass} ${motionClass} ${sidebarClass}`}>
      <AccessibilityRuntime pageTitle={pageTitle} />
      <InteractionTelemetry
        activePage={activePage}
        businessUnitId={selectedBusinessUnitId}
        enabled={Boolean(profile?.active && user?.id)}
        staffHubTab={staffHubTab}
      />
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <PushNotificationsManager
        enabled={Boolean(profile?.active && user?.id)}
        setActivePage={setActivePage}
        setStaffHubTab={setStaffHubTab}
      />
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
      {sidebarOpen ? <button className="scrim" type="button" onClick={() => setSidebarOpen(false)} /> : null}
      <div className="main-area">
        <Topbar
          businessUnits={businessUnits}
          businessOptions={businessOptions}
          onMenuClick={() => setSidebarOpen(true)}
          onRefresh={onRefresh}
          pageTitle={pageTitle}
          profile={profile}
          selectedBusinessUnitId={selectedBusinessUnitId}
          setActivePage={setActivePage}
          setSelectedBusinessUnitId={setSelectedBusinessUnitId}
          setStaffHubTab={setStaffHubTab}
          signOut={signOut}
          user={user}
          userPreferences={userPreferences}
        />
        <main aria-label={pageTitle} className={`content ${pageClass}`} id="main-content" tabIndex={-1}>
          <BehavioralMomentumBar
            activePage={activePage}
            profile={profile}
            setActivePage={setActivePage}
            setStaffHubTab={setStaffHubTab}
            signals={behavioralSignals}
          />
          <PageErrorBoundary resetKey={`${activePage}:${selectedBusinessUnitId || 'none'}`} onRetry={onRefresh}>
            <GeminiOpsBrief activePage={activePage} businessUnitId={selectedBusinessUnitId} />
            {children}
          </PageErrorBoundary>
        </main>
        <MobileTabBar
          activePage={activePage}
          navBadges={navBadges}
          navItems={navItems}
          onMoreClick={() => setSidebarOpen(true)}
          profile={profile}
          setActivePage={setActivePage}
          setStaffHubTab={setStaffHubTab}
          staffHubTab={staffHubTab}
        />
      </div>
    </div>
  );
}
