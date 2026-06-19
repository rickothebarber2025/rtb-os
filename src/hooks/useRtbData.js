import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getAppSettingRecord,
  getBoothRent,
  getBusinessUnits,
  getMonthlyPerformanceSummary,
  getPayrollRuns,
  getPerformanceSummary,
  getSquareStatus,
  getStaff,
} from '../services/rtbService';
import { canUsePayroll } from '../utils/access';

const EMPTY_STATE = {
  boothRent: [],
  businessUnits: [],
  masterDashboard: null,
  masterDashboardUpdatedAt: null,
  monthlyPerformanceSummary: [],
  payrollRuns: [],
  performanceSummary: [],
  squareStatus: null,
  staff: [],
  warnings: [],
};

const LOAD_LABELS = {
  boothRent: 'Booth rent records',
  masterDashboardRecord: 'Appointment data',
  monthlyPerformanceSummary: 'Monthly performance',
  payrollRuns: 'Payroll history',
  performanceSummary: 'Performance summary',
  squareStatus: 'Square connection status',
  staff: 'Staff roster',
};

export function useRtbData(selectedBusinessUnitId, enabled = true, accessProfile = null) {
  const [data, setData] = useState(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const selectedBusinessUnit = useMemo(
    () =>
      data.businessUnits.find((unit) => unit.id === selectedBusinessUnitId) ||
      data.businessUnits[0] ||
      null,
    [data.businessUnits, selectedBusinessUnitId],
  );

  const refresh = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const businessUnits = await getBusinessUnits();
      const activeUnit =
        businessUnits.find((unit) => unit.id === selectedBusinessUnitId) ||
        businessUnits[0] ||
        null;

      if (!activeUnit) {
        setData({ ...EMPTY_STATE, businessUnits });
        return;
      }

      const shouldLoadPayroll = canUsePayroll(accessProfile);
      const isBeautyLounge = activeUnit.name === 'RTB Beauty Lounge';
      const requests = {
        boothRent: getBoothRent(activeUnit.id),
        masterDashboardRecord: getAppSettingRecord(
          isBeautyLounge ? 'rtb_beauty_square_appointments' : 'rtb_master_dashboard',
        ),
        monthlyPerformanceSummary: getMonthlyPerformanceSummary(activeUnit.id),
        payrollRuns: shouldLoadPayroll ? getPayrollRuns(activeUnit.id) : Promise.resolve([]),
        performanceSummary: getPerformanceSummary(activeUnit.name),
        squareStatus: isBeautyLounge
          ? getSquareStatus(activeUnit.id)
          : Promise.resolve(null),
        staff: getStaff(activeUnit.id, true),
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

        loaded[key] = key === 'masterDashboardRecord' || key === 'squareStatus' ? null : [];
        warnings.push(
          `${LOAD_LABELS[key]} could not load: ${result.reason?.message || 'Unknown error'}`,
        );
      });

      setData({
        boothRent: loaded.boothRent,
        businessUnits,
        masterDashboard: loaded.masterDashboardRecord?.value || null,
        masterDashboardUpdatedAt: loaded.masterDashboardRecord?.updated_at || null,
        monthlyPerformanceSummary: loaded.monthlyPerformanceSummary,
        payrollRuns: loaded.payrollRuns,
        performanceSummary: loaded.performanceSummary,
        squareStatus: loaded.squareStatus,
        staff: loaded.staff,
        warnings,
      });
    } catch (err) {
      setError(err.message || 'Unable to load RTB OS data.');
    } finally {
      setLoading(false);
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
