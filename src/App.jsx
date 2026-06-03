import { useEffect, useMemo, useRef, useState } from 'react';
import AppShell from './components/AppShell';
import LoadingState from './components/LoadingState';
import AccessPage from './pages/AccessPage';
import AccessPendingPage from './pages/AccessPendingPage';
import AuthPage from './pages/AuthPage';
import BooksyInsightsPage from './pages/BooksyInsightsPage';
import BoothRentPage from './pages/BoothRentPage';
import DashboardPage from './pages/DashboardPage';
import PayrollPage from './pages/PayrollPage';
import PerformancePage from './pages/PerformancePage';
import StaffPage from './pages/StaffPage';
import { useAuth } from './hooks/useAuth';
import { useRtbData } from './hooks/useRtbData';
import { saveStaff } from './services/rtbService';
import { canAccessPage, canManageStaff, canUseApp, getAllowedNavItems } from './utils/access';
import { shouldAutoGraduate, toGraduationPayload } from './utils/probation';

const STORAGE_KEY = 'rtb-os-business-unit';

export default function App() {
  const auth = useAuth();
  const [activePage, setActivePage] = useState('dashboard');
  const [selectedBusinessUnitId, setSelectedBusinessUnitId] = useState(() =>
    window.localStorage.getItem(STORAGE_KEY),
  );
  const [probationBanner, setProbationBanner] = useState('');
  const autoGraduatingRef = useRef(false);
  const appEnabled = auth.isConfigured && Boolean(auth.session) && canUseApp(auth.profile);
  const data = useRtbData(selectedBusinessUnitId, appEnabled, auth.profile);
  const navItems = useMemo(() => getAllowedNavItems(auth.profile), [auth.profile]);

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

  useEffect(() => {
    if (auth.profile && !canAccessPage(auth.profile, activePage)) {
      setActivePage('dashboard');
    }
  }, [activePage, auth.profile]);

  useEffect(() => {
    async function graduateDueProbationStaff() {
      if (!['dashboard', 'staff'].includes(activePage)) return;
      if (!canManageStaff(auth.profile) || data.loading || autoGraduatingRef.current) return;

      const dueStaff = data.staff.filter((member) => shouldAutoGraduate(member));
      if (!dueStaff.length) return;

      autoGraduatingRef.current = true;
      setProbationBanner('');

      try {
        await Promise.all(dueStaff.map((member) => saveStaff(toGraduationPayload(member))));
        setProbationBanner(
          `${dueStaff.map((member) => member.full_name).join(', ')} graduated to Standard RTB automatically.`,
        );
        await data.refresh();
      } catch (_err) {
        setProbationBanner('');
      } finally {
        autoGraduatingRef.current = false;
      }
    }

    graduateDueProbationStaff();
  }, [activePage, auth.profile, data]);

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
      accessProfile: auth.profile,
      user: auth.user,
    }),
    [auth.profile, auth.user, data],
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
      case 'access':
        return (
          <AccessPage
            businessUnits={data.businessUnits}
            currentUserId={auth.user?.id}
          />
        );
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
        authError={auth.authError}
        isConfigured={auth.isConfigured}
        sendMagicLink={auth.sendMagicLink}
        signInWithGoogle={auth.signInWithGoogle}
        signInWithPassword={auth.signInWithPassword}
        signUp={auth.signUp}
      />
    );
  }

  if (!canUseApp(auth.profile)) {
    return (
      <AccessPendingPage
        error={auth.profileError}
        profile={auth.profile}
        refreshProfile={auth.refreshProfile}
        signOut={auth.signOut}
      />
    );
  }

  return (
    <AppShell
      activePage={activePage}
      businessUnits={data.businessUnits}
      navItems={navItems}
      onRefresh={data.refresh}
      profile={auth.profile}
      selectedBusinessUnitId={selectedBusinessUnitId}
      setActivePage={setActivePage}
      setSelectedBusinessUnitId={setSelectedBusinessUnitId}
      signOut={auth.signOut}
      user={auth.user}
    >
      {probationBanner ? <div className="alert success global-alert">{probationBanner}</div> : null}
      {renderPage()}
    </AppShell>
  );
}
