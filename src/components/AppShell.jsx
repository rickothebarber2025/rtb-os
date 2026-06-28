import { useMemo, useState } from 'react';
import Sidebar from './Sidebar';
import Topbar from './Topbar';

export default function AppShell({
  activePage,
  businessOptions,
  businessUnits,
  children,
  onRefresh,
  navItems,
  profile,
  selectedBusinessUnitId,
  setActivePage,
  setSelectedBusinessUnitId,
  signOut,
  user,
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pageTitle = useMemo(
    () => navItems.find((item) => item.id === activePage)?.label || 'Dashboard',
    [activePage, navItems],
  );

  return (
    <div className="app-shell">
      <Sidebar
        activePage={activePage}
        isOpen={sidebarOpen}
        navItems={navItems}
        onClose={() => setSidebarOpen(false)}
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
        />
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
