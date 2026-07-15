import { useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck,
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
  FileText,
  Megaphone,
  Palette,
  ShieldCheck,
  TrendingUp,
  UserRound,
  WalletCards,
  X,
} from 'lucide-react';
import DataTable from '../components/DataTable';
import EmptyState from '../components/EmptyState';
import MetricCard from '../components/MetricCard';
import StatusBadge from '../components/StatusBadge';
import { getEffectivePermissionsPayload, isOwnerProfile } from '../lib/permissions';
import {
  decideContentSubmission,
  decideTimeOffRequest,
  markStaffAnnouncementRead,
  saveContentSubmission,
  saveMyStaffPortalProfile,
  saveStaff,
  saveStaffAnnouncement,
  saveStaffAvailability,
  saveStaffNewsletter,
  saveStaffTask,
  saveTimeOffRequest,
  updateStaffTaskStatus,
} from '../services/rtbService';
import { canManageOperations } from '../utils/access';
import { normalizeActionCenterState } from '../utils/actionCenter';
import { getBusinessProfile, isAllBusinessesUnit } from '../utils/businessProfiles';
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

const TABS = [
  { id: 'home', label: 'Home' },
  { id: 'money', label: 'Money' },
  { id: 'stats', label: 'Stats' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'more', label: 'More' },
];

const EMPTY_STAFF_HUB = {
  announcementReads: [],
  announcements: [],
  availability: [],
  contentSubmissions: [],
  newsletters: [],
  tasks: [],
  timeOffRequests: [],
};

const ANNOUNCEMENT_CATEGORIES = ['policy', 'schedule', 'promotion', 'training', 'event', 'reminder'];
const TASK_CATEGORIES = ['cleaning', 'opening', 'closing', 'content', 'restocking', 'client_followup', 'general'];
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

function sum(rows, field) {
  return rows.reduce((total, row) => total + Number(row[field] || 0), 0);
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

export default function StaffHubPage({
  actionCenter,
  accessProfile,
  businessUnit,
  businessUnits,
  masterDashboard,
  masterDashboardUpdatedAt,
  navItems,
  onRefresh,
  payrollRuns,
  performanceSummary,
  setActivePage,
  staff,
  staffHub = EMPTY_STAFF_HUB,
  staffPortalSummary,
  user,
}) {
  const [activeTab, setActiveTab] = useState('home');
  const [hubMessage, setHubMessage] = useState('');
  const [hubError, setHubError] = useState('');
  const [savingHubAction, setSavingHubAction] = useState('');
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
  const allBusinessesView = isAllBusinessesUnit(businessUnit);
  const businessProfile = getBusinessProfile(businessUnit);
  useEffect(() => {
    setProfileForm(createProfileForm(staffProfile, user));
    setProfileTheme(readSavedTheme(user, staffProfile));
    const savedGoal = readMonthlyGoal(user, staffProfile);
    setMonthlyRevenueGoal(savedGoal);
    setMonthlyRevenueGoalDraft(String(savedGoal));
  }, [staffProfile, user]);
  const activeStaffCount = staff.filter((member) => member.active).length;
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
  const performanceTotal = sum(performanceSummary, 'total_net_sales');
  const nextTask = pendingTasks.find((task) => isOverdueTask(task)) || pendingTasks[0] || null;
  const latestUpdate = visibleAnnouncements.find((announcement) => announcement.pinned) || visibleAnnouncements[0] || null;
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
  const homeStats = useMemo(() => {
    if (!staffProfile) {
      return [
        { label: 'Active staff', value: formatNumber(activeStaffCount), note: 'Selected view' },
        { label: 'Businesses', value: formatNumber(businessCards.length), note: allBusinessesView ? 'Combined' : 'Selected business' },
        { label: 'Payroll runs', value: formatNumber(payrollRuns.length), note: 'Saved history' },
        { label: 'Recorded sales', value: formatCurrency(performanceTotal), note: 'Performance summary' },
      ];
    }

    return [
      {
        label: 'Latest take-home',
        note: latestEntry?.week_label || 'No payroll entry yet',
        value: latestEntry ? formatCurrency(latestEntry.take_home) : 'Waiting',
      },
      {
        label: '$500 floor',
        note: 'Latest payroll entry',
        value: latestEntry
          ? incomeOpportunity.achievedFloor
            ? 'Met'
            : `${formatCurrency(incomeOpportunity.needToFloor)} short`
          : 'Waiting',
      },
      {
        label: 'RTB Score',
        note: rtbScore.score ? 'Performance health' : 'Needs history',
        value: rtbScore.score ? `${rtbScore.score}/100` : 'N/A',
      },
      {
        label: 'Today',
        note: 'Imported appointments',
        value: `${formatNumber(todayStats.appointmentsToday)} appt${todayStats.appointmentsToday === 1 ? '' : 's'}`,
      },
    ];
  }, [
    activeStaffCount,
    allBusinessesView,
    businessCards.length,
    incomeOpportunity,
    latestEntry,
    payrollRuns.length,
    performanceTotal,
    rtbScore.score,
    staffProfile,
    todayStats.appointmentsToday,
  ]);
  const FocusIcon = focusCard.icon;
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
        {
          description: 'Imported appointments and schedule data',
          icon: CalendarDays,
          id: 'insights',
          label: 'Schedule',
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

  function canOpenTool(tool) {
    return Boolean(tool.tab) || canOpen(tool.id);
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
    if (!staffProfile) return;
    await runHubAction(
      `read-${announcementId}`,
      () => markStaffAnnouncementRead(announcementId, staffProfile.id),
      'Update marked as read.',
    );
  }

  async function submitAvailability(event) {
    event.preventDefault();
    if (!staffProfile) return;
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
    if (!staffProfile) return;
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
    if (!staffProfile) return;
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
    if (!staffProfile) return;
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

      <section className="metrics-grid full-span">
        <MetricCard
          icon={WalletCards}
          label={staffProfile ? 'Latest take-home' : 'Active staff'}
          trend={staffProfile ? latestEntry?.week_label || 'No payroll entry yet' : 'Across selected view'}
          value={staffProfile ? formatCurrency(latestEntry?.take_home) : formatNumber(activeStaffCount)}
        />
        <MetricCard
          icon={CircleDollarSign}
          label={staffProfile ? 'Total take-home' : 'Payroll runs'}
          trend={staffProfile ? `${formatNumber(ownEntries.length)} recorded weeks` : 'Saved payroll history'}
          value={staffProfile ? formatCurrency(totalTakeHome) : formatNumber(payrollRuns.length)}
        />
        <MetricCard
          icon={TrendingUp}
          label={staffProfile ? 'Recorded sales' : 'Recorded sales'}
          trend={ownPerformance ? `${ownPerformance.weeks_recorded || 0} performance weeks` : 'Performance summary'}
          value={formatCurrency(staffProfile ? ownPerformance?.total_net_sales : performanceTotal)}
        />
        <MetricCard
          icon={BadgeCheck}
          label={staffProfile ? 'Business rank' : 'Businesses'}
          trend={businessUnit?.name || 'Assigned business'}
          value={staffProfile ? (rank ? `#${rank}` : 'N/A') : formatNumber(businessCards.length)}
        />
      </section>

      <section className="panel full-span staff-hub-tabs-panel">
        <div className="staff-hub-tabs" role="tablist" aria-label="Staff Hub sections">
          {TABS.map((tab) => (
            <button
              aria-selected={activeTab === tab.id}
              className={activeTab === tab.id ? 'active' : ''}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      {activeTab === 'home' ? (
        <>
          <section className="panel two-thirds staff-hub-priority-panel">
            <div className="section-header">
              <div>
                <span>Start here</span>
                <h2>What matters right now</h2>
              </div>
              <FocusIcon size={20} />
            </div>
            <article className={`staff-hub-priority-card ${focusCard.value === 'Overdue' ? 'urgent' : ''}`}>
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
            <div className="staff-hub-home-stat-grid">
              {homeStats.map((stat) => (
                <div key={stat.label}>
                  <span>{stat.label}</span>
                  <strong>{stat.value}</strong>
                  <small>{stat.note}</small>
                </div>
              ))}
            </div>
          </section>

          <section className="panel staff-hub-home-side">
            <div className="section-header">
              <div>
                <span>Snapshot</span>
                <h2>{staffProfile ? 'My profile' : 'Portal setup'}</h2>
              </div>
              <StatusBadge tone={staffProfile?.active || ownerView ? 'success' : 'muted'}>
                {staffProfile?.active ? 'Active' : ownerView ? 'Ready' : 'Inactive'}
              </StatusBadge>
            </div>
            <div className="role-summary-list compact">
              <div>
                <span>Business</span>
                <strong>
                  {ownerView && !staffProfile
                    ? allBusinessesView
                      ? 'Staff see assigned businesses'
                      : businessUnit?.name
                    : businessUnit?.name || staffProfile?.primary_business_name || 'Not set'}
                </strong>
              </div>
              <div>
                <span>Role</span>
                <strong>{staffProfile?.role || accessProfile?.role_title || 'Staff'}</strong>
              </div>
              <div>
                <span>Commission</span>
                <strong>
                  {staffProfile
                    ? staffProfile.fixed_rate
                      ? 'Fixed rate'
                      : `${staffProfile.commission_rate || 0}%`
                    : 'Set in roster'}
                </strong>
              </div>
            </div>
            <div className="staff-hub-side-stack">
              {nextTask ? (
                <article className="staff-hub-side-card">
                  <span>{isOverdueTask(nextTask) ? 'Overdue task' : 'Next task'}</span>
                  <strong>{nextTask.title}</strong>
                  <small>{nextTask.due_date ? `Due ${formatDate(nextTask.due_date)}` : formatCategory(nextTask.category)}</small>
                  <button className="ghost-button small" type="button" onClick={() => setActiveTab('more')}>
                    Open tasks
                  </button>
                </article>
              ) : (
                <article className="staff-hub-side-card quiet">
                  <span>Tasks</span>
                  <strong>No open tasks</strong>
                  <small>Assigned work will appear here.</small>
                </article>
              )}
              {latestUpdate ? (
                <article className="staff-hub-side-card">
                  <span>{latestUpdate.pinned ? 'Pinned update' : 'Latest update'}</span>
                  <strong>{latestUpdate.title}</strong>
                  <small>{formatDate(latestUpdate.created_at)}</small>
                </article>
              ) : null}
            </div>
          </section>

          <section className="panel full-span staff-hub-nav-panel">
            <div className="section-header">
              <div>
                <span>Navigate</span>
                <h2>Open what you need</h2>
              </div>
              <ChevronRight size={20} />
            </div>
            <div className="staff-hub-home-nav-grid">
              {quickTools.map((tool) => {
                const Icon = tool.icon;
                return (
                  <button
                    className="staff-hub-tool"
                    disabled={!canOpenTool(tool)}
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
            </div>
          </section>

            {actionItems.length ? (
            <section className="panel full-span staff-hub-attention-panel">
                <div className="staff-hub-preview-list__header">
                  <strong>Needs attention</strong>
                  <button type="button" onClick={() => openPage('action-center')} disabled={!canOpen('action-center')}>
                    View all
                  </button>
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

          <section className="panel two-thirds staff-hub-feed-panel">
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
                  {visibleAnnouncements.slice(0, 5).map((announcement) => {
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

      {activeTab === 'money' ? (
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
            </div>
          ) : (
            <EmptyState
              icon={TrendingUp}
              title="No performance summary yet"
              message="Saved performance data connected to your staff profile will show here."
            />
          )}
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
              {moreOptions.map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    className="staff-hub-more-card"
                    disabled={!canOpen(option.id)}
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
