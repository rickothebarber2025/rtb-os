import { useEffect, useMemo, useState } from 'react';
import {
  Award,
  BarChart3,
  Bell,
  BookOpen,
  BriefcaseBusiness,
  CalendarDays,
  Camera,
  Check,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  Coffee,
  FileText,
  Home,
  Megaphone,
  MessageSquare,
  MoreHorizontal,
  Palette,
  ShieldCheck,
  Star,
  Target,
  TrendingUp,
  Trophy,
  UserRound,
  WalletCards,
  X,
} from 'lucide-react';
import DataTable from '../components/DataTable';
import EmptyState from '../components/EmptyState';
import MyHoursWidget from '../components/MyHoursWidget';
import OpeningClosingChecklist from '../components/OpeningClosingChecklist';
import StaffSpotlightBoard from '../components/StaffSpotlightBoard';
import StatusBadge from '../components/StatusBadge';
import TipsBreakdown from '../components/TipsBreakdown';
import WeeklyGoalProgress from '../components/WeeklyGoalProgress';
import { getEffectivePermissionsPayload, isOwnerProfile } from '../lib/permissions';
import {
  acknowledgePolicyDocument,
  approveStaffOnboarding,
  closeStaffOnboarding,
  decideContentSubmission,
  decideTimeOffRequest,
  markStaffAnnouncementRead,
  saveStaffProbationReview,
  saveContentSubmission,
  saveMyStaffPortalProfile,
  saveStaff,
  saveStaffAnnouncement,
  saveStaffAvailability,
  saveStaffNewsletter,
  saveStaffOperationsRequest,
  saveStaffTask,
  saveShiftNote,
  saveShopStatusEvent,
  saveTimeOffRequest,
  signOnboardingPolicy,
  submitOnboardingForApproval,
  submitOnboardingQuiz,
  submitOnboardingStage,
  updateStaffTaskStatus,
} from '../services/rtbService';
import { canManageAccess, canManageOperations } from '../utils/access';
import { normalizeActionCenterState } from '../utils/actionCenter';
import { getBusinessProfile, isAllBusinessesUnit } from '../utils/businessProfiles';
import { buildDailyOperationsSummary, getTodayKey as getOperationsTodayKey } from '../utils/dailyOperations';
import { formatCurrency, formatDate, formatDateTime, formatNumber } from '../utils/formatters';
import {
  STAFF_HUB_COMMISSION_TIERS,
  buildCommissionExplanation,
  buildIncomeOpportunity,
  buildMonthlyGoalProgress,
  buildRtbScore,
  buildTodayMoneyStats,
  getDefaultMonthlyGoal,
} from '../utils/staffHubInsights';
import { downloadOnboardingCertificate } from '../utils/certificates';
import {
  buildOnboardingChecklist,
  isOnboardingRestrictedProfile,
  probationReviewDueLabel,
} from '../utils/onboarding';

const TABS = [
  { icon: ClipboardCheck, id: 'daily', label: 'Daily Ops' },
  { icon: Home, id: 'home', label: 'Today' },
  { icon: CircleDollarSign, id: 'money', label: 'Earnings' },
  { icon: TrendingUp, id: 'stats', label: 'Performance' },
  { icon: CalendarDays, id: 'schedule', label: 'Schedule' },
  { icon: MoreHorizontal, id: 'more', label: 'More' },
];

// Updates, Spotlight, and Tips are still real destinations (activeTab can
// still be set to any of them, and their content blocks are unchanged) --
// they're just reached via a sub-nav inside their related primary tab now
// instead of taking up their own slot in the main tab bar, which is what
// was actually crowded. This map is only for which primary tab should
// show as "active" while on one of these secondary pages.
const TAB_PARENT = {
  spotlight: 'home',
  tips: 'money',
  updates: 'home',
};

const EMPTY_STAFF_HUB = {
  announcementReads: [],
  announcements: [],
  auditLogs: [],
  availability: [],
  checklistRuns: [],
  checklistTemplates: [],
  contentSubmissions: [],
  newsletters: [],
  onboardingCertificates: [],
  onboardingInvitations: [],
  onboardingPolicySignatures: [],
  onboardingQuizAttempts: [],
  onboardingStageProgress: [],
  operationsRequests: [],
  policyAcknowledgements: [],
  policyDocuments: [],
  probationReviews: [],
  shiftNotes: [],
  shiftRecords: [],
  shopStatusEvents: [],
  tasks: [],
  timeOffRequests: [],
};

const ANNOUNCEMENT_CATEGORIES = ['policy', 'schedule', 'promotion', 'training', 'event', 'reminder'];
const TASK_CATEGORIES = ['cleaning', 'opening', 'closing', 'content', 'restocking', 'client_followup', 'general'];
const OPERATIONS_REQUEST_TYPES = ['maintenance', 'inventory', 'incident'];
const SHOP_STATUSES = ['closed', 'opening', 'open', 'busy', 'closing', 'after_hours'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const PROFILE_THEME_OPTIONS = [
  { id: 'business', label: 'Business', description: 'Use the selected business style.' },
  { id: 'rose', label: 'Navy', description: 'Deep RTB navy workspace.' },
  { id: 'gold', label: 'White', description: 'Clean RTB white emphasis.' },
  { id: 'sage', label: 'Classic', description: 'Quiet navy operations view.' },
  { id: 'sky', label: 'Paper', description: 'Light editorial contrast.' },
];

function profileThemeKey(user, staffProfile) {
  return `rtb_staff_hub_theme_${staffProfile?.id || user?.email || 'guest'}`;
}

function readSavedTheme(user, staffProfile) {
  if (typeof window === 'undefined') return 'business';
  try {
    return window.localStorage.getItem(profileThemeKey(user, staffProfile)) || 'business';
  } catch {
    return 'business';
  }
}

function saveThemePreference(user, staffProfile, theme) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(profileThemeKey(user, staffProfile), theme);
  } catch {
    // Local personalization should never block the staff portal.
  }
}

function monthlyGoalKey(user, staffProfile) {
  return `rtb_staff_hub_monthly_goal_${staffProfile?.id || user?.email || 'guest'}`;
}

function readMonthlyGoal(user, staffProfile) {
  if (typeof window === 'undefined') return getDefaultMonthlyGoal();
  try {
    const saved = Number(window.localStorage.getItem(monthlyGoalKey(user, staffProfile)));
    return Number.isFinite(saved) && saved > 0 ? saved : getDefaultMonthlyGoal();
  } catch {
    return getDefaultMonthlyGoal();
  }
}

function saveMonthlyGoal(user, staffProfile, goal) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(monthlyGoalKey(user, staffProfile), String(goal));
  } catch {
    // Personal goal saving should never block the staff portal.
  }
}

function createProfileForm(staffProfile, user) {
  return {
    bio: staffProfile?.bio || '',
    full_name: staffProfile?.full_name || user?.user_metadata?.full_name || '',
    phone: staffProfile?.phone || '',
    photo_url: staffProfile?.photo_url || user?.user_metadata?.avatar_url || '',
    services_text: Array.isArray(staffProfile?.services_offered)
      ? staffProfile.services_offered.join(', ')
      : '',
    social_handle: staffProfile?.social_handle || staffProfile?.instagram_handle || '',
  };
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function getEntryWeekTime(entry) {
  return new Date(entry.week_start || entry.created_at || 0).getTime();
}

function getRunEntryRows(payrollRuns) {
  return payrollRuns.flatMap((run) =>
    (run.payroll_entries || []).map((entry) => ({
      ...entry,
      run_status: run.status,
      week_end: run.week_end,
      week_label: run.week_label,
      week_start: run.week_start,
    })),
  );
}

function findStaffProfile({ accessProfile, staff, user }) {
  const email = normalize(accessProfile?.email || user?.email);
  const displayName = normalize(accessProfile?.full_name || user?.user_metadata?.full_name);

  return (
    staff.find((member) => normalize(member.email) === email) ||
    staff.find((member) => normalize(member.full_name) === displayName) ||
    null
  );
}

function entryBelongsToStaff(entry, staffProfile) {
  if (!staffProfile) return false;
  return (
    (entry.staff_id && entry.staff_id === staffProfile.id) ||
    normalize(entry.staff_name_snapshot) === normalize(staffProfile.full_name)
  );
}

function rowBelongsToStaff(row, staffProfile) {
  if (!staffProfile) return false;
  return (
    (row.staff_id && row.staff_id === staffProfile.id) ||
    normalize(row.full_name) === normalize(staffProfile.full_name)
  );
}

function recordBelongsToOnboarding(record, invitation) {
  return record?.invitation_id === invitation?.id;
}

function numberInputValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function sum(rows, field) {
  return rows.reduce((total, row) => total + Number(row[field] || 0), 0);
}

function weightedAverage(rows, valueField, countField) {
  const weighted = rows.reduce((total, row) => {
    const value = Number(row[valueField] || 0);
    const count = Number(row[countField] || 0);
    return total + value * count;
  }, 0);
  const count = sum(rows, countField);
  return count ? Number((weighted / count).toFixed(2)) : null;
}

function aggregateActivitySummary(rows) {
  return {
    appointments_created: sum(rows, 'appointments_created'),
    average_rating: weightedAverage(rows, 'average_rating', 'review_count'),
    cancellations: sum(rows, 'cancellations'),
    client_activity: sum(rows, 'client_activity'),
    five_star_reviews: sum(rows, 'five_star_reviews'),
    reschedules: sum(rows, 'reschedules'),
    review_count: sum(rows, 'review_count'),
  };
}

function getRank(performanceSummary, staffProfile) {
  if (!staffProfile) return null;
  const sorted = [...performanceSummary].sort(
    (a, b) => Number(b.total_net_sales || 0) - Number(a.total_net_sales || 0),
  );
  const index = sorted.findIndex((row) => rowBelongsToStaff(row, staffProfile));
  return index >= 0 ? index + 1 : null;
}

function getRows(rows) {
  return Array.isArray(rows) ? rows : [];
}

function initials(name = '') {
  const parts = String(name)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return `${parts[0]?.[0] || 'R'}${parts.length > 1 ? parts[parts.length - 1][0] : ''}`.toUpperCase();
}

function getProfilePhoto(staffProfile, user) {
  return (
    staffProfile?.photo_url ||
    staffProfile?.avatar_url ||
    user?.user_metadata?.avatar_url ||
    user?.user_metadata?.picture ||
    ''
  );
}

function getDashboardScheduleRows(masterDashboard) {
  return [
    ...getRows(masterDashboard?.upcomingAppointments).map((row) => ({ ...row, schedule_type: 'Upcoming' })),
    ...getRows(masterDashboard?.recentTransactions).map((row) => ({ ...row, schedule_type: 'Recent' })),
  ];
}

function scheduleBelongsToStaff(row, staffProfile) {
  if (!staffProfile) return false;
  const staffName = normalize(row.staffer || row.staff || row.staff_name || row.team_member);
  const profileName = normalize(staffProfile.full_name);
  if (!staffName || !profileName) return false;
  return staffName === profileName || staffName.includes(profileName) || profileName.includes(staffName);
}

function manualRecordBelongsToStaff(record, staffProfile) {
  if (!staffProfile) return false;
  return (
    (record.staff_id && record.staff_id === staffProfile.id) ||
    normalize(record.staff_name) === normalize(staffProfile.full_name)
  );
}

function getStaffActionItems(actionCenter, staffProfile, ownerView) {
  const state = normalizeActionCenterState(actionCenter);
  const warnings = state.warnings
    .filter((warning) => !warning.resolved_at)
    .filter((warning) => ownerView || manualRecordBelongsToStaff(warning, staffProfile))
    .map((warning) => ({
      date: warning.date || warning.created_at,
      detail: warning.notes || warning.warning_type || 'Staff warning needs review.',
      id: `warning-${warning.id}`,
      label: 'Warning',
      tone: 'warning',
    }));
  const documents = state.documents
    .filter((document) => !document.resolved_at)
    .filter((document) => ownerView || manualRecordBelongsToStaff(document, staffProfile))
    .map((document) => ({
      date: document.due_date || document.created_at,
      detail: `${document.document_name || 'Document'}${document.staff_name ? ` for ${document.staff_name}` : ''}`,
      id: `document-${document.id}`,
      label: 'Document',
      tone: 'danger',
    }));

  return [...documents, ...warnings].slice(0, 4);
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function weekStartKey() {
  const date = new Date();
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  return date.toISOString().slice(0, 10);
}

function formatCategory(value) {
  return String(value || 'general').replace(/_/g, ' ');
}

function isOverdueTask(task) {
  return task.status !== 'completed' && task.due_date && task.due_date < todayKey();
}

function percentChange(current, previous) {
  const currentValue = Number(current || 0);
  const previousValue = Number(previous || 0);
  if (!previousValue) return null;
  return Math.round(((currentValue - previousValue) / previousValue) * 100);
}

function formatChange(delta) {
  if (!Number.isFinite(delta)) return 'New data';
  return `${delta >= 0 ? '+' : ''}${delta}%`;
}

function trendTone(delta) {
  if (!Number.isFinite(delta)) return 'neutral';
  return delta >= 0 ? 'success' : 'warning';
}

function safeTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(date);
}

function shortWeekLabel(entry) {
  if (entry?.week_label) return entry.week_label.replace(/\s*,\s*\d{4}/g, '');
  if (!entry?.week_start) return 'Week';
  const date = new Date(entry.week_start);
  if (Number.isNaN(date.getTime())) return 'Week';
  return new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short' }).format(date);
}

function scheduleDisplayTime(row) {
  return (
    row.time ||
    row.start_time ||
    row.appointment_time ||
    safeTime(row.start_at || row.starts_at || row.created_at || row.date) ||
    'Time TBD'
  );
}

function shortMonthDay(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short' }).format(date);
}

function recentRangeLabel(days = 28) {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - (days - 1));
  return `${shortMonthDay(start)} - ${shortMonthDay(end)}`;
}

export default function StaffHubPage({
  actionCenter,
  accessProfile,
  businessUnit,
  businessUnits,
  masterDashboard,
  masterDashboardUpdatedAt,
  navItems,
  onRefresh,
  pageTarget,
  payrollRuns,
  performanceSummary,
  setActivePage,
  setStaffHubTab,
  staff,
  staffActivityReviewSummary = [],
  staffHub = EMPTY_STAFF_HUB,
  staffHubTab,
  staffPortalSummary,
  user,
}) {
  // Lifted to App.jsx so the mobile bottom nav can show/control Staff
  // Hub's own tabs directly, instead of the mostly-empty global nav most
  // staff see (they don't have access to Dashboard/Payroll/Roster as
  // top-level pages). Falls back to local state if this page is ever
  // rendered without the lifted props (e.g. in isolation/tests).
  const [localActiveTab, setLocalActiveTab] = useState('daily');
  const activeTab = staffHubTab ?? localActiveTab;
  const setActiveTab = setStaffHubTab ?? setLocalActiveTab;
  const [dailyOpsView, setDailyOpsView] = useState('checklist');
  const [hubMessage, setHubMessage] = useState('');
  const [hubError, setHubError] = useState('');
  const [savingHubAction, setSavingHubAction] = useState('');
  const [onboardingPersonalForm, setOnboardingPersonalForm] = useState({
    availability_notes: '',
    contract_uploaded: false,
    emergency_name: '',
    emergency_phone: '',
    position_title: '',
    start_date: '',
  });
  const [onboardingQuizAnswers, setOnboardingQuizAnswers] = useState({});
  const [onboardingSignatures, setOnboardingSignatures] = useState({});
  const [probationDrafts, setProbationDrafts] = useState({});

  // When something elsewhere in the app links here with a specific tab in
  // mind (e.g. the Priority Board's "Time off request from X"), open that
  // tab instead of the default Daily Ops -- otherwise the approve/decline
  // buttons are two tabs away with no indication of where to look.
  useEffect(() => {
    if (pageTarget && (TABS.some((tab) => tab.id === pageTarget) || TAB_PARENT[pageTarget])) {
      setActiveTab(pageTarget);
    }
  }, [pageTarget]);
  const [announcementForm, setAnnouncementForm] = useState({
    body: '',
    category: 'reminder',
    pinned: false,
    title: '',
  });
  const [availabilityForm, setAvailabilityForm] = useState({
    day_of_week: 1,
    end_time: '17:00',
    note: '',
    start_time: '09:00',
    unavailable: false,
  });
  const [timeOffForm, setTimeOffForm] = useState({
    end_date: '',
    reason: '',
    start_date: '',
  });
  const [taskForm, setTaskForm] = useState({
    category: 'general',
    details: '',
    due_date: '',
    staff_id: '',
    title: '',
  });
  const [operationsRequestForm, setOperationsRequestForm] = useState({
    category: 'general',
    details: '',
    priority: 'normal',
    request_type: 'maintenance',
    title: '',
  });
  const [shiftNoteForm, setShiftNoteForm] = useState({
    note: '',
    visibility: 'team',
  });
  const [newsletterForm, setNewsletterForm] = useState({
    client_feedback: '',
    improvements_needed: '',
    new_services_promos: '',
    published: true,
    reminders: '',
    top_performer_id: '',
    top_performer_note: '',
    week_start: weekStartKey(),
    weekly_goals: '',
  });
  const [contentForm, setContentForm] = useState({
    caption: '',
    content_type: 'work',
    media_type: 'idea',
    media_url: '',
  });
  const [monthlyRevenueGoal, setMonthlyRevenueGoal] = useState(getDefaultMonthlyGoal());
  const [monthlyRevenueGoalDraft, setMonthlyRevenueGoalDraft] = useState(String(getDefaultMonthlyGoal()));
  const [profileForm, setProfileForm] = useState(() => createProfileForm(null, user));
  const [profileTheme, setProfileTheme] = useState('business');
  const summaryStaffProfile = staffPortalSummary?.staff_profile || null;
  const staffProfile = useMemo(
    () => summaryStaffProfile || findStaffProfile({ accessProfile, staff, user }),
    [accessProfile, staff, summaryStaffProfile, user],
  );
  const ownerView = isOwnerProfile(accessProfile);
  const staffOnlyPortal =
    !ownerView && getEffectivePermissionsPayload(accessProfile).role_template === 'staff_portal';
  const canManageHub = ownerView || canManageOperations(accessProfile);
  const canApproveOnboarding = canManageAccess(accessProfile);
  const allBusinessesView = isAllBusinessesUnit(businessUnit);
  const businessProfile = getBusinessProfile(businessUnit);
  useEffect(() => {
    setProfileForm(createProfileForm(staffProfile, user));
    setProfileTheme(readSavedTheme(user, staffProfile));
    const savedGoal = readMonthlyGoal(user, staffProfile);
    setMonthlyRevenueGoal(savedGoal);
    setMonthlyRevenueGoalDraft(String(savedGoal));
  }, [staffProfile, user]);
  const allowedPageIds = useMemo(() => new Set(navItems.map((item) => item.id)), [navItems]);
  const businessCards = useMemo(() => {
    const units = allBusinessesView ? businessUnits : businessUnits?.filter((unit) => unit.id === businessUnit?.id);
    return (units || []).map((unit) => {
      const profile = getBusinessProfile(unit);
      const assignedStaff = staff.filter((member) => member.business_unit_id === unit.id);
      return {
        activeStaff: assignedStaff.filter((member) => member.active).length,
        id: unit.id,
        logoUrl: profile.logo_url,
        name: unit.name,
        platform: profile.booking_platform,
        type: profile.business_type,
      };
    });
  }, [allBusinessesView, businessUnit?.id, businessUnits, staff]);
  const portalPayrollEntries = useMemo(
    () => getRows(staffPortalSummary?.payroll_entries),
    [staffPortalSummary],
  );
  const ownEntries = useMemo(() => {
    if (portalPayrollEntries.length) {
      return [...portalPayrollEntries].sort((a, b) => getEntryWeekTime(b) - getEntryWeekTime(a));
    }

    return getRunEntryRows(payrollRuns)
      .filter((entry) => entryBelongsToStaff(entry, staffProfile))
      .sort((a, b) => getEntryWeekTime(b) - getEntryWeekTime(a));
  }, [payrollRuns, portalPayrollEntries, staffProfile]);
  const ownPerformance = useMemo(
    () =>
      staffPortalSummary?.performance_summary ||
      performanceSummary.find((row) => rowBelongsToStaff(row, staffProfile)) ||
      null,
    [performanceSummary, staffPortalSummary, staffProfile],
  );
  const ownActivityReviewSummary = useMemo(() => {
    if (staffProfile) {
      return staffActivityReviewSummary.find((row) => row.staff_id === staffProfile.id) || null;
    }

    return aggregateActivitySummary(staffActivityReviewSummary || []);
  }, [staffActivityReviewSummary, staffProfile]);
  const scheduleRows = useMemo(
    () =>
      getDashboardScheduleRows(masterDashboard)
        .filter((row) => ownerView || scheduleBelongsToStaff(row, staffProfile))
        .slice(0, 8),
    [masterDashboard, ownerView, staffProfile],
  );
  const actionItems = useMemo(
    () => getStaffActionItems(actionCenter, staffProfile, ownerView),
    [actionCenter, ownerView, staffProfile],
  );
  const hubRecords = {
    ...EMPTY_STAFF_HUB,
    ...(staffHub || {}),
  };
  const restrictedOnboarding = isOnboardingRestrictedProfile(accessProfile);
  const myOnboardingInvitation = useMemo(
    () =>
      hubRecords.onboardingInvitations.find((invitation) =>
        invitation.user_profile_id === accessProfile?.id ||
        (staffProfile?.id && invitation.staff_id === staffProfile.id),
      ) ||
      (restrictedOnboarding ? hubRecords.onboardingInvitations[0] : null),
    [accessProfile?.id, hubRecords.onboardingInvitations, restrictedOnboarding, staffProfile?.id],
  );
  const myOnboardingChecklist = useMemo(
    () =>
      buildOnboardingChecklist({
        policyDocuments: hubRecords.policyDocuments,
        quizAttempts: hubRecords.onboardingQuizAttempts.filter((attempt) =>
          recordBelongsToOnboarding(attempt, myOnboardingInvitation),
        ),
        signatures: hubRecords.onboardingPolicySignatures.filter((signature) =>
          recordBelongsToOnboarding(signature, myOnboardingInvitation),
        ),
        stageProgress: hubRecords.onboardingStageProgress.filter((stage) =>
          recordBelongsToOnboarding(stage, myOnboardingInvitation),
        ),
      }),
    [
      hubRecords.onboardingPolicySignatures,
      hubRecords.onboardingQuizAttempts,
      hubRecords.onboardingStageProgress,
      hubRecords.policyDocuments,
      myOnboardingInvitation,
    ],
  );
  const myOnboardingCertificate = useMemo(
    () =>
      hubRecords.onboardingCertificates.find((certificate) =>
        recordBelongsToOnboarding(certificate, myOnboardingInvitation),
      ) || null,
    [hubRecords.onboardingCertificates, myOnboardingInvitation],
  );
  const managerOnboardingInvitations = useMemo(
    () =>
      canManageHub || canApproveOnboarding
        ? hubRecords.onboardingInvitations.filter((invitation) => {
            if (invitation.status === 'cancelled') return false;
            if (invitation.status !== 'archived') return true;
            return hubRecords.probationReviews.some(
              (review) =>
                review.invitation_id === invitation.id &&
                ['scheduled', 'missed'].includes(review.status),
            );
          })
        : [],
    [
      canApproveOnboarding,
      canManageHub,
      hubRecords.onboardingInvitations,
      hubRecords.probationReviews,
    ],
  );
  useEffect(() => {
    if (!myOnboardingInvitation) return;
    setOnboardingPersonalForm((current) => ({
      ...current,
      availability_notes: myOnboardingInvitation.availability_notes || current.availability_notes || '',
      emergency_name: myOnboardingInvitation.emergency_contact?.name || current.emergency_name || '',
      emergency_phone: myOnboardingInvitation.emergency_contact?.phone || current.emergency_phone || '',
      position_title: myOnboardingInvitation.position_title || current.position_title || staffProfile?.role || '',
      start_date: myOnboardingInvitation.start_date || current.start_date || staffProfile?.start_date || '',
    }));
  }, [myOnboardingInvitation, staffProfile]);
  const operationsBusinessId = staffProfile?.business_unit_id || (!allBusinessesView ? businessUnit?.id : '');
  const operationsTodayKey = getOperationsTodayKey();
  const dailyOperations = useMemo(
    () =>
      buildDailyOperationsSummary({
        checklistRuns: hubRecords.checklistRuns,
        operationsRequests: hubRecords.operationsRequests,
        policyAcknowledgements: hubRecords.policyAcknowledgements,
        policyDocuments: hubRecords.policyDocuments,
        shiftRecords: hubRecords.shiftRecords,
        shopStatusEvents: hubRecords.shopStatusEvents,
        staffId: staffProfile?.id,
        tasks: hubRecords.tasks,
        today: operationsTodayKey,
      }),
    [
      hubRecords.checklistRuns,
      hubRecords.operationsRequests,
      hubRecords.policyAcknowledgements,
      hubRecords.policyDocuments,
      hubRecords.shiftRecords,
      hubRecords.shopStatusEvents,
      hubRecords.tasks,
      operationsTodayKey,
      staffProfile?.id,
    ],
  );
  const readAnnouncementIds = useMemo(
    () => new Set(hubRecords.announcementReads.map((read) => read.announcement_id)),
    [hubRecords.announcementReads],
  );
  const visibleAnnouncements = hubRecords.announcements.slice(0, 8);
  const latestNewsletter = hubRecords.newsletters[0] || null;
  const pendingTasks = hubRecords.tasks.filter((task) => task.status !== 'completed').slice(0, 8);
  const completedTasks = hubRecords.tasks.filter((task) => task.status === 'completed').slice(0, 5);
  const contentSubmissions = hubRecords.contentSubmissions.slice(0, 12);
  const pendingContentSubmissions = hubRecords.contentSubmissions.filter(
    (item) => item.status === 'pending',
  );
  const totalTakeHome = sum(ownEntries, 'take_home');
  const totalTips = sum(ownEntries, 'tips');
  const latestEntry = ownEntries[0] || null;
  const rank = ownPerformance?.rank || getRank(performanceSummary, staffProfile);
  const todayStats = useMemo(
    () => buildTodayMoneyStats({ latestEntry, rank, scheduleRows }),
    [latestEntry, rank, scheduleRows],
  );
  const incomeOpportunity = useMemo(() => buildIncomeOpportunity(latestEntry), [latestEntry]);
  const commissionExplanation = useMemo(
    () => buildCommissionExplanation({ latestEntry, staffProfile }),
    [latestEntry, staffProfile],
  );
  const monthlyGoal = useMemo(
    () => buildMonthlyGoalProgress({ entries: ownEntries, goal: monthlyRevenueGoal }),
    [monthlyRevenueGoal, ownEntries],
  );
  const rtbScore = useMemo(
    () => buildRtbScore({ latestEntry, ownPerformance, rank }),
    [latestEntry, ownPerformance, rank],
  );
  const nextTask = pendingTasks.find((task) => isOverdueTask(task)) || pendingTasks[0] || null;
  const focusCard = useMemo(() => {
    if (!staffProfile && !ownerView) {
      return {
        actionLabel: '',
        description: 'Ask an admin to connect this login to your roster profile so your earnings, schedule, and stats can load.',
        icon: UserRound,
        label: 'Account setup',
        title: 'Connect your staff profile',
        value: 'Needs match',
      };
    }

    if (ownerView && !staffProfile) {
      return {
        actionLabel: allowedPageIds.has('access') ? 'Open Access' : '',
        description: 'Match each staff login to a roster profile so staff can see their own hub without admin permissions.',
        icon: ShieldCheck,
        label: 'Owner setup',
        page: 'access',
        title: 'Finish staff portal setup',
        value: 'Admin',
      };
    }

    if (actionItems.length) {
      return {
        actionLabel: allowedPageIds.has('action-center') ? 'Review alerts' : '',
        description: actionItems[0].detail,
        icon: Bell,
        label: 'Needs attention',
        page: 'action-center',
        title: `${actionItems.length} item${actionItems.length === 1 ? '' : 's'} need review`,
        value: actionItems[0].label,
      };
    }

    if (nextTask) {
      return {
        actionLabel: 'Open More',
        description: nextTask.details || `${formatCategory(nextTask.category)}${nextTask.due_date ? ` due ${formatDate(nextTask.due_date)}` : ''}`,
        icon: ClipboardCheck,
        label: isOverdueTask(nextTask) ? 'Overdue task' : 'Assigned task',
        tab: 'more',
        title: nextTask.title,
        value: isOverdueTask(nextTask) ? 'Overdue' : 'Open',
      };
    }

    if (latestEntry && !incomeOpportunity.achievedFloor) {
      return {
        actionLabel: 'Open Money',
        description: `You are ${formatCurrency(incomeOpportunity.needToFloor)} away from protecting your full commission rate for the latest payroll entry.`,
        icon: CircleDollarSign,
        label: 'Commission floor',
        tab: 'money',
        title: 'Protect your commission rate',
        value: `${formatCurrency(incomeOpportunity.needToFloor)} short`,
      };
    }

    if (rtbScore.score && rtbScore.score < 75) {
      return {
        actionLabel: 'Open Stats',
        description: rtbScore.focus,
        icon: TrendingUp,
        label: 'Growth focus',
        tab: 'stats',
        title: 'Improve this week',
        value: `${rtbScore.score}/100`,
      };
    }

    if (scheduleRows.length) {
      return {
        actionLabel: 'Open Schedule',
        description: 'Review imported appointments, submit availability, or request time off.',
        icon: CalendarDays,
        label: 'Today',
        tab: 'schedule',
        title: 'Check your schedule',
        value: `${formatNumber(todayStats.appointmentsToday)} today`,
      };
    }

    return {
      actionLabel: 'Open Money',
      description: 'Your main money, performance, and schedule cards are ready as soon as new payroll or appointment data is imported.',
      icon: WalletCards,
      label: 'Daily check-in',
      tab: 'money',
      title: 'Keep your numbers current',
      value: latestEntry ? formatCurrency(latestEntry.take_home) : 'Ready',
    };
  }, [
    actionItems,
    allowedPageIds,
    incomeOpportunity,
    latestEntry,
    nextTask,
    ownerView,
    rtbScore,
    scheduleRows.length,
    staffProfile,
    todayStats.appointmentsToday,
  ]);
  const previousEntry = ownEntries[1] || null;
  const latestSalesDelta = percentChange(latestEntry?.net_sales, previousEntry?.net_sales);
  const latestCommissionDelta = percentChange(
    incomeOpportunity.currentCommission,
    previousEntry
      ? Number(previousEntry.net_sales || 0) *
          (Number(previousEntry.applied_commission_rate || previousEntry.base_commission_rate || 0) / 100)
      : 0,
  );
  const latestTipDelta = percentChange(latestEntry?.tips, previousEntry?.tips);
  const latestTakeHomeDelta = percentChange(latestEntry?.take_home, previousEntry?.take_home);
  const reviewCount = Number(ownActivityReviewSummary?.review_count || 0);
  const fiveStarReviews = Number(ownActivityReviewSummary?.five_star_reviews || 0);
  const reviewGoal = {
    remaining: Math.max(0, 10 - fiveStarReviews),
    target: 10,
    percent: Math.min(100, Math.round((fiveStarReviews / 10) * 100)),
  };
  const weeklyTrend = useMemo(() => {
    const rows = ownEntries.slice(0, 7).reverse();
    const maxValue = Math.max(1, ...rows.map((entry) => Number(entry.take_home || 0)));

    return rows.map((entry) => ({
      height: Math.max(10, Math.round((Number(entry.take_home || 0) / maxValue) * 100)),
      label: shortWeekLabel(entry),
      sales: Number(entry.net_sales || 0),
      takeHome: Number(entry.take_home || 0),
      tips: Number(entry.tips || 0),
    }));
  }, [ownEntries]);
  const dailyCards = useMemo(
    () => [
      {
        change: formatChange(latestSalesDelta),
        icon: BarChart3,
        label: 'Latest revenue',
        note: latestEntry?.week_label || 'Waiting for payroll',
        tone: trendTone(latestSalesDelta),
        value: formatCurrency(latestEntry?.net_sales),
      },
      {
        change: formatChange(latestCommissionDelta),
        icon: CircleDollarSign,
        label: 'Commission',
        note: latestEntry
          ? `${latestEntry.applied_commission_rate || latestEntry.base_commission_rate || 0}% applied rate`
          : 'Explained after payroll',
        tone: trendTone(latestCommissionDelta),
        value: formatCurrency(incomeOpportunity.currentCommission),
      },
      {
        change: formatChange(latestTipDelta),
        icon: Star,
        label: 'Tips',
        note: 'Latest saved entry',
        tone: trendTone(latestTipDelta),
        value: formatCurrency(latestEntry?.tips),
      },
      {
        change: `${formatNumber(todayStats.appointmentsToday)} today`,
        icon: CalendarDays,
        label: 'Appointments',
        note: scheduleRows.length ? 'Imported schedule rows' : 'Waiting for import',
        tone: todayStats.appointmentsToday ? 'success' : 'neutral',
        value: formatNumber(scheduleRows.length),
      },
      {
        change: reviewCount ? `${fiveStarReviews} five-star` : 'No reviews yet',
        icon: MessageSquare,
        label: 'Reviews',
        note: ownActivityReviewSummary?.average_rating
          ? `${ownActivityReviewSummary.average_rating}/5 average`
          : 'Booksy + Google',
        tone: fiveStarReviews ? 'success' : 'neutral',
        value: formatNumber(reviewCount),
      },
    ],
    [
      fiveStarReviews,
      incomeOpportunity.currentCommission,
      latestCommissionDelta,
      latestEntry,
      latestSalesDelta,
      latestTipDelta,
      ownActivityReviewSummary,
      reviewCount,
      scheduleRows.length,
      todayStats.appointmentsToday,
    ],
  );
  const reminders = useMemo(() => {
    const items = [];

    if (nextTask) {
      items.push({
        detail: nextTask.due_date ? `Due ${formatDate(nextTask.due_date)}` : formatCategory(nextTask.category),
        icon: ClipboardCheck,
        title: nextTask.title,
        tone: isOverdueTask(nextTask) ? 'danger' : 'gold',
        tab: 'more',
      });
    }

    if (latestEntry && !incomeOpportunity.achievedFloor) {
      items.push({
        detail: `${formatCurrency(incomeOpportunity.needToFloor)} more revenue protects your full rate.`,
        icon: CircleDollarSign,
        title: 'Commission floor',
        tone: 'warning',
        tab: 'money',
      });
    }

    if (reviewGoal.remaining > 0) {
      items.push({
        detail: `${reviewGoal.remaining} more five-star review${reviewGoal.remaining === 1 ? '' : 's'} to hit this goal.`,
        icon: Star,
        title: 'Review goal',
        tone: 'gold',
        tab: 'stats',
      });
    }

    if (scheduleRows.length) {
      items.push({
        detail: `${formatNumber(scheduleRows.length)} imported appointment row${scheduleRows.length === 1 ? '' : 's'} ready to review.`,
        icon: CalendarDays,
        title: 'Check schedule',
        tone: 'success',
        tab: 'schedule',
      });
    }

    if (!items.length) {
      items.push({
        detail: 'New payroll, task, schedule, and review updates will appear here first.',
        icon: Bell,
        title: 'Nothing urgent',
        tone: 'neutral',
        tab: 'home',
      });
    }

    return items.slice(0, 4);
  }, [incomeOpportunity, latestEntry, nextTask, reviewGoal.remaining, scheduleRows.length]);
  const achievementCards = useMemo(
    () => [
      {
        detail: fiveStarReviews >= 5 ? 'Unlocked' : `${Math.max(0, 5 - fiveStarReviews)} more five-star reviews`,
        icon: Star,
        title: '5-star streak',
        unlocked: fiveStarReviews >= 5,
        value: `${formatNumber(fiveStarReviews)}/5`,
      },
      {
        detail: latestEntry && Number(latestEntry.net_sales || 0) >= 1000 ? 'Strong sales week' : 'Hit $1k in a saved week',
        icon: Trophy,
        title: 'High performer',
        unlocked: latestEntry && Number(latestEntry.net_sales || 0) >= 1000,
        value: latestEntry ? formatCurrency(latestEntry.net_sales) : '$0',
      },
      {
        detail: monthlyGoal.percentComplete >= 100 ? 'Monthly goal met' : `${monthlyGoal.percentComplete}% of monthly goal`,
        icon: Target,
        title: 'Goal closer',
        unlocked: monthlyGoal.percentComplete >= 100,
        value: `${monthlyGoal.percentComplete}%`,
      },
      {
        detail: rank && rank <= 3 ? 'Top 3 in selected view' : 'Aim for top 3',
        icon: Award,
        title: 'Leaderboard',
        unlocked: Boolean(rank && rank <= 3),
        value: rank ? `#${rank}` : 'N/A',
      },
    ],
    [fiveStarReviews, latestEntry, monthlyGoal.percentComplete, rank],
  );
  const activityFeed = useMemo(() => {
    const items = [];

    if (latestEntry) {
      items.push({
        date: latestEntry.week_start || latestEntry.created_at,
        detail: `${formatCurrency(latestEntry.take_home)} take-home from ${formatCurrency(latestEntry.net_sales)} sales.`,
        icon: WalletCards,
        id: `payroll-${latestEntry.id || latestEntry.week_label}`,
        title: 'Payroll entry saved',
      });
    }

    visibleAnnouncements.slice(0, 2).forEach((announcement) => {
      items.push({
        date: announcement.created_at,
        detail: announcement.body,
        icon: Megaphone,
        id: `announcement-${announcement.id}`,
        title: announcement.title,
      });
    });

    pendingTasks.slice(0, 2).forEach((task) => {
      items.push({
        date: task.due_date || task.created_at,
        detail: task.details || formatCategory(task.category),
        icon: ClipboardCheck,
        id: `task-${task.id}`,
        title: task.title,
      });
    });

    scheduleRows.slice(0, 2).forEach((row, index) => {
      items.push({
        date: row.date || row.created_at,
        detail: `${row.client || row.customer || 'Client'} · ${row.service || row.item || 'Service'}`,
        icon: CalendarDays,
        id: `schedule-${row.id || index}`,
        title: `${row.schedule_type || 'Appointment'} ${scheduleDisplayTime(row)}`,
      });
    });

    if (reviewCount) {
      items.push({
        date: new Date().toISOString(),
        detail: `${formatNumber(fiveStarReviews)} five-star reviews from ${formatNumber(reviewCount)} total verified reviews.`,
        icon: MessageSquare,
        id: 'reviews-summary',
        title: 'Review momentum updated',
      });
    }

    contentSubmissions.slice(0, 2).forEach((item) => {
      items.push({
        date: item.created_at,
        detail: item.caption || item.media_url || formatCategory(item.content_type),
        icon: Camera,
        id: `content-${item.id}`,
        title: `Content ${item.status || 'submitted'}`,
      });
    });

    return items
      .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
      .slice(0, 6);
  }, [contentSubmissions, fiveStarReviews, latestEntry, pendingTasks, reviewCount, scheduleRows, visibleAnnouncements]);
  const FocusIcon = focusCard.icon;
  const professionalInsightRows = useMemo(() => {
    const rows = [
      {
        action: 'money',
        detail: latestEntry
          ? commissionExplanation.adjusted
            ? `${formatCurrency(commissionExplanation.amountToFloor)} more sales protects the full rate.`
            : `${commissionExplanation.appliedRate || 0}% applied rate is protected.`
          : 'Payroll imports will explain commission automatically.',
        icon: CircleDollarSign,
        label: 'Commission',
        meta: latestEntry?.week_label || 'Latest payroll',
        tone: commissionExplanation.adjusted ? 'warning' : 'success',
        title: latestEntry
          ? commissionExplanation.adjusted
            ? 'Commission adjusted this week'
            : 'Full commission rate active'
          : 'Waiting for payroll',
      },
      {
        action: 'stats',
        detail: reviewCount
          ? `${formatNumber(fiveStarReviews)} five-star reviews · ${reviewGoal.remaining} left for the next goal.`
          : 'Matched Booksy and Google reviews will show here.',
        icon: Star,
        label: 'Reviews',
        meta: ownActivityReviewSummary?.average_rating
          ? `${ownActivityReviewSummary.average_rating}/5 average`
          : 'Booksy + Google',
        tone: fiveStarReviews ? 'success' : 'neutral',
        title: reviewCount ? `${formatNumber(reviewCount)} verified reviews` : 'No reviews yet',
      },
      {
        action: 'schedule',
        detail: scheduleRows.length
          ? `Next: ${scheduleRows[0]?.service || scheduleRows[0]?.item || 'Service'} at ${scheduleDisplayTime(scheduleRows[0])}.`
          : 'Booksy or Square appointment imports will fill this card.',
        icon: CalendarDays,
        label: 'Schedule',
        meta: `${formatNumber(todayStats.appointmentsToday)} today`,
        tone: scheduleRows.length ? 'success' : 'neutral',
        title: scheduleRows.length ? `${formatNumber(scheduleRows.length)} appointment rows` : 'No imported appointments',
      },
      {
        action: nextTask ? 'more' : focusCard.tab || 'home',
        detail: nextTask?.details || focusCard.description,
        icon: nextTask ? ClipboardCheck : FocusIcon,
        label: nextTask ? 'Task' : focusCard.label,
        meta: nextTask?.due_date ? formatDate(nextTask.due_date) : focusCard.value,
        tone: nextTask && isOverdueTask(nextTask) ? 'warning' : 'neutral',
        title: nextTask?.title || focusCard.title,
      },
    ];

    return rows;
  }, [
    FocusIcon,
    commissionExplanation,
    fiveStarReviews,
    focusCard,
    latestEntry,
    nextTask,
    ownActivityReviewSummary,
    reviewCount,
    reviewGoal.remaining,
    scheduleRows,
    todayStats.appointmentsToday,
  ]);
  const clientSignalRows = useMemo(() => {
    const rows = [
      {
        label: 'Appointments',
        value: Number(ownActivityReviewSummary?.appointments_created || scheduleRows.length || 0),
      },
      {
        label: 'Clients',
        value: Number(ownActivityReviewSummary?.client_activity || todayStats.clientsToday || 0),
      },
      {
        label: 'Reviews',
        value: reviewCount,
      },
      {
        label: 'Cancellations',
        value: Number(ownActivityReviewSummary?.cancellations || 0),
      },
    ];
    const maxValue = Math.max(1, ...rows.map((row) => row.value));

    return rows.map((row) => ({
      ...row,
      percent: Math.max(8, Math.round((row.value / maxValue) * 100)),
    }));
  }, [ownActivityReviewSummary, reviewCount, scheduleRows.length, todayStats.clientsToday]);
  const weekComparisons = useMemo(
    () => [
      {
        current: formatCurrency(latestEntry?.net_sales),
        delta: latestSalesDelta,
        label: 'Revenue',
        previous: formatCurrency(previousEntry?.net_sales),
      },
      {
        current: formatCurrency(latestEntry?.take_home),
        delta: latestTakeHomeDelta,
        label: 'Take-home',
        previous: formatCurrency(previousEntry?.take_home),
      },
      {
        current: formatCurrency(latestEntry?.tips),
        delta: latestTipDelta,
        label: 'Tips',
        previous: formatCurrency(previousEntry?.tips),
      },
      {
        current: formatNumber(reviewCount),
        delta: null,
        label: 'Reviews',
        previous: 'Booksy + Google',
      },
    ],
    [latestEntry, latestSalesDelta, latestTakeHomeDelta, latestTipDelta, previousEntry, reviewCount],
  );
  const canOpen = (pageId) => allowedPageIds.has(pageId);
  const profileName = staffProfile?.full_name || accessProfile?.full_name || user?.email || 'My Staff Account';
  const portalMode = staffProfile ? 'My staff portal' : ownerView ? 'Staff portal preview' : 'Staff access setup needed';
  const profilePhoto = getProfilePhoto(staffProfile, user);
  const firstName = String(profileName).split(/\s+/)[0] || 'there';
  const businessThemeClass = businessProfile.portal_theme || 'theme-combined';
  const profileThemeClass = `tone-${profileTheme}`;
  const quickTools = staffOnlyPortal
    ? [
        {
          description: 'Weekly earnings and payroll history',
          icon: CircleDollarSign,
          label: 'Payroll history',
          tab: 'money',
        },
        {
          description: 'Sales, goals, and client performance',
          icon: TrendingUp,
          label: 'Performance',
          tab: 'stats',
        },
        {
          description: 'Availability, time off, and schedule notes',
          icon: CalendarDays,
          label: 'Schedule',
          tab: 'schedule',
        },
        {
          description: 'Profile, content, and personal settings',
          icon: BriefcaseBusiness,
          label: 'Profile tools',
          tab: 'more',
        },
      ]
    : [
        {
          description: 'Role, tier, expectations, and probation status',
          icon: BriefcaseBusiness,
          id: ownerView && !staffProfile ? 'access' : 'my-role',
          label: ownerView && !staffProfile ? 'Access setup' : 'My role',
        },
        {
          description: 'Weekly earnings and payroll history',
          icon: CircleDollarSign,
          id: 'payroll',
          label: 'Payroll history',
        },
        {
          description: 'Sales, rank, goals, and client performance',
          icon: TrendingUp,
          id: 'performance',
          label: 'Performance',
        },
      ];
  const moreOptions = staffOnlyPortal ? [] : [
    {
      description: 'Opening, closing, policies, forms, and operating standards',
      icon: BookOpen,
      id: 'operations',
      label: 'Policies & training',
    },
    {
      description: 'Warnings, missing documents, and follow-up items',
      icon: Bell,
      id: 'action-center',
      label: 'Alerts',
    },
    {
      description: 'Client signals and content ideas from customer trends',
      icon: Camera,
      id: 'customer-intelligence',
      label: 'Content center',
    },
    {
      description: 'Staff profiles, commission levels, assignments, and status',
      icon: UserRound,
      id: 'staff',
      label: 'Team',
    },
    {
      description: 'Invite staff and control what each person can access',
      icon: ShieldCheck,
      id: 'access',
      label: 'Access',
    },
    {
      description: 'Imported reports, diagnostics, and export tools',
      icon: FileText,
      id: 'system',
      label: 'System tools',
    },
  ];
  const visibleQuickTools = quickTools.filter((tool) => Boolean(tool.tab) || canOpen(tool.id));
  const visibleMoreOptions = moreOptions.filter((option) => canOpen(option.id));

  async function runHubAction(actionKey, action, successMessage) {
    setHubError('');
    setHubMessage('');
    setSavingHubAction(actionKey);
    try {
      await action();
      setHubMessage(successMessage);
      await onRefresh?.();
    } catch (err) {
      setHubError(err.message || 'Unable to save Staff Hub update.');
    } finally {
      setSavingHubAction('');
    }
  }

  function openPage(pageId) {
    if (canOpen(pageId)) setActivePage(pageId);
  }

  function openTool(tool) {
    if (tool.tab) {
      setActiveTab(tool.tab);
      return;
    }

    openPage(tool.id);
  }

  function updateAnnouncementForm(field, value) {
    setAnnouncementForm((current) => ({ ...current, [field]: value }));
  }

  function updateAvailabilityForm(field, value) {
    setAvailabilityForm((current) => ({ ...current, [field]: value }));
  }

  function updateTimeOffForm(field, value) {
    setTimeOffForm((current) => ({ ...current, [field]: value }));
  }

  function updateTaskForm(field, value) {
    setTaskForm((current) => ({ ...current, [field]: value }));
  }

  function updateOperationsRequestForm(field, value) {
    setOperationsRequestForm((current) => ({ ...current, [field]: value }));
  }

  function updateShiftNoteForm(field, value) {
    setShiftNoteForm((current) => ({ ...current, [field]: value }));
  }

  function updateNewsletterForm(field, value) {
    setNewsletterForm((current) => ({ ...current, [field]: value }));
  }

  function updateContentForm(field, value) {
    setContentForm((current) => ({ ...current, [field]: value }));
  }

  function updateProfileForm(field, value) {
    setProfileForm((current) => ({ ...current, [field]: value }));
  }

  function submitMonthlyGoal(event) {
    event.preventDefault();
    const nextGoal = Math.max(1, Number(monthlyRevenueGoalDraft) || getDefaultMonthlyGoal());
    setMonthlyRevenueGoal(nextGoal);
    setMonthlyRevenueGoalDraft(String(nextGoal));
    saveMonthlyGoal(user, staffProfile, nextGoal);
    setHubError('');
    setHubMessage('Monthly revenue goal saved.');
  }

  function chooseProfileTheme(theme) {
    setProfileTheme(theme);
    saveThemePreference(user, staffProfile, theme);
  }

  async function submitAnnouncement(event) {
    event.preventDefault();
    await runHubAction(
      'announcement',
      () =>
        saveStaffAnnouncement({
          ...announcementForm,
          business_unit_id: allBusinessesView ? null : businessUnit?.id,
        }),
      'Announcement posted.',
    );
    setAnnouncementForm({ body: '', category: 'reminder', pinned: false, title: '' });
  }

  async function markAnnouncementRead(announcementId) {
    if (!staffProfile) {
      setHubError('Your staff profile could not be matched yet, so this can\'t be saved. Try refreshing, or ask an admin to check your Staff Hub link.');
      return;
    }
    await runHubAction(
      `read-${announcementId}`,
      () => markStaffAnnouncementRead(announcementId, staffProfile.id),
      'Update marked as read.',
    );
  }

  async function submitAvailability(event) {
    event.preventDefault();
    if (!staffProfile) {
      setHubError('Your staff profile could not be matched yet, so this can\'t be saved. Try refreshing, or ask an admin to check your Staff Hub link.');
      return;
    }
    await runHubAction(
      'availability',
      () =>
        saveStaffAvailability({
          ...availabilityForm,
          business_unit_id: staffProfile.business_unit_id || businessUnit?.id,
          staff_id: staffProfile.id,
        }),
      'Availability saved.',
    );
  }

  async function submitTimeOff(event) {
    event.preventDefault();
    if (!staffProfile) {
      setHubError('Your staff profile could not be matched yet, so this can\'t be saved. Try refreshing, or ask an admin to check your Staff Hub link.');
      return;
    }
    await runHubAction(
      'time-off',
      () =>
        saveTimeOffRequest({
          ...timeOffForm,
          business_unit_id: staffProfile.business_unit_id || businessUnit?.id,
          staff_id: staffProfile.id,
        }),
      'Time-off request sent.',
    );
    setTimeOffForm({ end_date: '', reason: '', start_date: '' });
  }

  async function submitTask(event) {
    event.preventDefault();
    await runHubAction(
      'task',
      () =>
        saveStaffTask({
          ...taskForm,
          business_unit_id: staff.find((member) => member.id === taskForm.staff_id)?.business_unit_id || businessUnit?.id,
        }),
      'Task assigned.',
    );
    setTaskForm({ category: 'general', details: '', due_date: '', staff_id: '', title: '' });
  }

  async function completeTask(task) {
    await runHubAction(
      `task-${task.id}`,
      () => updateStaffTaskStatus(task.id, task.status === 'completed' ? 'pending' : 'completed'),
      task.status === 'completed' ? 'Task reopened.' : 'Task completed.',
    );
  }

  async function updateShopStatus(status) {
    if (!operationsBusinessId) {
      setHubError('Choose one business before changing shop status.');
      return;
    }

    await runHubAction(
      `shop-status-${status}`,
      () =>
        saveShopStatusEvent({
          business_unit_id: operationsBusinessId,
          staff_id: staffProfile?.id || null,
          status,
        }),
      'Shop status updated.',
    );
  }

  async function submitOperationsRequest(event) {
    event.preventDefault();
    if (!operationsBusinessId) {
      setHubError('Choose one business before sending an operations request.');
      return;
    }

    await runHubAction(
      'operations-request',
      () =>
        saveStaffOperationsRequest({
          ...operationsRequestForm,
          business_unit_id: operationsBusinessId,
          staff_id: staffProfile?.id || null,
        }),
      'Operations request submitted.',
    );
    setOperationsRequestForm({
      category: 'general',
      details: '',
      priority: 'normal',
      request_type: 'maintenance',
      title: '',
    });
  }

  async function submitShiftNote(event) {
    event.preventDefault();
    if (!operationsBusinessId) {
      setHubError('Choose one business before saving a shift note.');
      return;
    }

    await runHubAction(
      'shift-note',
      () =>
        saveShiftNote({
          ...shiftNoteForm,
          business_unit_id: operationsBusinessId,
          shift_date: operationsTodayKey,
          staff_id: staffProfile?.id || null,
        }),
      'Shift note saved.',
    );
    setShiftNoteForm({ note: '', visibility: 'team' });
  }

  async function acknowledgePolicy(policyId) {
    if (!staffProfile) {
      setHubError('Your login must be matched to a roster profile before acknowledging policies.');
      return;
    }

    await runHubAction(
      `policy-${policyId}`,
      () => acknowledgePolicyDocument(policyId, staffProfile.id),
      'Policy acknowledged.',
    );
  }

  async function submitNewsletter(event) {
    event.preventDefault();
    await runHubAction(
      'newsletter',
      () =>
        saveStaffNewsletter({
          ...newsletterForm,
          business_unit_id: allBusinessesView ? null : businessUnit?.id,
        }),
      'Newsletter saved.',
    );
  }

  async function submitContent(event) {
    event.preventDefault();
    if (!staffProfile) {
      setHubError('Your staff profile could not be matched yet, so this can\'t be saved. Try refreshing, or ask an admin to check your Staff Hub link.');
      return;
    }
    await runHubAction(
      'content',
      () =>
        saveContentSubmission({
          ...contentForm,
          business_unit_id: staffProfile.business_unit_id || businessUnit?.id,
          staff_id: staffProfile.id,
        }),
      'Content submitted.',
    );
    setContentForm({ caption: '', content_type: 'work', media_type: 'idea', media_url: '' });
  }

  async function submitProfile(event) {
    event.preventDefault();
    if (!staffProfile) {
      setHubError('Your staff profile could not be matched yet, so this can\'t be saved. Try refreshing, or ask an admin to check your Staff Hub link.');
      return;
    }
    const services = profileForm.services_text
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    await runHubAction(
      'profile',
      () => {
        const personalProfile = {
          bio: profileForm.bio,
          phone: profileForm.phone,
          photo_url: profileForm.photo_url,
          services_offered: services,
          social_handle: profileForm.social_handle,
        };

        if (staffOnlyPortal) {
          return saveMyStaffPortalProfile(personalProfile);
        }

        return saveStaff({
          ...staffProfile,
          bio: profileForm.bio,
          full_name: profileForm.full_name || staffProfile.full_name,
          phone: profileForm.phone,
          photo_url: profileForm.photo_url,
          services_offered: services,
          social_handle: profileForm.social_handle,
        });
      },
      'Profile updated.',
    );
  }

  async function decideTimeOff(recordId, status) {
    await runHubAction(
      `time-off-${recordId}`,
      () => decideTimeOffRequest(recordId, status),
      `Time-off request ${status}.`,
    );
  }

  async function decideContent(recordId, status) {
    await runHubAction(
      `content-${recordId}`,
      () => decideContentSubmission(recordId, status),
      `Content ${status}.`,
    );
  }

  async function saveOnboardingStage(stageId, metadata = {}, completed = true) {
    if (!myOnboardingInvitation) return;
    await runHubAction(
      `onboarding-stage-${stageId}`,
      () => submitOnboardingStage(myOnboardingInvitation.id, stageId, metadata, completed),
      completed ? 'Onboarding stage saved.' : 'Onboarding progress saved.',
    );
  }

  async function savePersonalSetup(event) {
    event.preventDefault();
    await saveOnboardingStage('personal_setup', {
      availability_notes: onboardingPersonalForm.availability_notes,
      contract_uploaded: Boolean(onboardingPersonalForm.contract_uploaded),
      emergency_contact: {
        name: onboardingPersonalForm.emergency_name,
        phone: onboardingPersonalForm.emergency_phone,
      },
      position_title: onboardingPersonalForm.position_title,
      start_date: onboardingPersonalForm.start_date,
    });
  }

  async function saveOnboardingQuiz(section) {
    if (!myOnboardingInvitation) return;
    const answers = onboardingQuizAnswers[section.id] || {};
    await runHubAction(
      `onboarding-quiz-${section.id}`,
      () => submitOnboardingQuiz(myOnboardingInvitation.id, section.id, null, section.passingScore, answers),
      'Knowledge check submitted. Your result was calculated securely.',
    );
  }

  async function saveOnboardingSignature(policy) {
    if (!myOnboardingInvitation) return;
    const draft = onboardingSignatures[policy.id] || {};
    await runHubAction(
      `onboarding-sign-${policy.id}`,
      () => signOnboardingPolicy(
        myOnboardingInvitation.id,
        policy.id,
        draft.signer_name || profileName,
        draft.signature_text || draft.signer_name || profileName,
      ),
      'Policy signature recorded.',
    );
  }

  async function submitOnboarding() {
    if (!myOnboardingInvitation) return;
    await runHubAction(
      'onboarding-submit',
      () => submitOnboardingForApproval(myOnboardingInvitation.id),
      'Onboarding submitted for manager approval.',
    );
  }

  async function approveOnboarding(invitation) {
    await runHubAction(
      `onboarding-approve-${invitation.id}`,
      () => approveStaffOnboarding(
        invitation.id,
        invitation.target_permissions,
        invitation.target_permissions?.role_template === 'owner' ? 'admin' : 'staff',
        'Approved from Staff Hub onboarding review.',
      ),
      `${invitation.full_name} has been approved and promoted.`,
    );
  }

  async function closeOnboarding(invitation, status) {
    const action = status === 'archived' ? 'archive' : 'cancel';
    const confirmed = window.confirm(
      status === 'archived'
        ? `Archive ${invitation.full_name}'s completed onboarding record?`
        : `Cancel ${invitation.full_name}'s onboarding and deactivate their restricted login?`,
    );
    if (!confirmed) return;
    await runHubAction(
      `onboarding-close-${invitation.id}`,
      () => closeStaffOnboarding(
        invitation.id,
        status,
        status === 'archived' ? 'Archived after approval.' : 'Cancelled by Access Admin.',
      ),
      `${invitation.full_name}'s onboarding was ${action}d.`,
    );
  }

  async function completePracticalCertification(invitation) {
    await runHubAction(
      `onboarding-practical-${invitation.id}`,
      () => submitOnboardingStage(invitation.id, 'practical_certification', {
        approved_by_manager: true,
        checklist: ['Shop tour', 'Mock booking', 'Mock checkout', 'Opening/closing demonstration', 'Cleaning inspection'],
      }),
      'Practical certification approved.',
    );
  }

  async function downloadCertificate(certificate) {
    await runHubAction(
      `onboarding-certificate-${certificate.id}`,
      () => downloadOnboardingCertificate({ businessUnit, certificate }),
      'Certificate downloaded.',
    );
  }

  function updateProbationDraft(reviewId, field, value) {
    setProbationDrafts((current) => ({
      ...current,
      [reviewId]: {
        ...(current[reviewId] || {}),
        [field]: value,
      },
    }));
  }

  async function saveProbationReview(review) {
    const draft = probationDrafts[review.id] || {};
    await runHubAction(
      `probation-review-${review.id}`,
      () => saveStaffProbationReview(
        review.id,
        {
          attendance: numberInputValue(draft.attendance),
          client_experience: numberInputValue(draft.client_experience),
          policy_compliance: numberInputValue(draft.policy_compliance),
          professionalism: numberInputValue(draft.professionalism),
          service_quality: numberInputValue(draft.service_quality),
        },
        {
          bookings_offered: numberInputValue(draft.bookings_offered),
          content_exposure_count: numberInputValue(draft.content_exposure_count),
          manager_support_notes: draft.manager_support_notes || '',
          qualified_leads_shared: numberInputValue(draft.qualified_leads_shared),
          training_sessions_provided: numberInputValue(draft.training_sessions_provided),
        },
        draft.manager_notes || '',
        draft.recommendation || 'continue',
      ),
      'Probation review saved.',
    );
  }

  function renderOnboardingWorkspace(invitation, checklist, certificate = null) {
    if (!invitation) {
      return (
        <section className="panel full-span onboarding-workspace">
          <div className="alert warning">
            <strong>Onboarding record is not ready yet.</strong>
            <span>Ask a manager to resend the onboarding invitation or refresh Staff Hub.</span>
          </div>
        </section>
      );
    }

    const waitingForManager = invitation.status === 'submitted';
    const approved = invitation.status === 'approved';

    return (
      <section className="panel full-span onboarding-workspace">
        <div className="section-header">
          <div>
            <span>Onboarding — Restricted</span>
            <h2>{approved ? 'Onboarding approved' : waitingForManager ? 'Waiting for manager approval' : 'Complete your RTB onboarding'}</h2>
            <p>
              Finish each stage, pass every knowledge check, sign required policies, then submit for manager approval.
            </p>
          </div>
          <StatusBadge tone={approved ? 'success' : waitingForManager ? 'warning' : 'gold'}>
            {formatCategory(invitation.status)}
          </StatusBadge>
        </div>

        <div className="onboarding-status-grid">
          <article>
            <strong>{checklist.stages.filter((stage) => stage.completed).length}/{checklist.stages.length}</strong>
            <span>Stages complete</span>
          </article>
          <article>
            <strong>{checklist.quizSections.filter((section) => section.passed).length}/{checklist.quizSections.length}</strong>
            <span>Knowledge checks passed</span>
          </article>
          <article>
            <strong>{checklist.signedPolicyCount}/{checklist.policies.length}</strong>
            <span>Policies signed</span>
          </article>
        </div>

        {certificate ? (
          <div className="onboarding-certificate-strip">
            <Award size={20} />
            <span>
              <strong>{certificate.certificate_number}</strong>
              <small>Issued {formatDateTime(certificate.issued_at)}</small>
            </span>
            <button
              className="secondary-button small"
              disabled={savingHubAction === `onboarding-certificate-${certificate.id}`}
              onClick={() => downloadCertificate(certificate)}
              type="button"
            >
              Download certificate
            </button>
          </div>
        ) : null}

        <form className="onboarding-personal-form" onSubmit={savePersonalSetup}>
          <div className="section-header compact">
            <div>
              <span>Personal setup</span>
              <h3>Contact, emergency, position and documents</h3>
            </div>
            <StatusBadge tone={checklist.stages.find((stage) => stage.id === 'personal_setup')?.completed ? 'success' : 'warning'}>
              {checklist.stages.find((stage) => stage.id === 'personal_setup')?.completed ? 'Complete' : 'Required'}
            </StatusBadge>
          </div>
          <div className="form-grid compact">
            <label className="field">
              <span>Position</span>
              <input
                onChange={(event) => setOnboardingPersonalForm((current) => ({ ...current, position_title: event.target.value }))}
                required
                value={onboardingPersonalForm.position_title}
              />
            </label>
            <label className="field">
              <span>Start date</span>
              <input
                onChange={(event) => setOnboardingPersonalForm((current) => ({ ...current, start_date: event.target.value }))}
                required
                type="date"
                value={onboardingPersonalForm.start_date}
              />
            </label>
            <label className="field">
              <span>Emergency contact</span>
              <input
                onChange={(event) => setOnboardingPersonalForm((current) => ({ ...current, emergency_name: event.target.value }))}
                required
                value={onboardingPersonalForm.emergency_name}
              />
            </label>
            <label className="field">
              <span>Emergency phone</span>
              <input
                onChange={(event) => setOnboardingPersonalForm((current) => ({ ...current, emergency_phone: event.target.value }))}
                required
                value={onboardingPersonalForm.emergency_phone}
              />
            </label>
          </div>
          <label className="field">
            <span>Availability notes</span>
            <textarea
              onChange={(event) => setOnboardingPersonalForm((current) => ({ ...current, availability_notes: event.target.value }))}
              value={onboardingPersonalForm.availability_notes}
            />
          </label>
          <label className="check-row">
            <input
              checked={Boolean(onboardingPersonalForm.contract_uploaded)}
              onChange={(event) => setOnboardingPersonalForm((current) => ({ ...current, contract_uploaded: event.target.checked }))}
              type="checkbox"
            />
            <span>Contract and required documents are ready for manager review</span>
          </label>
          <button className="primary-button" disabled={savingHubAction === 'onboarding-stage-personal_setup'} type="submit">
            Save personal setup
          </button>
        </form>

        <div className="onboarding-stage-grid">
          {checklist.stages.filter((stage) => stage.id !== 'personal_setup').map((stage) => (
            <article className={stage.completed ? 'onboarding-stage-card complete' : 'onboarding-stage-card'} key={stage.id}>
              <div>
                <strong>{stage.label}</strong>
                <StatusBadge tone={stage.completed ? 'success' : 'warning'}>
                  {stage.completed ? 'Complete' : 'Open'}
                </StatusBadge>
              </div>
              <ul>
                {stage.items.map((item) => <li key={item}>{item}</li>)}
              </ul>
              {stage.id === 'practical_certification' ? (
                <small className="subtle-text">A manager completes this after the shop walk-through and mock workflow.</small>
              ) : (
                <button
                  className="secondary-button small"
                  disabled={stage.completed || savingHubAction === `onboarding-stage-${stage.id}`}
                  onClick={() => saveOnboardingStage(stage.id, { confirmed_items: stage.items })}
                  type="button"
                >
                  Mark complete
                </button>
              )}
            </article>
          ))}
        </div>

        <div className="onboarding-quiz-grid">
          {checklist.quizSections.map((section) => (
            <article className={section.passed ? 'onboarding-stage-card complete' : 'onboarding-stage-card'} key={section.id}>
              <div>
                <strong>{section.label}</strong>
                <StatusBadge tone={section.passed ? 'success' : 'warning'}>
                  {section.passed ? 'Passed' : `${section.passingScore}% required`}
                </StatusBadge>
              </div>
              {(section.questions || []).map((question) => (
                <label className="field" key={question.id}>
                  <span>{question.prompt}</span>
                  <select
                    onChange={(event) => setOnboardingQuizAnswers((current) => ({
                      ...current,
                      [section.id]: {
                        ...(current[section.id] || {}),
                        [question.id]: event.target.value,
                      },
                    }))}
                    value={onboardingQuizAnswers[section.id]?.[question.id] || ''}
                  >
                    <option value="">Choose an answer</option>
                    {question.options.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
              ))}
              <button
                className="secondary-button small"
                disabled={
                  savingHubAction === `onboarding-quiz-${section.id}` ||
                  (section.questions || []).some((question) => !onboardingQuizAnswers[section.id]?.[question.id])
                }
                onClick={() => saveOnboardingQuiz(section)}
                type="button"
              >
                Submit answers
              </button>
            </article>
          ))}
        </div>

        <div className="onboarding-policy-list">
          <div className="section-header compact">
            <div>
              <span>Policy signatures</span>
              <h3>Sign each active policy version</h3>
            </div>
            <StatusBadge tone={checklist.policies.every((policy) => policy.signed) ? 'success' : 'warning'}>
              {checklist.signedPolicyCount}/{checklist.policies.length}
            </StatusBadge>
          </div>
          {checklist.policies.map((policy) => (
            <article className={policy.signed ? 'onboarding-policy-row signed' : 'onboarding-policy-row'} key={policy.id}>
              <span>
                <strong>{policy.title}</strong>
                <small>{formatCategory(policy.category)} · v{policy.version}</small>
              </span>
              {policy.signed ? (
                <StatusBadge tone="success">Signed</StatusBadge>
              ) : (
                <div className="onboarding-signature-controls">
                  <input
                    onChange={(event) => setOnboardingSignatures((current) => ({
                      ...current,
                      [policy.id]: { ...(current[policy.id] || {}), signer_name: event.target.value },
                    }))}
                    placeholder="Legal name"
                    value={onboardingSignatures[policy.id]?.signer_name || profileName}
                  />
                  <input
                    onChange={(event) => setOnboardingSignatures((current) => ({
                      ...current,
                      [policy.id]: { ...(current[policy.id] || {}), signature_text: event.target.value },
                    }))}
                    placeholder="Type signature"
                    value={onboardingSignatures[policy.id]?.signature_text || ''}
                  />
                  <button
                    className="secondary-button small"
                    disabled={savingHubAction === `onboarding-sign-${policy.id}`}
                    onClick={() => saveOnboardingSignature(policy)}
                    type="button"
                  >
                    Sign
                  </button>
                </div>
              )}
            </article>
          ))}
          {!checklist.policies.length ? (
            <div className="staff-hub-empty-compact">
              <strong>No required policies are active yet.</strong>
              <span>A manager can publish policy documents from Daily Ops.</span>
            </div>
          ) : null}
        </div>

        <div className="onboarding-submit-row">
          <span>
            <strong>{checklist.readyForSubmission ? 'Ready for manager approval' : 'Finish the checklist before submitting'}</strong>
            <small>Full scheduling, payment, and admin access stay locked until approval.</small>
          </span>
          <button
            className="primary-button"
            disabled={!checklist.readyForSubmission || waitingForManager || approved || savingHubAction === 'onboarding-submit'}
            onClick={submitOnboarding}
            type="button"
          >
            Submit for approval
          </button>
        </div>
      </section>
    );
  }

  function renderManagerOnboarding() {
    if (!(canManageHub || canApproveOnboarding) || !managerOnboardingInvitations.length) return null;

    return (
      <section className="panel full-span onboarding-manager-panel">
        <div className="section-header">
          <div>
            <span>Manager onboarding</span>
            <h2>New-hire approval queue</h2>
            <p>Complete practical certification, approve submitted staff, and keep probation reviews documented.</p>
          </div>
          <StatusBadge tone="gold">{managerOnboardingInvitations.length} active</StatusBadge>
        </div>
        <div className="onboarding-manager-list">
          {managerOnboardingInvitations.map((invitation) => {
            const checklist = buildOnboardingChecklist({
              policyDocuments: hubRecords.policyDocuments,
              quizAttempts: hubRecords.onboardingQuizAttempts.filter((attempt) =>
                recordBelongsToOnboarding(attempt, invitation),
              ),
              signatures: hubRecords.onboardingPolicySignatures.filter((signature) =>
                recordBelongsToOnboarding(signature, invitation),
              ),
              stageProgress: hubRecords.onboardingStageProgress.filter((stage) =>
                recordBelongsToOnboarding(stage, invitation),
              ),
            });
            const practicalComplete = checklist.stages.find((stage) => stage.id === 'practical_certification')?.completed;
            const certificate = hubRecords.onboardingCertificates.find((row) => recordBelongsToOnboarding(row, invitation));
            const reviews = hubRecords.probationReviews.filter((review) => recordBelongsToOnboarding(review, invitation));

            return (
              <article className="onboarding-manager-card" key={invitation.id}>
                <div className="onboarding-manager-card__header">
                  <span>
                    <strong>{invitation.full_name}</strong>
                    <small>{invitation.position_title || 'New hire'} · {formatCategory(invitation.status)}</small>
                  </span>
                  <StatusBadge tone={invitation.status === 'submitted' ? 'warning' : invitation.status === 'approved' ? 'success' : 'muted'}>
                    {formatCategory(invitation.target_role_template)}
                  </StatusBadge>
                </div>
                <div className="onboarding-status-grid compact">
                  <article><strong>{checklist.stages.filter((stage) => stage.completed).length}/{checklist.stages.length}</strong><span>Stages</span></article>
                  <article><strong>{checklist.quizSections.filter((section) => section.passed).length}/{checklist.quizSections.length}</strong><span>Quizzes</span></article>
                  <article><strong>{checklist.signedPolicyCount}/{checklist.policies.length}</strong><span>Policies</span></article>
                </div>
                <div className="staff-hub-inline-actions">
                  <button
                    className="secondary-button small"
                    disabled={practicalComplete || savingHubAction === `onboarding-practical-${invitation.id}`}
                    onClick={() => completePracticalCertification(invitation)}
                    type="button"
                  >
                    Approve practical
                  </button>
                  {canApproveOnboarding ? (
                    <button
                      className="primary-button small"
                      disabled={invitation.status !== 'submitted' || savingHubAction === `onboarding-approve-${invitation.id}`}
                      onClick={() => approveOnboarding(invitation)}
                      type="button"
                    >
                      Approve & activate RTB OS
                    </button>
                  ) : null}
                  {certificate ? (
                    <button
                      className="secondary-button small"
                      disabled={savingHubAction === `onboarding-certificate-${certificate.id}`}
                      onClick={() => downloadCertificate(certificate)}
                      type="button"
                    >
                      Certificate
                    </button>
                  ) : null}
                  {canApproveOnboarding ? (
                    <button
                      className="ghost-button small danger"
                      disabled={savingHubAction === `onboarding-close-${invitation.id}`}
                      onClick={() => closeOnboarding(invitation, invitation.status === 'approved' ? 'archived' : 'cancelled')}
                      type="button"
                    >
                      {invitation.status === 'approved' ? 'Archive record' : 'Cancel onboarding'}
                    </button>
                  ) : null}
                </div>
                {reviews.length ? (
                  <div className="probation-review-grid">
                    {reviews.map((review) => {
                      const draft = probationDrafts[review.id] || {};
                      return (
                        <details className="probation-review-card" key={review.id}>
                          <summary>
                            <span>
                              <strong>Day {review.review_day}</strong>
                              <small>{probationReviewDueLabel(review)}</small>
                            </span>
                            <StatusBadge tone={review.status === 'completed' ? 'success' : 'warning'}>
                              {formatCategory(review.status)}
                            </StatusBadge>
                          </summary>
                          <div className="form-grid compact">
                            {['attendance', 'professionalism', 'service_quality', 'client_experience', 'policy_compliance'].map((field) => (
                              <label className="field" key={field}>
                                <span>{formatCategory(field)}</span>
                                <input
                                  max="100"
                                  min="0"
                                  onChange={(event) => updateProbationDraft(review.id, field, event.target.value)}
                                  type="number"
                                  value={draft[field] || review.staff_kpis?.[field] || ''}
                                />
                              </label>
                            ))}
                            {['training_sessions_provided', 'bookings_offered', 'content_exposure_count', 'qualified_leads_shared'].map((field) => (
                              <label className="field" key={field}>
                                <span>{formatCategory(field)}</span>
                                <input
                                  min="0"
                                  onChange={(event) => updateProbationDraft(review.id, field, event.target.value)}
                                  type="number"
                                  value={draft[field] || review.rtb_support_kpis?.[field] || ''}
                                />
                              </label>
                            ))}
                          </div>
                          <label className="field">
                            <span>Manager notes</span>
                            <textarea
                              onChange={(event) => updateProbationDraft(review.id, 'manager_notes', event.target.value)}
                              value={draft.manager_notes || review.manager_notes || ''}
                            />
                          </label>
                          <label className="field">
                            <span>Recommendation</span>
                            <select
                              onChange={(event) => updateProbationDraft(review.id, 'recommendation', event.target.value)}
                              value={draft.recommendation || review.recommendation || 'continue'}
                            >
                              {['advance', 'continue', 'improvement_plan', 'exit'].map((option) => (
                                <option key={option} value={option}>{formatCategory(option)}</option>
                              ))}
                            </select>
                          </label>
                          <button
                            className="secondary-button small"
                            disabled={savingHubAction === `probation-review-${review.id}`}
                            onClick={() => saveProbationReview(review)}
                            type="button"
                          >
                            Save review
                          </button>
                        </details>
                      );
                    })}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>
    );
  }

  if (restrictedOnboarding) {
    return (
      <div className={`page-grid staff-hub-page onboarding-only-page ${businessThemeClass} ${profileThemeClass}`}>
        <section className="hero-panel full-span staff-hub-hero">
          <div className="staff-hub-brand-lockup">
            <div className="staff-hub-logo-stack">
              <div className="staff-hub-logo">
                <img src={businessProfile.logo_url} alt="" />
              </div>
              <div className="staff-hub-avatar" aria-label={profileName}>
                {profilePhoto ? <img src={profilePhoto} alt="" /> : <span>{initials(profileName)}</span>}
              </div>
            </div>
            <div>
              <span className="eyebrow">Onboarding — Restricted</span>
              <h2>Welcome to RTB, {firstName}</h2>
              <p>Complete onboarding before scheduling, payment, client, or admin access is opened.</p>
            </div>
          </div>
          <div className="staff-hub-account-card">
            <div className="staff-hub-account-card__top">
              <UserRound size={18} />
              <StatusBadge tone="warning">Restricted</StatusBadge>
            </div>
            <strong>{accessProfile?.role_title || 'Onboarding'}</strong>
            <span>{businessUnit?.name || 'Assigned business'}</span>
          </div>
        </section>
        {hubError || hubMessage ? (
          <section className="panel full-span staff-hub-alert-panel">
            <div className={`alert ${hubError ? 'danger' : 'success'}`}>
              {hubError || hubMessage}
            </div>
          </section>
        ) : null}
        {renderOnboardingWorkspace(myOnboardingInvitation, myOnboardingChecklist, myOnboardingCertificate)}
      </div>
    );
  }

  return (
    <div className={`page-grid staff-hub-page ${businessThemeClass} ${profileThemeClass}`}>
      <section className="hero-panel full-span staff-hub-hero">
        <div className="staff-hub-brand-lockup">
          <div className="staff-hub-logo-stack">
            <div className="staff-hub-logo">
              <img src={businessProfile.logo_url} alt="" />
            </div>
            <div className="staff-hub-avatar" aria-label={profileName}>
              {profilePhoto ? <img src={profilePhoto} alt="" /> : <span>{initials(profileName)}</span>}
            </div>
          </div>
          <div>
            <span className="eyebrow">{portalMode}</span>
            <h2>Hey {firstName}</h2>
            <p>
              Earnings, performance, schedule, alerts, and business resources for{' '}
              {businessUnit?.name || staffProfile?.primary_business_name || 'your assigned business'}.
            </p>
          </div>
        </div>
        <div className="staff-hub-account-card">
          <div className="staff-hub-account-card__top">
            <UserRound size={18} />
            <StatusBadge tone={staffProfile?.active || ownerView ? 'success' : 'warning'}>
              {staffProfile?.active ? 'Active' : ownerView ? 'Owner preview' : 'Needs match'}
            </StatusBadge>
          </div>
          <strong>{staffProfile?.role || accessProfile?.role_title || 'Staff'}</strong>
          <span>{businessUnit?.name || staffProfile?.primary_business_name || 'Assigned business'}</span>
        </div>
      </section>

      <section className="panel full-span staff-hub-ops-score-strip" aria-label="Daily Operations Score">
        <div className="staff-hub-ops-score-strip__icon">
          <ClipboardCheck size={20} />
        </div>
        <div className="staff-hub-ops-score-strip__body">
          <span>Daily Operations Score</span>
          <strong>{dailyOperations.operationsScore}</strong>
        </div>
        <small>Professionalism today -- checklist, tasks, and shift standards</small>
      </section>

      {renderManagerOnboarding()}

      {!staffProfile && !ownerView ? (
        <section className="panel full-span staff-hub-alert-panel">
          <div className="alert warning">
            <strong>No roster profile matched this login.</strong>
            <span>
              Ask an access admin to connect this login email to the correct staff profile so
              earnings and performance can be shown here.
            </span>
          </div>
        </section>
      ) : null}

      {ownerView && !staffProfile ? (
        <section className="panel full-span staff-hub-alert-panel">
          <div className="alert success">
            <strong>You are viewing the staff portal as the owner.</strong>
            <span>
              Staff will see their own earnings and performance after their login email is matched
              to a roster profile in Access and Roster.
            </span>
          </div>
        </section>
      ) : null}

      {hubError || hubMessage ? (
        <section className="panel full-span staff-hub-alert-panel">
          <div className={`alert ${hubError ? 'danger' : 'success'}`}>
            {hubError || hubMessage}
          </div>
        </section>
      ) : null}

      <section className="full-span staff-hub-pro-dashboard">
        <div className="staff-hub-pro-topbar">
          <div className="staff-hub-pro-title">
            <span>Professional dashboard</span>
            <strong>Insights</strong>
          </div>
          <div className="staff-hub-pro-profile">
            <div>
              <strong>{firstName}</strong>
              <span>{staffProfile?.role || accessProfile?.role_title || 'Staff'}</span>
            </div>
            <div className="staff-hub-pro-avatar">
              {profilePhoto ? <img src={profilePhoto} alt="" /> : <span>{initials(profileName)}</span>}
            </div>
          </div>
        </div>

        <div className="staff-hub-pro-range">
          <span className="staff-hub-pro-pill">Last 28 days</span>
          <span>{recentRangeLabel(28)}</span>
        </div>

        <div className="staff-hub-pro-score-card">
          <div className="staff-hub-pro-score-copy">
            <span>RTB Score</span>
            <strong>{rtbScore.score || '--'}</strong>
            <small>{rtbScore.focus}</small>
          </div>
          <div
            aria-label={`RTB Score ${rtbScore.score} out of 100`}
            className="staff-hub-pro-score-ring"
            style={{ '--score-progress': `${Math.min(100, Number(rtbScore.score || 0))}%` }}
          >
            <span>{rtbScore.score || 0}</span>
          </div>
        </div>

        <div className="staff-hub-pro-metrics" aria-label="Staff Hub quick metrics">
          {dailyCards.slice(0, 4).map((card) => {
            const Icon = card.icon;
            return (
              <article
                className={`staff-hub-pro-metric tone-${card.tone}`}
                key={card.label}
              >
                <Icon size={17} />
                <span>{card.label}</span>
                <strong>{card.value}</strong>
                <small>{card.change}</small>
              </article>
            );
          })}
        </div>

        <div className="staff-hub-pro-section-heading">
          <strong>Popular with your clients</strong>
          <button type="button" onClick={() => setActiveTab('stats')}>
            See all
          </button>
        </div>

        <div className="staff-hub-pro-insight-list">
          {professionalInsightRows.map((row) => {
            const Icon = row.icon;
            return (
              <button
                className={`staff-hub-pro-insight tone-${row.tone}`}
                key={`${row.label}-${row.title}`}
                onClick={() => setActiveTab(row.action)}
                type="button"
              >
                <div className="staff-hub-pro-insight-icon">
                  <Icon size={18} />
                </div>
                <span>
                  <strong>{row.title}</strong>
                  <small>{row.detail}</small>
                  <em>{row.meta}</em>
                </span>
                <ChevronRight size={18} />
              </button>
            );
          })}
        </div>

        <div className="staff-hub-pro-signal-card">
          <div className="staff-hub-pro-section-heading">
            <strong>Client activity</strong>
            <span>{recentRangeLabel(28)}</span>
          </div>
          <div className="staff-hub-pro-signal-list">
            {clientSignalRows.map((row) => (
              <div key={row.label}>
                <span>
                  <strong>{row.label}</strong>
                  <em>{formatNumber(row.value)}</em>
                </span>
                <div>
                  <i style={{ width: `${row.percent}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="panel full-span staff-hub-command-panel">
        <div className="staff-hub-command-header">
          <div className="staff-hub-command-profile">
            <div className="staff-hub-command-avatar">
              {profilePhoto ? <img src={profilePhoto} alt="" /> : <span>{initials(profileName)}</span>}
            </div>
            <div>
              <span className="eyebrow">{portalMode}</span>
              <h2>Welcome back, {firstName}</h2>
              <p>
                One place to check earnings, commission, goals, schedule, reviews, and tasks before the day starts.
              </p>
              <div className="staff-hub-command-badges">
                <StatusBadge tone={staffProfile?.active || ownerView ? 'success' : 'warning'}>
                  {staffProfile?.active ? 'Active staff' : ownerView ? 'Owner preview' : 'Needs profile match'}
                </StatusBadge>
                <StatusBadge tone="gold">
                  {staffProfile?.role || accessProfile?.role_title || 'Staff'}
                </StatusBadge>
                <StatusBadge tone={commissionExplanation.adjusted ? 'warning' : 'success'}>
                  {commissionExplanation.appliedRate || staffProfile?.commission_rate || 0}% commission
                </StatusBadge>
              </div>
            </div>
          </div>

          <article className="staff-hub-score-widget">
            <div>
              <span className="eyebrow">RTB Score</span>
              <strong>{rtbScore.score}</strong>
              <small>{rtbScore.score >= 85 ? 'Excellent' : rtbScore.score >= 70 ? 'Solid' : rtbScore.score ? 'Needs focus' : 'Needs history'}</small>
            </div>
            <div
              aria-label={`RTB Score ${rtbScore.score} out of 100`}
              className="staff-hub-score-ring"
              style={{ '--score-progress': `${Math.min(100, rtbScore.score)}%` }}
            >
              <span>{rtbScore.score}</span>
            </div>
            <p>{rtbScore.focus}</p>
          </article>
        </div>

        <div className="staff-hub-daily-strip" aria-label="Daily Staff Hub metrics">
          {dailyCards.map((card) => {
            const Icon = card.icon;
            return (
              <article className={`staff-hub-daily-card tone-${card.tone}`} key={card.label}>
                <div className="staff-hub-daily-card__icon">
                  <Icon size={18} />
                </div>
                <span>{card.label}</span>
                <strong>{card.value}</strong>
                <small>{card.note}</small>
                <em>{card.change}</em>
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel full-span staff-hub-tabs-panel">
        <div className="staff-hub-tabs" role="tablist" aria-label="Staff Hub sections">
          {TABS.map((tab) => {
            const TabIcon = tab.icon;
            const isActive = (TAB_PARENT[activeTab] || activeTab) === tab.id;
            return (
              <button
                aria-selected={isActive}
                className={isActive ? 'active' : ''}
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                type="button"
              >
                <TabIcon size={16} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </section>

      <nav className="staff-hub-sticky-tabs" role="tablist" aria-label="Staff Hub sections">
        {TABS.map((tab) => {
          const TabIcon = tab.icon;
          const isActive = (TAB_PARENT[activeTab] || activeTab) === tab.id;
          return (
            <button
              aria-selected={isActive}
              className={isActive ? 'active' : ''}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              type="button"
            >
              <TabIcon size={18} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {activeTab === 'daily' ? (
        <>
          <section className="panel full-span daily-ops-hero">
            <div>
              <span className="eyebrow">Daily Operations</span>
              <h2>Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, {firstName}</h2>
              <p>
                Start your shift, check the shop status, finish required tasks, and keep the team updated.
              </p>
            </div>
          </section>

          {!operationsBusinessId ? (
            <section className="panel full-span staff-hub-alert-panel">
              <div className="alert warning">
                <strong>Select one business to use Daily Ops.</strong>
                <span>All Businesses can combine reports, but shifts, checklists, notes, and requests must belong to one shop.</span>
              </div>
            </section>
          ) : null}

          <div className="daily-ops-view-toggle">
            <button
              className={dailyOpsView === 'checklist' ? 'active' : ''}
              onClick={() => setDailyOpsView('checklist')}
              type="button"
            >
              Opening / Closing
            </button>
            <button
              className={dailyOpsView === 'overview' ? 'active' : ''}
              onClick={() => setDailyOpsView('overview')}
              type="button"
            >
              Overview
            </button>
          </div>

          {dailyOpsView === 'checklist' ? (
            <OpeningClosingChecklist businessUnitId={operationsBusinessId} isAdmin={canManageHub} />
          ) : null}

          {dailyOpsView === 'overview' ? (
          <section className="daily-ops-grid full-span">
            <article className="panel daily-ops-card">
              <div className="section-header">
                <div>
                  <span>Shop Status</span>
                  <h2>{dailyOperations.shopStatus.label}</h2>
                </div>
                <StatusBadge tone={dailyOperations.shopStatus.status === 'open' ? 'success' : 'gold'}>
                  {dailyOperations.shopStatus.status}
                </StatusBadge>
              </div>
              <div className="daily-ops-status-grid">
                {SHOP_STATUSES.map((status) => (
                  <button
                    className={dailyOperations.shopStatus.status === status ? 'active' : ''}
                    disabled={!canManageHub || !operationsBusinessId || savingHubAction === `shop-status-${status}`}
                    key={status}
                    onClick={() => updateShopStatus(status)}
                    type="button"
                  >
                    {formatCategory(status)}
                  </button>
                ))}
              </div>
              <small className="subtle-text">
                {dailyOperations.shopStatus.updatedAt
                  ? `Updated ${formatDateTime(dailyOperations.shopStatus.updatedAt)}`
                  : 'No shop status has been recorded yet.'}
              </small>
            </article>

            <MyHoursWidget businessUnitId={operationsBusinessId} staffId={staffProfile?.id} />

            <WeeklyGoalProgress businessUnitId={operationsBusinessId} staffId={staffProfile?.id} />
          </section>
          ) : null}

          {dailyOpsView === 'overview' ? (
          <>
          <section className="daily-ops-grid full-span">
            <article className="panel daily-ops-card daily-ops-card--wide">
              <div className="section-header">
                <div>
                  <span>Required Work</span>
                  <h2>
                    {pendingTasks.length
                      ? `${pendingTasks.length} task${pendingTasks.length === 1 ? '' : 's'} assigned`
                      : 'Nothing assigned'}
                  </h2>
                </div>
                <StatusBadge tone={dailyOperations.overdueTasks.length ? 'danger' : 'success'}>
                  {dailyOperations.overdueTasks.length ? `${dailyOperations.overdueTasks.length} overdue` : 'On track'}
                </StatusBadge>
              </div>
              <p className="subtle-text">
                Assigned cleaning, restocking, follow-up, content, and general tasks live in one place under More.
              </p>
              <button className="secondary-button small" type="button" onClick={() => setActiveTab('more')}>
                View tasks
                <ChevronRight size={16} />
              </button>
            </article>

            <article className="panel daily-ops-card">
              <div className="section-header">
                <div>
                  <span>Policy Center</span>
                  <h2>{dailyOperations.unacknowledgedPolicies.length} need acknowledgement</h2>
                </div>
                <BookOpen size={20} />
              </div>
              <div className="daily-ops-mini-list">
                {dailyOperations.unacknowledgedPolicies.slice(0, 4).map((policy) => (
                  <div key={policy.id}>
                    <strong>{policy.title}</strong>
                    <span>{formatCategory(policy.category)} · v{policy.version}</span>
                    <button
                      className="secondary-button small"
                      disabled={!staffProfile || savingHubAction === `policy-${policy.id}`}
                      onClick={() => acknowledgePolicy(policy.id)}
                      type="button"
                    >
                      Acknowledge
                    </button>
                  </div>
                ))}
                {!dailyOperations.unacknowledgedPolicies.length ? (
                  <div>
                    <strong>All caught up</strong>
                    <span>New handbook and policy acknowledgements will show here.</span>
                  </div>
                ) : null}
              </div>
            </article>
          </section>

          <section className="daily-ops-grid full-span">
            <article className="panel daily-ops-card">
              <div className="section-header">
                <div>
                  <span>Report Something</span>
                  <h2>Maintenance, inventory, incident</h2>
                </div>
                <Megaphone size={20} />
              </div>
              <form className="daily-ops-form" onSubmit={submitOperationsRequest}>
                <div className="form-grid compact">
                  <label className="field">
                    <span>Type</span>
                    <select
                      value={operationsRequestForm.request_type}
                      onChange={(event) => updateOperationsRequestForm('request_type', event.target.value)}
                    >
                      {OPERATIONS_REQUEST_TYPES.map((type) => (
                        <option key={type} value={type}>{formatCategory(type)}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Priority</span>
                    <select
                      value={operationsRequestForm.priority}
                      onChange={(event) => updateOperationsRequestForm('priority', event.target.value)}
                    >
                      {['low', 'normal', 'high', 'urgent'].map((priority) => (
                        <option key={priority} value={priority}>{formatCategory(priority)}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="field">
                  <span>Title</span>
                  <input
                    required
                    value={operationsRequestForm.title}
                    placeholder="Broken chair, need gloves, client issue..."
                    onChange={(event) => updateOperationsRequestForm('title', event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Details</span>
                  <textarea
                    value={operationsRequestForm.details}
                    placeholder="What happened? What is needed? Where is it?"
                    onChange={(event) => updateOperationsRequestForm('details', event.target.value)}
                  />
                </label>
                <button className="primary-button" disabled={!operationsBusinessId || savingHubAction === 'operations-request'} type="submit">
                  Send Request
                </button>
              </form>
            </article>

            <article className="panel daily-ops-card">
              <div className="section-header">
                <div>
                  <span>Shift Notes</span>
                  <h2>Leave context for the team</h2>
                </div>
                <MessageSquare size={20} />
              </div>
              <form className="daily-ops-form" onSubmit={submitShiftNote}>
                <label className="field">
                  <span>Note</span>
                  <textarea
                    required
                    value={shiftNoteForm.note}
                    placeholder="Need towels, chair issue, cash note, reminder for opener..."
                    onChange={(event) => updateShiftNoteForm('note', event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Visibility</span>
                  <select
                    value={shiftNoteForm.visibility}
                    onChange={(event) => updateShiftNoteForm('visibility', event.target.value)}
                  >
                    <option value="team">Team</option>
                    <option value="manager">Manager only</option>
                  </select>
                </label>
                <button className="secondary-button" disabled={!operationsBusinessId || savingHubAction === 'shift-note'} type="submit">
                  Save Note
                </button>
              </form>
            </article>

            <article className="panel daily-ops-card">
              <div className="section-header">
                <div>
                  <span>Live Issues</span>
                  <h2>{dailyOperations.openRequests.length} open</h2>
                </div>
                <Bell size={20} />
              </div>
              <div className="daily-ops-mini-list">
                {dailyOperations.openRequests.slice(0, 5).map((request) => (
                  <div key={request.id}>
                    <strong>{request.title}</strong>
                    <span>{formatCategory(request.request_type)} · {formatCategory(request.priority)} · {formatCategory(request.status)}</span>
                  </div>
                ))}
                {!dailyOperations.openRequests.length ? (
                  <div>
                    <strong>No open issues</strong>
                    <span>Maintenance, inventory, and incident requests will show here.</span>
                  </div>
                ) : null}
              </div>
            </article>
          </section>
          </>
          ) : null}
        </>
      ) : null}

      {activeTab === 'home' ? (
        <>
          <div className="staff-hub-subnav">
            <button className="staff-hub-subnav__link" onClick={() => setActiveTab('updates')} type="button">
              <Megaphone size={14} /> Updates
            </button>
            <button className="staff-hub-subnav__link" onClick={() => setActiveTab('spotlight')} type="button">
              <Trophy size={14} /> Staff of the Month
            </button>
          </div>

          <section className="panel full-span staff-hub-focus-band">
            <article className={`staff-hub-focus-card ${focusCard.value === 'Overdue' ? 'urgent' : ''}`}>
              <div className="staff-hub-priority-icon">
                <FocusIcon size={22} />
              </div>
              <div>
                <span>{focusCard.label}</span>
                <h3>{focusCard.title}</h3>
                <p>{focusCard.description}</p>
              </div>
              <strong>{focusCard.value}</strong>
              {focusCard.actionLabel ? (
                <button
                  className="primary-button"
                  disabled={focusCard.page ? !allowedPageIds.has(focusCard.page) : false}
                  onClick={() => {
                    if (focusCard.tab) setActiveTab(focusCard.tab);
                    if (focusCard.page) openPage(focusCard.page);
                  }}
                  type="button"
                >
                  {focusCard.actionLabel}
                </button>
              ) : null}
            </article>
          </section>

          <section className="staff-hub-dashboard-grid full-span" aria-label="Staff Hub daily dashboard">
            <article className="staff-hub-app-card staff-hub-app-card--wide staff-hub-earnings-card">
              <div className="staff-hub-card-header">
                <div>
                  <span>Earnings overview</span>
                  <h2>{latestEntry ? formatCurrency(latestEntry.take_home) : 'Waiting for payroll'}</h2>
                  <p>{latestEntry?.week_label || 'Saved payroll entries will build this trend.'}</p>
                </div>
                <button className="ghost-button small" type="button" onClick={() => setActiveTab('money')}>
                  Money
                </button>
              </div>
              {weeklyTrend.length ? (
                <div className="staff-hub-mini-chart" role="img" aria-label="Weekly take-home trend">
                  {weeklyTrend.map((point) => (
                    <div className="staff-hub-mini-chart__bar" key={point.label}>
                      <span style={{ height: `${point.height}%` }} />
                      <small>{point.label}</small>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="staff-hub-empty-compact">
                  <WalletCards size={22} />
                  <span>Payroll history will show here after a saved run.</span>
                </div>
              )}
              <div className="staff-hub-card-metrics">
                <div>
                  <span>Total earned</span>
                  <strong>{formatCurrency(totalTakeHome)}</strong>
                </div>
                <div>
                  <span>Total tips</span>
                  <strong>{formatCurrency(totalTips)}</strong>
                </div>
                <div>
                  <span>Recorded weeks</span>
                  <strong>{formatNumber(ownEntries.length)}</strong>
                </div>
              </div>
            </article>

            <article className="staff-hub-app-card staff-hub-goal-summary">
              <div className="staff-hub-card-header">
                <div>
                  <span>Goal progress</span>
                  <h2>{formatCurrency(monthlyGoal.currentRevenue)}</h2>
                  <p>Monthly revenue goal: {formatCurrency(monthlyGoal.goal)}</p>
                </div>
              </div>
              <div className="staff-hub-progress-track">
                <span style={{ width: `${monthlyGoal.percentComplete}%` }} />
              </div>
              <strong>{monthlyGoal.percentComplete}% complete</strong>
              <small>Need {formatCurrency(monthlyGoal.remaining)} more this month.</small>
              <button className="secondary-button" type="button" onClick={() => setActiveTab('money')}>
                Adjust goal
              </button>
            </article>

            <article className="staff-hub-app-card">
              <div className="staff-hub-card-header">
                <div>
                  <span>Reminders</span>
                  <h2>Today’s focus</h2>
                </div>
                <button className="ghost-button small" type="button" onClick={() => setActiveTab('more')}>
                  Tasks
                </button>
              </div>
              <div className="staff-hub-reminder-list">
                {reminders.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      className={`staff-hub-reminder tone-${item.tone}`}
                      key={`${item.title}-${item.detail}`}
                      onClick={() => setActiveTab(item.tab)}
                      type="button"
                    >
                      <Icon size={17} />
                      <span>
                        <strong>{item.title}</strong>
                        <small>{item.detail}</small>
                      </span>
                    </button>
                  );
                })}
              </div>
            </article>

            <article className="staff-hub-app-card">
              <div className="staff-hub-card-header">
                <div>
                  <span>Schedule</span>
                  <h2>Next appointments</h2>
                </div>
                <button className="ghost-button small" type="button" onClick={() => setActiveTab('schedule')}>
                  View
                </button>
              </div>
              {scheduleRows.length ? (
                <div className="staff-hub-schedule-preview">
                  {scheduleRows.slice(0, 4).map((row, index) => (
                    <div key={`${row.date || row.created_at || index}-${row.client || row.service || index}`}>
                      <time>{scheduleDisplayTime(row)}</time>
                      <span>
                        <strong>{row.service || row.item || 'Service'}</strong>
                        <small>{row.client || row.customer || 'Client not listed'}</small>
                      </span>
                      <StatusBadge tone={row.schedule_type === 'Upcoming' ? 'gold' : 'muted'}>
                        {row.schedule_type || 'Imported'}
                      </StatusBadge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="staff-hub-empty-compact">
                  <CalendarDays size={22} />
                  <span>Imported Booksy or Square appointments will appear here.</span>
                </div>
              )}
            </article>

            <article className="staff-hub-app-card">
              <div className="staff-hub-card-header">
                <div>
                  <span>Reviews</span>
                  <h2>
                    {ownActivityReviewSummary?.average_rating
                      ? `${ownActivityReviewSummary.average_rating}/5`
                      : 'Waiting'}
                  </h2>
                  <p>{formatNumber(reviewCount)} verified review{reviewCount === 1 ? '' : 's'}</p>
                </div>
                <MessageSquare size={22} />
              </div>
              <div className="staff-hub-progress-track">
                <span style={{ width: `${reviewGoal.percent}%` }} />
              </div>
              <small>
                {formatNumber(fiveStarReviews)} five-star reviews · {reviewGoal.remaining} left for the next goal.
              </small>
              <button className="secondary-button" type="button" onClick={() => setActiveTab('stats')}>
                Review stats
              </button>
            </article>

            <article className="staff-hub-app-card staff-hub-app-card--wide">
              <div className="staff-hub-card-header">
                <div>
                  <span>Achievements</span>
                  <h2>Progress badges</h2>
                </div>
                <Trophy size={22} />
              </div>
              <div className="staff-hub-achievement-grid">
                {achievementCards.map((achievement) => {
                  const Icon = achievement.icon;
                  return (
                    <div
                      className={achievement.unlocked ? 'staff-hub-achievement unlocked' : 'staff-hub-achievement'}
                      key={achievement.title}
                    >
                      <Icon size={20} />
                      <strong>{achievement.title}</strong>
                      <span>{achievement.value}</span>
                      <small>{achievement.detail}</small>
                    </div>
                  );
                })}
              </div>
            </article>

            <article className="staff-hub-app-card">
              <div className="staff-hub-card-header">
                <div>
                  <span>Week vs previous</span>
                  <h2>Momentum</h2>
                </div>
                <TrendingUp size={22} />
              </div>
              <div className="staff-hub-comparison-list">
                {weekComparisons.map((item) => (
                  <div key={item.label}>
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.previous}</small>
                    </span>
                    <em className={`tone-${trendTone(item.delta)}`}>{formatChange(item.delta)}</em>
                    <b>{item.current}</b>
                  </div>
                ))}
              </div>
            </article>

            <article className="staff-hub-app-card">
              <div className="staff-hub-card-header">
                <div>
                  <span>Activity feed</span>
                  <h2>Latest updates</h2>
                </div>
                <Bell size={22} />
              </div>
              {activityFeed.length ? (
                <div className="staff-hub-activity-feed">
                  {activityFeed.map((item) => {
                    const Icon = item.icon;
                    return (
                      <div key={item.id}>
                        <Icon size={16} />
                        <span>
                          <strong>{item.title}</strong>
                          <small>{item.detail}</small>
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="staff-hub-empty-compact">
                  <Bell size={22} />
                  <span>Updates, tasks, schedule rows, and payroll activity will appear here.</span>
                </div>
              )}
            </article>
          </section>

          <section className="panel full-span staff-hub-nav-panel">
            <div className="section-header">
              <div>
                <span>Navigate</span>
                <h2>Quick tools</h2>
              </div>
              <ChevronRight size={20} />
            </div>
            <div className="staff-hub-home-nav-grid">
              {visibleQuickTools.map((tool) => {
                const Icon = tool.icon;
                return (
                  <button
                    className="staff-hub-tool"
                    key={tool.label}
                    onClick={() => openTool(tool)}
                    type="button"
                  >
                    <Icon size={17} />
                    <span>
                      <strong>{tool.label}</strong>
                      <small>{tool.description}</small>
                    </span>
                    <ChevronRight size={16} />
                  </button>
                );
              })}
              {!visibleQuickTools.length ? (
                <p className="subtle-text">No quick tools are available for this role yet.</p>
              ) : null}
            </div>
          </section>

          <section className="panel full-span staff-hub-motivation-panel">
            <div>
              <span className="eyebrow">Coaching note</span>
              <h2>{rtbScore.focus}</h2>
              <p>
                The fastest path to better income is simple: protect the $500 floor, ask for the review while the client is happiest,
                and rebook before they leave.
              </p>
            </div>
            <button className="primary-button" type="button" onClick={() => setActiveTab('stats')}>
              View recommendations
            </button>
          </section>

            {actionItems.length ? (
          <section className="panel full-span staff-hub-attention-panel">
                <div className="staff-hub-preview-list__header">
                  <strong>Needs attention</strong>
                  {canOpen('action-center') ? (
                    <button type="button" onClick={() => openPage('action-center')}>
                      View all
                    </button>
                  ) : null}
                </div>
                {actionItems.map((item) => (
                  <article className="staff-hub-alert-row" key={item.id}>
                    <StatusBadge tone={item.tone}>{item.label}</StatusBadge>
                    <span>{item.detail}</span>
                    <small>{formatDate(item.date)}</small>
                  </article>
                ))}
            </section>
            ) : null}

          <section className="panel staff-hub-resource-panel">
            <div className="section-header">
              <div>
                <span>Resources</span>
                <h2>{latestNewsletter ? 'Weekly update' : 'Business context'}</h2>
              </div>
              <BookOpen size={20} />
            </div>
            {latestNewsletter ? (
              <div className="staff-hub-newsletter">
                <StatusBadge tone={latestNewsletter.published ? 'success' : 'warning'}>
                  {latestNewsletter.published ? 'Published' : 'Draft'}
                </StatusBadge>
                <h3>Week of {formatDate(latestNewsletter.week_start)}</h3>
                {latestNewsletter.weekly_goals ? <p><strong>Goals:</strong> {latestNewsletter.weekly_goals}</p> : null}
                {latestNewsletter.reminders ? <p><strong>Reminders:</strong> {latestNewsletter.reminders}</p> : null}
                {latestNewsletter.improvements_needed ? <p><strong>Improve:</strong> {latestNewsletter.improvements_needed}</p> : null}
              </div>
            ) : businessCards.length ? (
              <div className="staff-hub-business-grid compact">
                {businessCards.slice(0, 2).map((card) => (
                  <article className="staff-hub-business-card" key={card.id}>
                    <img src={card.logoUrl} alt="" />
                    <div>
                      <strong>{card.name}</strong>
                      <span>{card.type}</span>
                    </div>
                    <small>
                      {formatNumber(card.activeStaff)} active staff · {card.platform}
                    </small>
                  </article>
                ))}
              </div>
            ) : (
              <p className="subtle-text">Resources and weekly updates will show here.</p>
            )}
          </section>
        </>
      ) : null}

      {activeTab === 'updates' ? (
        <>
          <div className="staff-hub-subnav">
            <button className="staff-hub-subnav__link" onClick={() => setActiveTab('home')} type="button">
              <Home size={14} /> Back to Today
            </button>
          </div>
          <section className="panel full-span staff-hub-feed-panel">
          <div className="staff-hub-section-stack">
            <div className="staff-hub-preview-list__header">
              <strong>Updates</strong>
              <span>{formatNumber(visibleAnnouncements.length)} updates</span>
            </div>
            {canManageHub ? (
              <details className="staff-hub-composer">
                <summary>
                  <span>
                    <strong>Post staff update</strong>
                    <small>Share a reminder, policy note, event, or training update.</small>
                  </span>
                  <ChevronRight size={16} />
                </summary>
                <form className="staff-hub-form" onSubmit={submitAnnouncement}>
                  <div className="form-grid compact">
                    <label className="field">
                      <span>Title</span>
                      <input
                        required
                        value={announcementForm.title}
                        onChange={(event) => updateAnnouncementForm('title', event.target.value)}
                        placeholder="Staff reminder"
                      />
                    </label>
                    <label className="field">
                      <span>Category</span>
                      <select
                        value={announcementForm.category}
                        onChange={(event) => updateAnnouncementForm('category', event.target.value)}
                      >
                        {ANNOUNCEMENT_CATEGORIES.map((category) => (
                          <option key={category} value={category}>
                            {formatCategory(category)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label className="field">
                    <span>Message</span>
                    <textarea
                      required
                      rows={3}
                      value={announcementForm.body}
                      onChange={(event) => updateAnnouncementForm('body', event.target.value)}
                      placeholder="Write the update staff should see."
                    />
                  </label>
                  <label className="checkbox-line">
                    <input
                      checked={announcementForm.pinned}
                      onChange={(event) => updateAnnouncementForm('pinned', event.target.checked)}
                      type="checkbox"
                    />
                    Pin this update
                  </label>
                  <button className="primary-button" disabled={savingHubAction === 'announcement'} type="submit">
                    Post update
                  </button>
                </form>
              </details>
            ) : null}
            {visibleAnnouncements.length ? (
              <div className="staff-hub-feed">
                {visibleAnnouncements.map((announcement) => {
                  const isRead = readAnnouncementIds.has(announcement.id);
                  return (
                    <article className={isRead ? 'staff-hub-feed-card read' : 'staff-hub-feed-card'} key={announcement.id}>
                      <div>
                        <StatusBadge tone={announcement.pinned ? 'gold' : 'muted'}>
                          {formatCategory(announcement.category)}
                        </StatusBadge>
                        <small>{formatDate(announcement.created_at)}</small>
                      </div>
                      <h3>{announcement.title}</h3>
                      <p>{announcement.body}</p>
                      {staffProfile ? (
                        <button
                          className="ghost-button small"
                          disabled={isRead || savingHubAction === `read-${announcement.id}`}
                          onClick={() => markAnnouncementRead(announcement.id)}
                          type="button"
                        >
                          {isRead ? 'Read' : 'Mark read'}
                        </button>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                icon={Megaphone}
                title="No staff updates yet"
                message="Admin announcements, policy updates, training reminders, and events will show here."
              />
            )}
          </div>
        </section>
        </>
      ) : null}

      {activeTab === 'spotlight' ? (
        <>
          <div className="staff-hub-subnav">
            <button className="staff-hub-subnav__link" onClick={() => setActiveTab('home')} type="button">
              <Home size={14} /> Back to Today
            </button>
          </div>
          <StaffSpotlightBoard />
        </>
      ) : null}

      {activeTab === 'tips' ? (
        <>
          <div className="staff-hub-subnav">
            <button className="staff-hub-subnav__link" onClick={() => setActiveTab('money')} type="button">
              <CircleDollarSign size={14} /> Back to Earnings
            </button>
          </div>
          <TipsBreakdown businessUnitId={operationsBusinessId} ownEntries={ownEntries} staffId={staffProfile?.id} />
        </>
      ) : null}

      {activeTab === 'money' ? (
        <>
          <div className="staff-hub-subnav">
            <button className="staff-hub-subnav__link" onClick={() => setActiveTab('tips')} type="button">
              <Coffee size={14} /> Tips by shift
            </button>
          </div>

          <section className="panel full-span">
          <div className="section-header">
            <div>
              <span>Weekly earnings</span>
              <h2>Income tracker</h2>
            </div>
            <StatusBadge tone={ownEntries.length ? 'success' : 'muted'}>
              {ownEntries.length ? `${ownEntries.length} weeks` : 'No entries'}
            </StatusBadge>
          </div>
          <div className="staff-hub-money-grid">
            <article className="staff-hub-opportunity-card">
              <span className="eyebrow">Commission opportunity</span>
              {latestEntry ? (
                <>
                  <h3>
                    {incomeOpportunity.achievedFloor
                      ? 'You are above the $500 floor'
                      : `${formatCurrency(incomeOpportunity.needToFloor)} more revenue protects your rate`}
                  </h3>
                  <p>
                    {incomeOpportunity.achievedFloor
                      ? 'Stay consistent, pre-book your next clients, and use one smart add-on conversation per appointment.'
                      : `Potential extra commission if you reach the floor: ${formatCurrency(incomeOpportunity.potentialExtraCommission)}.`}
                  </p>
                  <div className="staff-hub-progress-track" aria-label="Commission floor progress">
                    <span style={{ width: `${Math.min(100, Math.round((Number(latestEntry.net_sales || 0) / incomeOpportunity.floor) * 100))}%` }} />
                  </div>
                  <small>
                    Current week sales: {formatCurrency(latestEntry.net_sales)} · floor: {formatCurrency(incomeOpportunity.floor)}
                  </small>
                </>
              ) : (
                <>
                  <h3>No payroll week yet</h3>
                  <p>Once payroll is saved, RTB OS will show how close you are to the commission floor.</p>
                </>
              )}
            </article>

            <article className="staff-hub-goal-card">
              <span className="eyebrow">Monthly goal</span>
              <div className="staff-hub-goal-ring" style={{ '--goal-progress': `${monthlyGoal.percentComplete}%` }}>
                <strong>{monthlyGoal.percentComplete}%</strong>
                <span>complete</span>
              </div>
              <div>
                <h3>{formatCurrency(monthlyGoal.currentRevenue)} of {formatCurrency(monthlyGoal.goal)}</h3>
                <p>
                  Need {formatCurrency(monthlyGoal.remaining)} more. Average needed per remaining day:{' '}
                  {formatCurrency(monthlyGoal.dailyNeeded)}.
                </p>
              </div>
              <form className="staff-hub-goal-form" onSubmit={submitMonthlyGoal}>
                <label className="field">
                  <span>Goal</span>
                  <input
                    inputMode="numeric"
                    min="1"
                    type="number"
                    value={monthlyRevenueGoalDraft}
                    onChange={(event) => setMonthlyRevenueGoalDraft(event.target.value)}
                  />
                </label>
                <button className="secondary-button" type="submit">Save</button>
              </form>
            </article>
          </div>
          <article className={`staff-hub-commission-card ${commissionExplanation.status}`}>
            <div className="staff-hub-commission-card__header">
              <div>
                <span className="eyebrow">RTB commission structure</span>
                <h3>{commissionExplanation.title}</h3>
                <p>{commissionExplanation.message}</p>
              </div>
              <StatusBadge tone={latestEntry ? (commissionExplanation.adjusted ? 'warning' : 'success') : 'muted'}>
                {latestEntry ? (commissionExplanation.adjusted ? 'Adjusted' : 'Full rate') : 'Waiting'}
              </StatusBadge>
            </div>
            <div className="staff-hub-commission-stats">
              <div>
                <span>Your tier</span>
                <strong>{commissionExplanation.tierLabel}</strong>
                <small>{commissionExplanation.fixedRate ? 'Fixed-rate rule applies' : 'Standard rule applies'}</small>
              </div>
              <div>
                <span>Base rate</span>
                <strong>{commissionExplanation.baseRate || 0}%</strong>
                <small>Rate before weekly floor check</small>
              </div>
              <div>
                <span>Applied rate</span>
                <strong>{commissionExplanation.appliedRate || 0}%</strong>
                <small>{commissionExplanation.adjusted ? `${commissionExplanation.adjustmentPoints} point adjustment` : 'No rate drop'}</small>
              </div>
              <div>
                <span>$500 floor</span>
                <strong>
                  {latestEntry
                    ? commissionExplanation.belowFloor
                      ? `${formatCurrency(commissionExplanation.amountToFloor)} short`
                      : 'Met'
                    : 'Waiting'}
                </strong>
                <small>Weekly net sales requirement</small>
              </div>
              <div>
                <span>Take-home</span>
                <strong>{formatCurrency(commissionExplanation.takeHome)}</strong>
                <small>After tips and $5 entry deduction</small>
              </div>
            </div>
            {latestEntry ? (
              <div className="staff-hub-commission-formula">
                <strong>
                  {formatCurrency(latestEntry.net_sales)} x {commissionExplanation.appliedRate}% +{' '}
                  {formatCurrency(latestEntry.tips)} tips - {formatCurrency(commissionExplanation.deduction)}
                </strong>
                <span>= {formatCurrency(commissionExplanation.takeHome)} take-home</span>
                {commissionExplanation.adjusted ? (
                  <small>
                    This rate adjustment changed commission by {formatCurrency(commissionExplanation.adjustmentImpact)} at current sales.
                    Reaching the $500 floor would add about {formatCurrency(commissionExplanation.projectedFloorGain)} before tips and deduction.
                  </small>
                ) : null}
              </div>
            ) : null}
            <div className="staff-hub-commission-tiers" aria-label="RTB commission tier summary">
              {STAFF_HUB_COMMISSION_TIERS.map((tier) => (
                <div className="staff-hub-commission-tier-chip" key={tier.label}>
                  <strong>{tier.rule}</strong>
                  <span>{tier.label}</span>
                  <small>{tier.note}</small>
                </div>
              ))}
            </div>
          </article>
          {ownEntries.length ? (
            <DataTable>
              <table>
                <thead>
                  <tr>
                    <th>Week</th>
                    <th>Status</th>
                    <th>Sales</th>
                    <th>Tips</th>
                    <th>Commission</th>
                    <th>Take-home</th>
                  </tr>
                </thead>
                <tbody>
                  {ownEntries.map((entry) => (
                    <tr key={`${entry.payroll_run_id || entry.week_label}-${entry.id || entry.staff_name_snapshot}`}>
                      <td>
                        <strong>{entry.week_label || formatDate(entry.week_start)}</strong>
                      </td>
                      <td>
                        <StatusBadge tone={entry.run_status === 'draft' ? 'warning' : 'success'}>
                          {entry.run_status || 'saved'}
                        </StatusBadge>
                      </td>
                      <td>{formatCurrency(entry.net_sales)}</td>
                      <td>{formatCurrency(entry.tips)}</td>
                      <td>
                        <strong>{entry.applied_commission_rate || entry.base_commission_rate || 0}%</strong>
                        <span className="subtle-text">
                          {entry.adjusted
                            ? `Adjusted from ${entry.base_commission_rate || 0}%`
                            : `Base ${entry.base_commission_rate || entry.applied_commission_rate || 0}%`}
                        </span>
                      </td>
                      <td>
                        <strong>{formatCurrency(entry.take_home)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DataTable>
          ) : (
            <EmptyState
              icon={CircleDollarSign}
              title="No payroll entries yet"
              message="Finalized payroll entries connected to your staff profile will show here."
            />
          )}
          {ownEntries.length ? (
            <div className="staff-hub-total">
              <span>Total tips: {formatCurrency(totalTips)}</span>
              <strong>Total take-home: {formatCurrency(totalTakeHome)}</strong>
            </div>
          ) : null}
        </section>
        </>
      ) : null}

      {activeTab === 'stats' ? (
        <section className="panel full-span">
          <div className="section-header">
            <div>
              <span>Performance</span>
              <h2>My performance summary</h2>
            </div>
            {rank ? <StatusBadge tone="gold">Rank #{rank}</StatusBadge> : null}
          </div>
          <article className="staff-hub-score-card">
            <div className="staff-hub-score-card__main">
              <span className="eyebrow">RTB Score</span>
              <strong>{rtbScore.score}/100</strong>
              <p>{rtbScore.focus}</p>
            </div>
            <div className="staff-hub-score-bars">
              {rtbScore.components.map((component) => (
                <div key={component.label}>
                  <span>
                    {component.label}
                    <strong>{component.score}</strong>
                  </span>
                  <div className="staff-hub-progress-track">
                    <span style={{ width: `${Math.min(100, component.score)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </article>
          {ownPerformance ? (
            <div className="staff-hub-performance-grid">
              <div>
                <span>Total sales</span>
                <strong>{formatCurrency(ownPerformance.total_net_sales)}</strong>
              </div>
              <div>
                <span>Average week</span>
                <strong>{formatCurrency(ownPerformance.avg_weekly_net)}</strong>
              </div>
              <div>
                <span>Best week</span>
                <strong>{formatCurrency(ownPerformance.best_week_net)}</strong>
              </div>
              <div>
                <span>Weeks recorded</span>
                <strong>{formatNumber(ownPerformance.weeks_recorded)}</strong>
              </div>
              <div>
                <span>Under minimum</span>
                <strong>{formatNumber(ownPerformance.under_minimum_weeks)}</strong>
              </div>
              <div>
                <span>Total take-home</span>
                <strong>{formatCurrency(ownPerformance.total_take_home)}</strong>
              </div>
              <div>
                <span>Average rating</span>
                <strong>
                  {ownActivityReviewSummary?.average_rating
                    ? `${ownActivityReviewSummary.average_rating}/5`
                    : 'N/A'}
                </strong>
              </div>
              <div>
                <span>5-star reviews</span>
                <strong>{formatNumber(ownActivityReviewSummary?.five_star_reviews || 0)}</strong>
              </div>
            </div>
          ) : (
            <EmptyState
              icon={TrendingUp}
              title="No performance summary yet"
              message="Saved performance data connected to your staff profile will show here."
            />
          )}
          <article className="staff-hub-score-card">
            <div className="staff-hub-score-card__main">
              <span className="eyebrow">Review goal</span>
              <strong>
                <Star size={20} />
                {formatNumber(ownActivityReviewSummary?.review_count || 0)} reviews
              </strong>
              <p>
                Verified Booksy and Google reviews count here after they are auto-matched or approved
                in Customer IQ.
              </p>
            </div>
          </article>
        </section>
      ) : null}

      {activeTab === 'schedule' ? (
        <section className="panel full-span">
          <div className="section-header">
            <div>
              <span>Schedule</span>
              <h2>My appointments</h2>
            </div>
            <StatusBadge tone={scheduleRows.length ? 'success' : 'muted'}>
              {scheduleRows.length ? `${scheduleRows.length} rows` : 'No imported rows'}
            </StatusBadge>
          </div>
          {masterDashboardUpdatedAt ? (
            <p className="staff-hub-import-note">
              Last appointment import: {formatDateTime(masterDashboardUpdatedAt)}
            </p>
          ) : null}
          <div className="staff-hub-split-grid">
            <form className="staff-hub-form" onSubmit={submitAvailability}>
              <div className="section-header compact">
                <div>
                  <span>Availability</span>
                  <h3>Submit weekly availability</h3>
                </div>
              </div>
              <div className="form-grid compact">
                <label className="field">
                  <span>Day</span>
                  <select
                    disabled={!staffProfile}
                    value={availabilityForm.day_of_week}
                    onChange={(event) => updateAvailabilityForm('day_of_week', event.target.value)}
                  >
                    {WEEKDAYS.map((day, index) => (
                      <option key={day} value={index}>
                        {day}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Start</span>
                  <input
                    disabled={!staffProfile || availabilityForm.unavailable}
                    type="time"
                    value={availabilityForm.start_time}
                    onChange={(event) => updateAvailabilityForm('start_time', event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>End</span>
                  <input
                    disabled={!staffProfile || availabilityForm.unavailable}
                    type="time"
                    value={availabilityForm.end_time}
                    onChange={(event) => updateAvailabilityForm('end_time', event.target.value)}
                  />
                </label>
              </div>
              <label className="checkbox-line">
                <input
                  checked={availabilityForm.unavailable}
                  disabled={!staffProfile}
                  onChange={(event) => updateAvailabilityForm('unavailable', event.target.checked)}
                  type="checkbox"
                />
                Not available this day
              </label>
              <label className="field">
                <span>Note</span>
                <input
                  disabled={!staffProfile}
                  value={availabilityForm.note}
                  onChange={(event) => updateAvailabilityForm('note', event.target.value)}
                  placeholder="Optional note"
                />
              </label>
              <button className="primary-button" disabled={!staffProfile || savingHubAction === 'availability'} type="submit">
                Save availability
              </button>
            </form>

            <form className="staff-hub-form" onSubmit={submitTimeOff}>
              <div className="section-header compact">
                <div>
                  <span>Time off</span>
                  <h3>Request time off</h3>
                </div>
              </div>
              <div className="form-grid compact">
                <label className="field">
                  <span>Start date</span>
                  <input
                    disabled={!staffProfile}
                    required
                    type="date"
                    value={timeOffForm.start_date}
                    onChange={(event) => updateTimeOffForm('start_date', event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>End date</span>
                  <input
                    disabled={!staffProfile}
                    required
                    type="date"
                    value={timeOffForm.end_date}
                    onChange={(event) => updateTimeOffForm('end_date', event.target.value)}
                  />
                </label>
              </div>
              <label className="field">
                <span>Reason</span>
                <input
                  disabled={!staffProfile}
                  value={timeOffForm.reason}
                  onChange={(event) => updateTimeOffForm('reason', event.target.value)}
                  placeholder="Optional"
                />
              </label>
              <button className="primary-button" disabled={!staffProfile || savingHubAction === 'time-off'} type="submit">
                Send request
              </button>
            </form>
          </div>

          <div className="staff-hub-section-stack">
            <div className="staff-hub-preview-list__header">
              <strong>Time-off requests</strong>
              <span>{formatNumber(hubRecords.timeOffRequests.length)} total</span>
            </div>
            {hubRecords.timeOffRequests.length ? (
              <div className="staff-hub-list">
                {hubRecords.timeOffRequests.slice(0, 8).map((request) => (
                  <article className="staff-hub-list-row" key={request.id}>
                    <div>
                      <strong>
                        {formatDate(request.start_date)} - {formatDate(request.end_date)}
                      </strong>
                      <small>{request.reason || 'No reason added'}</small>
                    </div>
                    <StatusBadge tone={request.status === 'approved' ? 'success' : request.status === 'denied' ? 'danger' : 'warning'}>
                      {request.status}
                    </StatusBadge>
                    {canManageHub && request.status === 'pending' ? (
                      <div className="staff-hub-inline-actions">
                        <button className="ghost-button small" type="button" onClick={() => decideTimeOff(request.id, 'approved')}>
                          <Check size={14} /> Approve
                        </button>
                        <button className="ghost-button small danger" type="button" onClick={() => decideTimeOff(request.id, 'denied')}>
                          <X size={14} /> Deny
                        </button>
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : (
              <p className="subtle-text">No time-off requests yet.</p>
            )}
          </div>

          {scheduleRows.length ? (
            <DataTable>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Client</th>
                    <th>Service</th>
                    <th>Staff</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {scheduleRows.map((row, index) => (
                    <tr key={`${row.date || row.created_at || index}-${row.client || row.service || index}`}>
                      <td>
                        <strong>{row.date || formatDate(row.created_at)}</strong>
                        <span className="table-subtext">{row.schedule_type}</span>
                      </td>
                      <td>{row.client || row.customer || 'Not listed'}</td>
                      <td>{row.service || row.item || 'Service'}</td>
                      <td>{row.staffer || row.staff || row.staff_name || 'Team'}</td>
                      <td>{row.amount ? formatCurrency(row.amount) : 'Not set'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DataTable>
          ) : (
            <EmptyState
              icon={Clock3}
              title="No schedule rows for this profile yet"
              message="Imported Booksy or Square appointment data connected to this staff profile will show here."
            />
          )}
        </section>
      ) : null}

      {activeTab === 'more' ? (
        <>
          <section className="panel two-thirds">
            <div className="section-header">
              <div>
                <span>More</span>
                <h2>Staff tools and resources</h2>
              </div>
              <ClipboardCheck size={20} />
            </div>
            <div className="staff-hub-more-grid">
              {visibleMoreOptions.map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    className="staff-hub-more-card"
                    key={option.label}
                    onClick={() => openPage(option.id)}
                    type="button"
                  >
                    <Icon size={18} />
                    <span>
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                    </span>
                    <ChevronRight size={16} />
                  </button>
                );
              })}
              {!visibleMoreOptions.length ? (
                <p className="subtle-text">Manager tools are hidden for this role.</p>
              ) : null}
            </div>
          </section>

          <section className="panel">
            <div className="section-header">
              <div>
                <span>Newsletter</span>
                <h2>Weekly update</h2>
              </div>
              <BookOpen size={20} />
            </div>
            {latestNewsletter ? (
              <div className="staff-hub-newsletter">
                <StatusBadge tone={latestNewsletter.published ? 'success' : 'warning'}>
                  {latestNewsletter.published ? 'Published' : 'Draft'}
                </StatusBadge>
                <h3>Week of {formatDate(latestNewsletter.week_start)}</h3>
                {latestNewsletter.weekly_goals ? <p><strong>Goals:</strong> {latestNewsletter.weekly_goals}</p> : null}
                {latestNewsletter.reminders ? <p><strong>Reminders:</strong> {latestNewsletter.reminders}</p> : null}
                {latestNewsletter.client_feedback ? <p><strong>Client feedback:</strong> {latestNewsletter.client_feedback}</p> : null}
                {latestNewsletter.new_services_promos ? <p><strong>New services/promos:</strong> {latestNewsletter.new_services_promos}</p> : null}
                {latestNewsletter.improvements_needed ? <p><strong>Improve:</strong> {latestNewsletter.improvements_needed}</p> : null}
              </div>
            ) : (
              <p className="subtle-text">No newsletter has been published yet.</p>
            )}
          </section>

          {canManageHub ? (
            <section className="panel full-span">
              <div className="section-header">
                <div>
                  <span>Admin</span>
                  <h2>Create weekly newsletter</h2>
                </div>
              </div>
              <form className="staff-hub-form" onSubmit={submitNewsletter}>
                <div className="form-grid compact">
                  <label className="field">
                    <span>Week start</span>
                    <input
                      required
                      type="date"
                      value={newsletterForm.week_start}
                      onChange={(event) => updateNewsletterForm('week_start', event.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>Top performer</span>
                    <select
                      value={newsletterForm.top_performer_id}
                      onChange={(event) => updateNewsletterForm('top_performer_id', event.target.value)}
                    >
                      <option value="">No top performer</option>
                      {staff.filter((member) => member.active).map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.full_name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="form-grid compact">
                  {[
                    ['weekly_goals', 'Weekly business goals'],
                    ['reminders', 'Staff reminders'],
                    ['client_feedback', 'Client feedback'],
                    ['new_services_promos', 'New services/promotions'],
                    ['improvements_needed', 'Improvements needed'],
                    ['top_performer_note', 'Top performer note'],
                  ].map(([field, label]) => (
                    <label className="field" key={field}>
                      <span>{label}</span>
                      <textarea
                        rows={2}
                        value={newsletterForm[field]}
                        onChange={(event) => updateNewsletterForm(field, event.target.value)}
                      />
                    </label>
                  ))}
                </div>
                <label className="checkbox-line">
                  <input
                    checked={newsletterForm.published}
                    onChange={(event) => updateNewsletterForm('published', event.target.checked)}
                    type="checkbox"
                  />
                  Publish to staff
                </label>
                <button className="primary-button" disabled={savingHubAction === 'newsletter'} type="submit">
                  Save newsletter
                </button>
              </form>
            </section>
          ) : null}

          <section className="panel">
            <div className="section-header">
              <div>
                <span>Tasks</span>
                <h2>Assigned work</h2>
              </div>
              <StatusBadge tone={pendingTasks.length ? 'warning' : 'success'}>
                {pendingTasks.length ? `${pendingTasks.length} open` : 'Clear'}
              </StatusBadge>
            </div>
            {canManageHub ? (
              <form className="staff-hub-form" onSubmit={submitTask}>
                <div className="form-grid compact">
                  <label className="field">
                    <span>Assign to</span>
                    <select
                      required
                      value={taskForm.staff_id}
                      onChange={(event) => updateTaskForm('staff_id', event.target.value)}
                    >
                      <option value="">Select staff</option>
                      {staff.filter((member) => member.active).map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.full_name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Category</span>
                    <select
                      value={taskForm.category}
                      onChange={(event) => updateTaskForm('category', event.target.value)}
                    >
                      {TASK_CATEGORIES.map((category) => (
                        <option key={category} value={category}>
                          {formatCategory(category)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Due date</span>
                    <input
                      type="date"
                      value={taskForm.due_date}
                      onChange={(event) => updateTaskForm('due_date', event.target.value)}
                    />
                  </label>
                </div>
                <label className="field">
                  <span>Task</span>
                  <input
                    required
                    value={taskForm.title}
                    onChange={(event) => updateTaskForm('title', event.target.value)}
                    placeholder="Restock towels, post content, follow up with client..."
                  />
                </label>
                <label className="field">
                  <span>Details</span>
                  <textarea
                    rows={2}
                    value={taskForm.details}
                    onChange={(event) => updateTaskForm('details', event.target.value)}
                  />
                </label>
                <button className="primary-button" disabled={savingHubAction === 'task'} type="submit">
                  Assign task
                </button>
              </form>
            ) : null}
            <div className="staff-hub-list">
              {[...pendingTasks, ...completedTasks].map((task) => (
                <article className={isOverdueTask(task) ? 'staff-hub-list-row overdue' : 'staff-hub-list-row'} key={task.id}>
                  <div>
                    <strong>{task.title}</strong>
                    <small>
                      {formatCategory(task.category)}
                      {task.due_date ? ` · due ${formatDate(task.due_date)}` : ''}
                    </small>
                  </div>
                  <StatusBadge tone={task.status === 'completed' ? 'success' : isOverdueTask(task) ? 'danger' : 'warning'}>
                    {task.status === 'completed' ? 'completed' : isOverdueTask(task) ? 'overdue' : 'pending'}
                  </StatusBadge>
                  <button className="ghost-button small" type="button" onClick={() => completeTask(task)}>
                    {task.status === 'completed' ? 'Reopen' : 'Complete'}
                  </button>
                </article>
              ))}
            </div>
            {!pendingTasks.length && !completedTasks.length ? <p className="subtle-text">No assigned tasks yet.</p> : null}
          </section>

          <section className="panel">
            <div className="section-header">
              <div>
                <span>Content Center</span>
                <h2>Submit work</h2>
              </div>
              <Camera size={20} />
            </div>
            <form className="staff-hub-form" onSubmit={submitContent}>
              <div className="form-grid compact">
                <label className="field">
                  <span>Type</span>
                  <select
                    disabled={!staffProfile}
                    value={contentForm.content_type}
                    onChange={(event) => updateContentForm('content_type', event.target.value)}
                  >
                    <option value="work">My work</option>
                    <option value="before_after">Before/after</option>
                    <option value="idea">Content idea</option>
                  </select>
                </label>
                <label className="field">
                  <span>Media type</span>
                  <select
                    disabled={!staffProfile}
                    value={contentForm.media_type}
                    onChange={(event) => updateContentForm('media_type', event.target.value)}
                  >
                    <option value="idea">Idea only</option>
                    <option value="photo">Photo URL</option>
                    <option value="video">Video URL</option>
                  </select>
                </label>
              </div>
              <label className="field">
                <span>Media URL</span>
                <input
                  disabled={!staffProfile || contentForm.media_type === 'idea'}
                  value={contentForm.media_url}
                  onChange={(event) => updateContentForm('media_url', event.target.value)}
                  placeholder="Paste photo/video link"
                />
              </label>
              <label className="field">
                <span>Caption / idea</span>
                <textarea
                  disabled={!staffProfile}
                  required
                  rows={3}
                  value={contentForm.caption}
                  onChange={(event) => updateContentForm('caption', event.target.value)}
                />
              </label>
              <button className="primary-button" disabled={!staffProfile || savingHubAction === 'content'} type="submit">
                Submit content
              </button>
            </form>
            {canManageHub && pendingContentSubmissions.length ? (
              <div className="staff-hub-section-stack">
                <strong>Pending approval</strong>
                <div className="staff-hub-list">
                  {pendingContentSubmissions.slice(0, 6).map((item) => (
                    <article className="staff-hub-list-row" key={item.id}>
                      <div>
                        <strong>{formatCategory(item.content_type)}</strong>
                        <small>{item.caption || item.media_url || 'No caption'}</small>
                      </div>
                      <div className="staff-hub-inline-actions">
                        <button className="ghost-button small" type="button" onClick={() => decideContent(item.id, 'approved')}>
                          <Check size={14} /> Approve
                        </button>
                        <button className="ghost-button small danger" type="button" onClick={() => decideContent(item.id, 'rejected')}>
                          <X size={14} /> Reject
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="staff-hub-chip-row">
              {contentSubmissions.slice(0, 6).map((item) => (
                <StatusBadge key={item.id} tone={item.status === 'approved' ? 'success' : item.status === 'rejected' ? 'danger' : 'warning'}>
                  {formatCategory(item.content_type)} · {item.status}
                </StatusBadge>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="section-header">
              <div>
                <span>Profile</span>
                <h2>Profile & style</h2>
              </div>
              <Palette size={20} />
            </div>
            <div className="staff-hub-profile-editor">
              <article className="staff-hub-profile-card">
                <div className="staff-hub-profile-photo">
                  {profileForm.photo_url ? <img src={profileForm.photo_url} alt="" /> : <span>{initials(profileForm.full_name)}</span>}
                </div>
                <div>
                  <strong>{profileForm.full_name || staffProfile?.full_name || 'Staff profile'}</strong>
                  <span>{staffProfile?.role || accessProfile?.role || 'Staff'}</span>
                  <small>{businessUnit?.name || staffProfile?.primary_business_name || 'Assigned business'}</small>
                </div>
                <p>{profileForm.bio || 'Add a short bio so the profile feels personal.'}</p>
                <div className="staff-hub-chip-row">
                  {(profileForm.services_text || '')
                    .split(',')
                    .map((service) => service.trim())
                    .filter(Boolean)
                    .slice(0, 4)
                    .map((service) => (
                      <StatusBadge key={service} tone="muted">{service}</StatusBadge>
                    ))}
                </div>
              </article>

              <div className="staff-hub-style-panel">
                <div className="section-header compact">
                  <div>
                    <span>Portal vibe</span>
                    <h3>Choose your color</h3>
                  </div>
                </div>
                <div className="staff-hub-theme-options">
                  {PROFILE_THEME_OPTIONS.map((option) => (
                    <button
                      className={profileTheme === option.id ? 'active' : ''}
                      key={option.id}
                      onClick={() => chooseProfileTheme(option.id)}
                      type="button"
                    >
                      <span className={`theme-dot theme-dot--${option.id}`} />
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                    </button>
                  ))}
                </div>
              </div>

              <form className="staff-hub-form staff-hub-profile-form" onSubmit={submitProfile}>
                <div className="form-grid compact">
                  <label className="field">
                    <span>Display name</span>
                    <input
                      disabled={!staffProfile || staffOnlyPortal}
                      value={profileForm.full_name}
                      onChange={(event) => updateProfileForm('full_name', event.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>Phone</span>
                    <input
                      disabled={!staffProfile}
                      value={profileForm.phone}
                      onChange={(event) => updateProfileForm('phone', event.target.value)}
                      placeholder="Staff phone"
                    />
                  </label>
                  <label className="field">
                    <span>Instagram / social</span>
                    <input
                      disabled={!staffProfile}
                      value={profileForm.social_handle}
                      onChange={(event) => updateProfileForm('social_handle', event.target.value)}
                      placeholder="@handle"
                    />
                  </label>
                  <label className="field">
                    <span>Photo URL</span>
                    <input
                      disabled={!staffProfile}
                      value={profileForm.photo_url}
                      onChange={(event) => updateProfileForm('photo_url', event.target.value)}
                      placeholder="https://..."
                    />
                  </label>
                </div>
                <label className="field">
                  <span>Services</span>
                  <input
                    disabled={!staffProfile}
                    value={profileForm.services_text}
                    onChange={(event) => updateProfileForm('services_text', event.target.value)}
                    placeholder="Haircut, beard trim, lashes, nails"
                  />
                </label>
                <label className="field">
                  <span>Bio</span>
                  <textarea
                    disabled={!staffProfile}
                    rows={3}
                    value={profileForm.bio}
                    onChange={(event) => updateProfileForm('bio', event.target.value)}
                    placeholder="A short friendly intro for your staff profile."
                  />
                </label>
                <div className="staff-hub-profile-meta">
                  <span>Start: {formatDate(staffProfile?.start_date)}</span>
                  <span>
                    {staffProfile?.tier === 'probation'
                      ? staffProfile?.probation_end_date
                        ? `Probation ends ${formatDate(staffProfile.probation_end_date)}`
                        : 'Probation tier'
                      : 'Standard profile'}
                  </span>
                </div>
                <button className="primary-button" disabled={!staffProfile || savingHubAction === 'profile'} type="submit">
                  Save profile
                </button>
              </form>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
