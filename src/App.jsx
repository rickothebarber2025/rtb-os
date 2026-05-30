import { useEffect, useMemo, useState } from 'react';
import AppShell from './components/AppShell';
import LoadingState from './components/LoadingState';
import AuthPage from './pages/AuthPage';
import BooksyInsightsPage from './pages/BooksyInsightsPage';
import BoothRentPage from './pages/BoothRentPage';
import DashboardPage from './pages/DashboardPage';
import PayrollPage from './pages/PayrollPage';
import PerformancePage from './pages/PerformancePage';
import StaffPage from './pages/StaffPage';
import { useAuth } from './hooks/useAuth';
import { useRtbData } from './hooks/useRtbData';

const STORAGE_KEY = 'rtb-os-business-unit';

export default function App() {
  const auth = useAuth();
  const [activePage, setActivePage] = useState('dashboard');
  const [selectedBusinessUnitId, setSelectedBusinessUnitId] = useState(() =>
    window.localStorage.getItem(STORAGE_KEY),
  );
  const data = useRtbData(selectedBusinessUnitId, auth.isConfigured && Boolean(auth.session));

  useEffect(() => {
    const selectedExists = data.businessUnits.some((unit) => unit.id === selectedBusinessUnitId);
    if (data.businessUnits.length && (!selectedBusinessUnitId || !selectedExists)) {
      setSelectedBusinessUnitId(data.businessUnits[0].id);
    }
  }, [data.businessUnits, selectedBusinessUnitId]);

  useEffect(() => {
    if (selectedBusinessUnitId) {
      window.localStorage.setItem(STORAGE_KEY, selectedBusinessUnitId);
    }
  }, [selectedBusinessUnitId]);

  const pageProps = useMemo(
    () => ({
      boothRent: data.boothRent,
      businessUnit: data.selectedBusinessUnit,
      masterDashboard: data.masterDashboard,
      onRefresh: data.refresh,
      payrollRuns: data.payrollRuns,
      performanceSummary: data.performanceSummary,
      setActivePage,
      staff: data.staff,
      user: auth.user,
    }),
    [auth.user, data],
  );

  function renderPage() {
    if (data.loading) {
      return <LoadingState label="Loading business data" />;
    }

    if (data.error) {
      return (
        <div className="panel full-span">
          <div className="alert danger">{data.error}</div>
          <button className="secondary-button" type="button" onClick={data.refresh}>
            Retry
          </button>
        </div>
      );
    }

    switch (activePage) {
      case 'payroll':
        return <PayrollPage {...pageProps} />;
      case 'staff':
        return <StaffPage {...pageProps} />;
      case 'performance':
        return <PerformancePage {...pageProps} />;
      case 'insights':
        return <BooksyInsightsPage {...pageProps} />;
      case 'booth-rent':
        return <BoothRentPage {...pageProps} />;
      case 'dashboard':
      default:
        return <DashboardPage {...pageProps} />;
    }
  }

  if (auth.loading) {
    return <LoadingState />;
  }

  if (!auth.session) {
    return (
      <AuthPage
        isConfigured={auth.isConfigured}
        sendMagicLink={auth.sendMagicLink}
        signInWithGoogle={auth.signInWithGoogle}
        signInWithPassword={auth.signInWithPassword}
        signUp={auth.signUp}
      />
    );
  }

  return (
    <AppShell
      activePage={activePage}
      businessUnits={data.businessUnits}
      onRefresh={data.refresh}
      selectedBusinessUnitId={selectedBusinessUnitId}
      setActivePage={setActivePage}
      setSelectedBusinessUnitId={setSelectedBusinessUnitId}
      signOut={auth.signOut}
      user={auth.user}
    >
      {renderPage()}
    </AppShell>
  );
}
