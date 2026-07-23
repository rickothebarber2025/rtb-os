import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getAppSettingRecord,
  getBoothRent,
  getInstagramInsights,
  getBusinessUnits,
  getMonthlyPerformanceSummary,
  getMyStaffPortalSummary,
  getPayrollRuns,
  getPerformanceSummary,
  getSquareStatus,
  getStaff,
  getStaffActivityReviewSummary,
  getStaffHubRecords,
} from '../services/rtbService';
import { ACTION_CENTER_SETTING_KEY, normalizeActionCenterState } from '../utils/actionCenter';
import { canUsePayroll } from '../utils/access';
import { hasModulePermission } from '../lib/permissions';
import {
  ALL_BUSINESSES_UNIT,
  BUSINESS_PROFILES_KEY,
  canUseAllBusinesses,
  getAccessibleBusinessUnits,
  getAppointmentSettingKey,
  hydrateBusinessUnits,
  isAllBusinessesId,
  usesSquareAppointments,
} from '../utils/businessProfiles';
import {
  STAFF_BUSINESS_METADATA_KEY,
  enrichStaffWithBusinessMetadata,
  normalizeStaffBusinessMetadata,
  staffBelongsToBusiness,
} from '../utils/staffBusiness';

const EMPTY_STATE = {
  actionCenter: normalizeActionCenterState(null),
  boothRent: [],
  businessUnits: [],
  instagramInsights: null,
  masterDashboard: null,
  masterDashboardUpdatedAt: null,
  monthlyPerformanceSummary: [],
  payrollRuns: [],
  performanceSummary: [],
  squareStatus: null,
  staff: [],
  staffActivityReviewSummary: [],
  staffHub: {
    announcementReads: [],
    announcements: [],
    availability: [],
    contentSubmissions: [],
    newsletters: [],
    tasks: [],
    timeOffRequests: [],
  },
  staffPortalSummary: null,
  staffBusinessMetadata: {},
  warnings: [],
};

const LOAD_LABELS = {
  actionCenterRecord: 'Action Center',
  boothRent: 'Booth rent records',
  instagramInsights: 'Instagram insights',
  masterDashboardRecord: 'Appointment data',
  monthlyPerformanceSummary: 'Monthly performance',
  payrollRuns: 'Payroll history',
  performanceSummary: 'Performance summary',
  staffBusinessMetadataRecord: 'Staff business profile settings',
  staffActivityReviewSummary: 'Booksy and review attribution summary',
  staffPortalSummary: 'Staff portal payroll and performance',
  squareStatus: 'Square connection status',
  staff: 'Staff roster',
  staffHub: 'Staff Hub records',
};

function uniqueById(rows) {
  const seen = new Map();
  rows.forEach((row) => {
    if (row?.id && !seen.has(row.id)) seen.set(row.id, row);
  });
  return [...seen.values()];
}

function sortByCreatedAtDesc(rows) {
  return [...rows].sort(
    (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime(),
  );
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function findLinkedStaffProfile(staff, accessProfile) {
  const email = normalize(accessProfile?.email);
  const fullName = normalize(accessProfile?.full_name);
  return (
    staff.find((member) => normalize(member.email) === email) ||
    staff.find((member) => normalize(member.full_name) === fullName) ||
    null
  );
}

async function loadAcrossBusinessUnits(businessUnits, loader) {
  const nested = await Promise.all(businessUnits.map((unit) => loader(unit)));
  return nested.flat();
}

export function useRtbData(selectedBusinessUnitId, enabled = true, accessProfile = null) {
  const [data, setData] = useState(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const selectedBusinessUnit = useMemo(
    () => {
      if (
        isAllBusinessesId(selectedBusinessUnitId) &&
        canUseAllBusinesses(accessProfile, data.businessUnits)
      ) {
        return ALL_BUSINESSES_UNIT;
      }

      return (
        data.businessUnits.find((unit) => unit.id === selectedBusinessUnitId) ||
        data.businessUnits[0] ||
        null
      );
    },
    [accessProfile, data.businessUnits, selectedBusinessUnitId],
  );

  const refresh = useCallback(async (options = {}) => {
    const silent = Boolean(options?.silent);

    if (!enabled) {
      if (!silent) setLoading(false);
      return;
    }

    if (!silent) {
      setLoading(true);
      setError('');
    }

    try {
      const [rawBusinessUnits, businessProfilesRecord] = await Promise.all([
        getBusinessUnits(),
        getAppSettingRecord(BUSINESS_PROFILES_KEY).catch(() => null),
      ]);
      const allBusinessUnits = hydrateBusinessUnits(rawBusinessUnits, businessProfilesRecord?.value);
      const businessUnits = getAccessibleBusinessUnits(allBusinessUnits, accessProfile);
      const isAllBusinesses =
        canUseAllBusinesses(accessProfile, businessUnits) && isAllBusinessesId(selectedBusinessUnitId);
      const activeUnit =
        isAllBusinesses
          ? ALL_BUSINESSES_UNIT
          : (
              businessUnits.find((unit) => unit.id === selectedBusinessUnitId) ||
              businessUnits[0] ||
              null
            );

      if (!activeUnit) {
        setData({
          ...EMPTY_STATE,
          businessUnits,
          warnings: [
            'No business unit is assigned to this login. Ask an access admin to update business access.',
          ],
        });
        return;
      }

      const shouldLoadPayroll = canUsePayroll(accessProfile);
      const canViewActionCenter =
        hasModulePermission(accessProfile, 'operations', 'view') ||
        hasModulePermission(accessProfile, 'access', 'admin') ||
        hasModulePermission(accessProfile, 'settings', 'admin');
      const canViewAppointments = hasModulePermission(accessProfile, 'appointments', 'view');
      const canViewBoothRent = hasModulePermission(accessProfile, 'booth_rent', 'view');
      const canViewOperations = hasModulePermission(accessProfile, 'operations', 'view');

      const canViewPerformance = hasModulePermission(accessProfile, 'performance', 'view');
      const canViewRoster = hasModulePermission(accessProfile, 'roster', 'view');
      const canViewStaffHub = hasModulePermission(accessProfile, 'staff_hub', 'view');
      const canViewStaffMetadata =
        canViewRoster ||
        hasModulePermission(accessProfile, 'access', 'admin') ||
        hasModulePermission(accessProfile, 'settings', 'admin');
      const requests = {
        actionCenterRecord: canViewActionCenter
          ? getAppSettingRecord(ACTION_CENTER_SETTING_KEY)
          : Promise.resolve(null),
        boothRent: !canViewBoothRent
          ? Promise.resolve([])
          : isAllBusinesses
          ? loadAcrossBusinessUnits(businessUnits, (unit) =>
              getBoothRent(unit.id).then((rows) =>
                rows.map((row) => ({ ...row, business_name: unit.name })),
              ),
            )
          : getBoothRent(activeUnit.id),
        masterDashboardRecord: isAllBusinesses || !canViewAppointments
          ? Promise.resolve(null)
          : getAppSettingRecord(getAppointmentSettingKey(activeUnit)),
        instagramInsights: isAllBusinesses || !canViewOperations
          ? Promise.resolve(null)
          : getInstagramInsights(activeUnit.id).catch(() => null),
        monthlyPerformanceSummary: canViewPerformance
          ? getMonthlyPerformanceSummary(isAllBusinesses ? null : activeUnit.id)
          : Promise.resolve([]),
        payrollRuns: shouldLoadPayroll
          ? isAllBusinesses
            ? loadAcrossBusinessUnits(businessUnits, (unit) =>
                getPayrollRuns(unit.id).then((rows) =>
                  rows.map((row) => ({ ...row, business_name: unit.name })),
                ),
              )
            : getPayrollRuns(activeUnit.id)
          : Promise.resolve([]),
        performanceSummary: canViewPerformance
          ? getPerformanceSummary(isAllBusinesses ? null : activeUnit.id)
          : Promise.resolve([]),
        squareStatus: canViewAppointments && !isAllBusinesses && usesSquareAppointments(activeUnit)
          ? getSquareStatus(activeUnit.id)
          : Promise.resolve(null),
        staff: canViewRoster
          ? loadAcrossBusinessUnits(businessUnits, (unit) => getStaff(unit.id, true))
          : Promise.resolve([]),
        staffActivityReviewSummary:
          canViewPerformance || canViewAppointments || canViewStaffHub
            ? getStaffActivityReviewSummary(isAllBusinesses ? null : activeUnit.id)
            : Promise.resolve([]),
        staffBusinessMetadataRecord: canViewStaffMetadata
          ? getAppSettingRecord(STAFF_BUSINESS_METADATA_KEY)
          : Promise.resolve(null),
        staffPortalSummary: canViewStaffHub ? getMyStaffPortalSummary() : Promise.resolve(null),
      };
      const entries = Object.entries(requests);
      const results = await Promise.allSettled(entries.map(([, request]) => request));
      const loaded = {};
      const warnings = [];

      results.forEach((result, index) => {
        const [key] = entries[index];
        if (result.status === 'fulfilled') {
          loaded[key] = result.value;
          return;
        }

        loaded[key] =
          key === 'masterDashboardRecord' ||
          key === 'squareStatus' ||
          key === 'actionCenterRecord' ||
          key === 'staffBusinessMetadataRecord' ||
          key === 'staffPortalSummary'
            ? null
            : [];
        warnings.push(
          `${LOAD_LABELS[key]} could not load: ${result.reason?.message || 'Unknown error'}`,
        );
      });

      const staffBusinessMetadata = normalizeStaffBusinessMetadata(
        loaded.staffBusinessMetadataRecord?.value,
      );
      const staffPortalSummary = loaded.staffPortalSummary || null;
      const portalStaffProfile = staffPortalSummary?.staff_profile || null;
      const allStaff = enrichStaffWithBusinessMetadata(
        uniqueById([...(loaded.staff || []), portalStaffProfile].filter(Boolean)),
        staffBusinessMetadata,
        businessUnits,
      );
      const scopedStaff = isAllBusinesses
        ? allStaff
        : allStaff.filter((member) => staffBelongsToBusiness(member, activeUnit.id));
      const linkedStaffProfile = findLinkedStaffProfile(scopedStaff, accessProfile) || portalStaffProfile;
      let staffHub = EMPTY_STATE.staffHub;

      try {
        staffHub = await getStaffHubRecords({
          businessUnitId: isAllBusinesses ? null : activeUnit.id,
          staffId: linkedStaffProfile?.id || null,
        });
      } catch (err) {
        warnings.push(`${LOAD_LABELS.staffHub} could not load: ${err.message || 'Unknown error'}`);
      }

      setData({
        actionCenter: normalizeActionCenterState(loaded.actionCenterRecord?.value),
        boothRent: sortByCreatedAtDesc(loaded.boothRent),
        businessUnits,
        instagramInsights: loaded.instagramInsights || null,
        masterDashboard: loaded.masterDashboardRecord?.value || null,
        masterDashboardUpdatedAt: loaded.masterDashboardRecord?.updated_at || null,
        monthlyPerformanceSummary: loaded.monthlyPerformanceSummary,
        payrollRuns: sortByCreatedAtDesc(loaded.payrollRuns),
        performanceSummary: loaded.performanceSummary,
        squareStatus: loaded.squareStatus,
        staff: scopedStaff,
        staffActivityReviewSummary: loaded.staffActivityReviewSummary || [],
        staffHub,
        staffPortalSummary,
        staffBusinessMetadata,
        warnings,
      });
      setError('');
    } catch (err) {
      if (silent) {
        console.warn('RTB OS background refresh failed:', err);
      } else {
        setError(err.message || 'Unable to load RTB OS data.');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [accessProfile, enabled, selectedBusinessUnitId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    ...data,
    error,
    loading,
    refresh,
    selectedBusinessUnit,
  };
}
