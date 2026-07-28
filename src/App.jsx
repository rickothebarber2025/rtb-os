import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import AppShell from './components/AppShell';
import LoadingState from './components/LoadingState';
import ModuleGate from './components/ModuleGate.jsx';
import { useSyncAuthProfile } from './contexts/AuthProfileContext.jsx';
import AccessPendingPage from './pages/AccessPendingPage';
import AuthPage from './pages/AuthPage';
import { useAuth } from './hooks/useAuth';
import { useLiveRefresh, useSquareAutoSync } from './hooks/useLiveRefresh';
import { useRtbData } from './hooks/useRtbData';
import { useUserPreferences } from './hooks/useUserPreferences';
import { saveStaff } from './services/rtbService';
import {
  canAccessPage,
  canManageAppointments,
  canManageStaff,
  canUseApp,
  getAllowedNavItems,
} from './utils/access';
import {
  getBusinessSelectionOptions,
  isAllBusinessesId,
  isAllBusinessesUnit,
} from './utils/businessProfiles';
import { shouldAutoGraduate, toGraduationPayload } from './utils/probation';

const AccessPage = lazy(() => import('./pages/AccessPage'));
const ActionCenterPage = lazy(() => import('./pages/ActionCenterPage'));
const AiConsultantPage = lazy(() => import('./pages/AiConsultantPage'));
const CustomerIntelligencePage = lazy(() => import('./pages/CustomerIntelligencePage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const OperationsPage = lazy(() => import('./pages/OperationsPage'));
const MyRolePage = lazy(() => import('./pages/MyRolePage'));
const PayrollPage = lazy(() => import('./pages/PayrollPage'));
const PerformancePage = lazy(() => import('./pages/PerformancePage'));
const StaffPage = lazy(() => import('./pages/StaffPage'));
const StaffHubPage = lazy(() => import('./pages/StaffHubPage'));
const SurveyPage = lazy(() => import('./pages/SurveyPage'));
const SystemPage = lazy(() => import('./pages/SystemPage'));

const STORAGE_KEY = 'rtb-os-business-unit';

function getSurveyTokenFromLocation() {
  const pathMatch = /^\/survey\/([^/]+)\/?$/.exec(window.location.pathname);
  if (pathMatch?.[1]) return decodeURIComponent(pathMatch[1]);

  const params = new URLSearchParams(window.location.search);
  return params.get('survey') || params.get('survey_token') || '';
}

export default function App() {
  const auth = useAuth();
  useSyncAuthProfile(auth.profile, auth.loading);
  const [userPreferences, setUserPreferences] = useUserPreferences(auth.user?.id);
  const surveyToken = getSurveyTokenFromLocation();
  const [activePage, setActivePage] = useState('dashboard');
  const [selectedBusinessUnitId, setSelectedBusinessUnitId] = useState(() =>
    window.localStorage.getItem(STORAGE_KEY),
  );
  const [probationBanner, setProbationBanner] = useState('');
  const autoGraduatingRef = useRef(false);
  const appEnabled = auth.isConfigured && Boolean(auth.session) && canUseApp(auth.profile);
  const data = useRtbData(selectedBusinessUnitId, appEnabled, auth.profile);
  useLiveRefresh({
    enabled: appEnabled,
    loading: data.loading,
    refresh: data.refresh,
    scope: `${auth.user?.id || 'anon'}-${selectedBusinessUnitId || 'none'}`,
  });
  useSquareAutoSync({
    businessUnit: data.selectedBusinessUnit,
    enabled: appEnabled && !data.loading && canManageAppointments(auth.profile),
    refresh: data.refresh,
    squareStatus: data.squareStatus,
  });
  const navItems = useMemo(() => getAllowedNavItems(auth.profile), [auth.profile]);
  const businessOptions = useMemo(
    () => getBusinessSelectionOptions(data.businessUnits, auth.profile),
    [auth.profile, data.businessUnits],
  );
  const unreadAnnouncementCount = useMemo(() => {
    const announcements = data.staffHub?.announcements || [];
    const readIds = new Set(
      (data.staffHub?.announcementReads || []).map((read) => read.announcement_id),
    );
    return announcements.filter((item) => !readIds.has(item.id)).length;
  }, [data.staffHub]);
  const navBadges = useMemo(
    () => ({ 'staff-hub': unreadAnnouncementCount }),
    [unreadAnnouncementCount],
  );

  useEffect(() => {
    const selectedExists = businessOptions.some((unit) => unit.id === selectedBusinessUnitId);
    if (data.businessUnits.length && (!selectedBusinessUnitId || !selectedExists)) {
      setSelectedBusinessUnitId(businessOptions[0]?.id || data.businessUnits[0].id);
    }
  }, [businessOptions, data.businessUnits, selectedBusinessUnitId]);

  useEffect(() => {
    if (selectedBusinessUnitId) {
      window.localStorage.setItem(STORAGE_KEY, selectedBusinessUnitId);
    }
  }, [selectedBusinessUnitId]);

  useEffect(() => {
    if (auth.profile && !canAccessPage(auth.profile, activePage)) {
      setActivePage(navItems[0]?.id || 'my-role');
    }
  }, [activePage, auth.profile, navItems]);

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
  }, [activePage, auth.profile, data.loading, data.refresh, data.staff]);

  const pageProps = useMemo(
    () => ({
      actionCenter: data.actionCenter,
      instagramInsights: data.instagramInsights,
      businessUnit: data.selectedBusinessUnit,
      businessUnits: data.businessUnits,
      businessOptions,
      isAllBusinessesView: isAllBusinessesUnit(data.selectedBusinessUnit),
      masterDashboard: data.masterDashboard,
      masterDashboardUpdatedAt: data.masterDashboardUpdatedAt,
      onRefresh: data.refresh,
      payrollRuns: data.payrollRuns,
      monthlyPerformanceSummary: data.monthlyPerformanceSummary,
      navItems,
      performanceSummary: data.performanceSummary,
      setActivePage,
      squareStatus: data.squareStatus,
      staff: data.staff,
      staffActivityReviewSummary: data.staffActivityReviewSummary,
      staffHub: data.staffHub,
      staffPortalSummary: data.staffPortalSummary,
      staffBusinessMetadata: data.staffBusinessMetadata,
      accessProfile: auth.profile,
      setUserPreferences,
      user: auth.user,
      userPreferences,
      warnings: data.warnings,
    }),
    [auth.profile, auth.user, businessOptions, data, navItems, setUserPreferences, userPreferences],
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
          <ModuleGate module="access">
            <AccessPage
              accessProfile={auth.profile}
              businessUnits={data.businessUnits}
              currentUserId={auth.user?.id}
            />
          </ModuleGate>
        );
      case 'action-center':
        return (
          <ModuleGate module="operations">
            <ActionCenterPage {...pageProps} />
          </ModuleGate>
        );
      case 'ai-consultant':
        return (
          <ModuleGate module="operations">
            <AiConsultantPage {...pageProps} />
          </ModuleGate>
        );
      case 'payroll':
        return (
          <ModuleGate module="payroll">
            <PayrollPage {...pageProps} />
          </ModuleGate>
        );
      case 'staff':
        return (
          <ModuleGate module="roster">
            <StaffPage {...pageProps} />
          </ModuleGate>
        );
      case 'staff-hub':
        return (
          <ModuleGate module="staff_hub">
            <StaffHubPage {...pageProps} />
          </ModuleGate>
        );
      case 'performance':
        return (
          <ModuleGate module="performance">
            <PerformancePage {...pageProps} />
          </ModuleGate>
        );
      case 'customer-intelligence':
        return (
          <ModuleGate module="performance">
            <CustomerIntelligencePage {...pageProps} />
          </ModuleGate>
        );
      case 'operations':
        return (
          <ModuleGate module="operations">
            <OperationsPage {...pageProps} />
          </ModuleGate>
        );
      case 'system':
        return (
          <ModuleGate module="settings">
            <SystemPage {...pageProps} />
          </ModuleGate>
        );
      case 'my-role':
        return <MyRolePage {...pageProps} />;
      case 'dashboard':
      default:
        return (
          <ModuleGate module="dashboard">
            <DashboardPage {...pageProps} />
          </ModuleGate>
        );
    }
  }

  if (auth.loading) {
    return <LoadingState />;
  }

  if (surveyToken) {
    return (
      <Suspense fallback={<LoadingState label="Loading feedback survey" />}>
        <SurveyPage token={surveyToken} />
      </Suspense>
    );
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
      businessOptions={businessOptions}
      navBadges={navBadges}
      navItems={navItems}
      onRefresh={data.refresh}
      profile={auth.profile}
      selectedBusinessUnitId={selectedBusinessUnitId}
      setActivePage={setActivePage}
      setSelectedBusinessUnitId={setSelectedBusinessUnitId}
      signOut={auth.signOut}
      user={auth.user}
      userPreferences={userPreferences}
    >
      {isAllBusinessesId(selectedBusinessUnitId) ? (
        <div className="alert warning global-alert">
          <strong>All Businesses view</strong>
          <span>Combined reporting. Choose one business before editing records.</span>
        </div>
      ) : null}
      {probationBanner ? <div className="alert success global-alert">{probationBanner}</div> : null}
      {data.warnings.length ? (
        <div className="alert warning global-alert">
          <strong>Some live data could not load.</strong>
          <span>{data.warnings.join(' ')}</span>
          <button className="ghost-button small" type="button" onClick={data.refresh}>
            Retry
          </button>
        </div>
      ) : null}
      <Suspense fallback={<LoadingState label="Loading page" />}>
        {renderPage()}
      </Suspense>
    </AppShell>
  );
}
