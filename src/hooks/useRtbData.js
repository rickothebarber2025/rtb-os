import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getAppSetting,
  getBoothRent,
  getBusinessUnits,
  getPayrollRuns,
  getPerformanceSummary,
  getStaff,
} from '../services/rtbService';
import { canUsePayroll } from '../utils/access';

const EMPTY_STATE = {
  boothRent: [],
  businessUnits: [],
  masterDashboard: null,
  payrollRuns: [],
  performanceSummary: [],
  staff: [],
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
      const [staff, payrollRuns, boothRent, performanceSummary, masterDashboard] =
        await Promise.all([
          getStaff(activeUnit.id, true),
          shouldLoadPayroll ? getPayrollRuns(activeUnit.id) : Promise.resolve([]),
          getBoothRent(activeUnit.id),
          getPerformanceSummary(activeUnit.name),
          activeUnit.name === 'RTB Lounge'
            ? getAppSetting('rtb_master_dashboard')
            : getAppSetting('rtb_beauty_square_appointments'),
        ]);

      setData({
        boothRent,
        businessUnits,
        masterDashboard,
        payrollRuns,
        performanceSummary,
        staff,
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
