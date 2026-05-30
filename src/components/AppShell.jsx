import { useMemo, useState } from 'react';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { NAV_ITEMS } from '../utils/constants';

export default function AppShell({
  activePage,
  businessUnits,
  children,
  onRefresh,
  selectedBusinessUnitId,
  setActivePage,
  setSelectedBusinessUnitId,
  signOut,
  user,
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pageTitle = useMemo(
    () => NAV_ITEMS.find((item) => item.id === activePage)?.label || 'Dashboard',
    [activePage],
  );

  return (
    <div className="app-shell">
      <Sidebar
        activePage={activePage}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        setActivePage={setActivePage}
      />
      {sidebarOpen ? (
        <button className="scrim" type="button" onClick={() => setSidebarOpen(false)} />
      ) : null}
      <div className="main-area">
        <Topbar
          businessUnits={businessUnits}
          onMenuClick={() => setSidebarOpen(true)}
          onRefresh={onRefresh}
          pageTitle={pageTitle}
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
