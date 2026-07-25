import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FilePenLine,
  FileSpreadsheet,
  LockKeyhole,
  ReceiptText,
  Save,
  Sparkles,
  Trash2,
  Upload,
  UserPlus,
} from 'lucide-react';
import ConfirmDialog from '../components/ConfirmDialog';
import DataTable from '../components/DataTable';
import EmptyState from '../components/EmptyState';
import StatusBadge from '../components/StatusBadge';
import {
  createPayrollCorrection,
  deletePayrollDraft,
  lockPayrollRun,
  savePayrollDraft,
} from '../services/rtbService';
import { getDefaultPayrollWeek } from '../utils/dates';
import { isAllBusinessesUnit } from '../utils/businessProfiles';
import { canAdminPayroll, canManagePayroll } from '../utils/access';
import { formatCurrency, formatDate, formatPercent } from '../utils/formatters';
import {
  calculateRunTotals,
  createCorrectionDraft,
  createDraftEntry,
  entryBelongsToStaff,
  getPayrollReplacementMap,
  getMissingPayrollStaff,
  recalculateEntry,
  sortPayrollRunsByWeekAsc,
  splitPayrollRunsByVoidStatus,
  toMoneyNumber,
} from '../utils/payroll';
import { matchSquareNameToStaff, parseSquarePayrollCsv } from '../utils/squarePayrollImport';

function createInitialRun(businessUnitId) {
  const week = getDefaultPayrollWeek();
  return {
    business_unit_id: businessUnitId,
    notes: '',
    owner_net_sales: 0,
    owner_tips: 0,
    status: 'draft',
    ...week,
  };
}

function runStatusTone(status) {
  if (status === 'voided') return 'danger';
  if (status === 'draft') return 'warning';
  return 'success';
}

function summarizePayrollRuns(runs) {
  return runs.reduce(
    (totals, run) => ({
      count: totals.count + 1,
      rtbNet: totals.rtbNet + Number(run.rtb_net || 0),
      staffPayout: totals.staffPayout + Number(run.total_staff_payout || 0),
      totalSales: totals.totalSales + Number(run.total_net_sales || 0),
    }),
    { count: 0, rtbNet: 0, staffPayout: 0, totalSales: 0 },
  );
}

function groupPayrollRunsByBusiness(runs) {
  const groups = new Map();

  runs.forEach((run) => {
    const businessName = run.business_name || 'RTB';
    const key = run.business_unit_id || businessName;
    const current = groups.get(key) || {
      businessName,
      runs: [],
      summary: { count: 0, rtbNet: 0, staffPayout: 0, totalSales: 0 },
    };

    current.runs.push(run);
    current.summary = summarizePayrollRuns(current.runs);
    groups.set(key, current);
  });

  return [...groups.values()].sort((a, b) => a.businessName.localeCompare(b.businessName));
}

export default function PayrollPage({
  accessProfile,
  businessUnit,
  onRefresh,
  payrollRuns,
  staff,
  user,
}) {
  const allBusinessesView = isAllBusinessesUnit(businessUnit);
  const payrollEditable = canManagePayroll(accessProfile);
  const payrollAdmin = canAdminPayroll(accessProfile);
  const activeStaff = useMemo(() => staff.filter((member) => member.active), [staff]);
  const [currentRun, setCurrentRun] = useState(() => createInitialRun(businessUnit?.id));
  const [confirmAction, setConfirmAction] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [entries, setEntries] = useState([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState('');
  const [showVoidedRuns, setShowVoidedRuns] = useState(false);
  const [squareImportReview, setSquareImportReview] = useState([]);
  const [squareImportSummary, setSquareImportSummary] = useState(null);
  const squareCsvInputRef = useRef(null);
  const previousBusinessUnitId = useRef(null);

  useEffect(() => {
    if (allBusinessesView) {
      previousBusinessUnitId.current = businessUnit?.id || null;
      setCurrentRun(createInitialRun(''));
      setEntries([]);
      return;
    }

    if (!businessUnit?.id) return;

    const businessChanged = previousBusinessUnitId.current !== businessUnit.id;
    if (businessChanged) {
      previousBusinessUnitId.current = businessUnit.id;
      setCurrentRun(createInitialRun(businessUnit.id));
      setEntries(activeStaff.map(createDraftEntry));
      return;
    }

    if (!currentRun.id && entries.length === 0 && activeStaff.length) {
      setEntries(activeStaff.map(createDraftEntry));
    }
  }, [activeStaff, allBusinessesView, businessUnit?.id, currentRun.id, entries.length]);

  const readOnly = currentRun.status !== 'draft' || !payrollEditable;
  const finalized = ['locked', 'sent'].includes(currentRun.status);
  const totals = useMemo(
    () => calculateRunTotals({ entries, ownerNetSales: currentRun.owner_net_sales }),
    [currentRun.owner_net_sales, entries],
  );
  const missingStaff = useMemo(
    () => getMissingPayrollStaff(activeStaff, entries),
    [activeStaff, entries],
  );
  const sortedPayrollRuns = useMemo(
    () => sortPayrollRunsByWeekAsc(payrollRuns),
    [payrollRuns],
  );
  const { activeRuns: activePayrollRuns, voidedRuns: voidedPayrollRuns } = useMemo(
    () => splitPayrollRunsByVoidStatus(sortedPayrollRuns),
    [sortedPayrollRuns],
  );
  const visibleCombinedRuns = useMemo(
    () => [...activePayrollRuns, ...(showVoidedRuns ? voidedPayrollRuns : [])],
    [activePayrollRuns, showVoidedRuns, voidedPayrollRuns],
  );
  const combinedPayrollSummary = useMemo(
    () => summarizePayrollRuns(activePayrollRuns),
    [activePayrollRuns],
  );
  const combinedBusinessGroups = useMemo(
    () => groupPayrollRunsByBusiness(visibleCombinedRuns),
    [visibleCombinedRuns],
  );
  const replacementByVoidedRunId = useMemo(() => {
    return getPayrollReplacementMap(sortedPayrollRuns);
  }, [sortedPayrollRuns]);
  const documentRun = useMemo(
    () => ({
      ...currentRun,
      payroll_entries: entries,
      rtb_net: totals.rtbNet,
      total_deductions: totals.totalDeductions,
      total_net_sales: totals.totalNetSales,
      total_staff_payout: totals.totalStaffPayout,
    }),
    [currentRun, entries, totals],
  );

  function resetDraft() {
    if (allBusinessesView || !payrollEditable) return;
    setCurrentRun(createInitialRun(businessUnit?.id));
    setEntries(activeStaff.map(createDraftEntry));
    setSquareImportReview([]);
    setSquareImportSummary(null);
    setError('');
    setNotice('');
  }

  function updateRunField(field, value) {
    if (readOnly) return;
    setCurrentRun((run) => ({ ...run, [field]: value }));
  }

  function updateEntry(index, field, value) {
    if (readOnly) return;
    setEntries((rows) =>
      rows.map((entry, rowIndex) =>
        rowIndex === index
          ? recalculateEntry({
              ...entry,
              [field]: field === 'notes' ? value : toMoneyNumber(value),
            })
          : entry,
      ),
    );
  }

  function addStaffToDraft(member) {
    if (readOnly) return;
    setEntries((rows) => {
      if (rows.some((entry) => entryBelongsToStaff(entry, member))) return rows;
      return [...rows, createDraftEntry(member)];
    });
    setError('');
    setNotice(`${member.full_name} added to this draft. Save the draft to keep the change.`);
  }

  function addAllMissingStaff() {
    if (readOnly) return;
    setEntries((rows) => [
      ...rows,
      ...activeStaff
        .filter((member) => !rows.some((entry) => entryBelongsToStaff(entry, member)))
        .map(createDraftEntry),
    ]);
    setError('');
    setNotice('All missing active staff were added. Save the draft to keep the change.');
  }

  function removeEntry(index) {
    if (readOnly) return;
    setEntries((rows) => rows.filter((_, rowIndex) => rowIndex !== index));
    setError('');
    setNotice('Payroll row removed. Save the draft to keep the change.');
  }

  function applySquareAmountsToEntry(entry, squareData) {
    return recalculateEntry({
      ...entry,
      net_sales: toMoneyNumber(squareData.netSales),
      tips: toMoneyNumber(squareData.tips),
    });
  }

  async function handleSquareCsvUpload(file) {
    if (readOnly || !file) return;
    setError('');
    setNotice('');

    try {
      const csvText = await file.text();
      const { bySquareName, meta } = parseSquarePayrollCsv(csvText);

      let matchedCount = 0;
      const unmatched = [];
      const usedStaffIds = new Set();

      setEntries((rows) => {
        const updated = [...rows];

        Object.entries(bySquareName).forEach(([squareName, squareData]) => {
          const matchedStaff = matchSquareNameToStaff(squareName, activeStaff);

          if (!matchedStaff || usedStaffIds.has(matchedStaff.id)) {
            unmatched.push({ squareData, squareName });
            return;
          }

          usedStaffIds.add(matchedStaff.id);
          matchedCount += 1;
          const entryIndex = updated.findIndex((entry) => entryBelongsToStaff(entry, matchedStaff));

          if (entryIndex >= 0) {
            updated[entryIndex] = applySquareAmountsToEntry(updated[entryIndex], squareData);
          } else {
            updated.push(applySquareAmountsToEntry(createDraftEntry(matchedStaff), squareData));
          }
        });

        return updated;
      });

      setSquareImportReview(unmatched);
      setSquareImportSummary({ ...meta, matchedCount, unmatchedCount: unmatched.length });
      setNotice(
        `Imported ${meta.transactionCount} transactions -- matched ${matchedCount} staff` +
          (unmatched.length ? `, ${unmatched.length} name${unmatched.length === 1 ? '' : 's'} need review below.` : '.'),
      );
    } catch (err) {
      setError(err.message || 'Unable to read that CSV file.');
    }
  }

  function assignUnmatchedImport(reviewIndex, staffId) {
    const review = squareImportReview[reviewIndex];
    if (!review) return;
    const matchedStaff = activeStaff.find((member) => member.id === staffId);
    if (!matchedStaff) return;

    setEntries((rows) => {
      const entryIndex = rows.findIndex((entry) => entryBelongsToStaff(entry, matchedStaff));
      if (entryIndex >= 0) {
        return rows.map((entry, index) =>
          index === entryIndex ? applySquareAmountsToEntry(entry, review.squareData) : entry,
        );
      }
      return [...rows, applySquareAmountsToEntry(createDraftEntry(matchedStaff), review.squareData)];
    });
    setSquareImportReview((rows) => rows.filter((_, index) => index !== reviewIndex));
    setNotice(`${review.squareName} assigned to ${matchedStaff.full_name}.`);
  }

  function dismissUnmatchedImport(reviewIndex) {
    setSquareImportReview((rows) => rows.filter((_, index) => index !== reviewIndex));
  }

  function loadRun(run) {
    setCurrentRun({
      business_unit_id: run.business_unit_id,
      corrected_from_run_id: run.corrected_from_run_id || null,
      id: run.id,
      notes: run.notes || '',
      owner_net_sales: Number(run.owner_net_sales || 0),
      owner_tips: Number(run.owner_tips || 0),
      performance_saved_at: run.performance_saved_at || null,
      status: run.status,
      void_reason: run.void_reason || '',
      voided_at: run.voided_at || null,
      week_end: run.week_end || '',
      week_label: run.week_label,
      week_start: run.week_start || '',
    });
    setEntries((run.payroll_entries || []).map((entry) => {
      const normalized = {
        ...entry,
        applied_commission_rate: Number(entry.applied_commission_rate || 0),
        base_commission_rate: Number(entry.base_commission_rate || 0),
        deduction: Number(entry.deduction || 0),
        net_sales: Number(entry.net_sales || 0),
        take_home: Number(entry.take_home || 0),
        tips: Number(entry.tips || 0),
      };

      return run.status === 'draft' ? recalculateEntry(normalized) : normalized;
    }));
    setError('');
    setNotice(`Loaded ${run.week_label}.`);
  }

  async function persistDraft(statusOverride = currentRun.status) {
    if (!payrollEditable) {
      throw new Error('Payroll edit access is required to save payroll.');
    }

    if (allBusinessesView) {
      throw new Error('Select one business before creating or saving payroll.');
    }

    const runPayload = {
      ...currentRun,
      business_unit_id: businessUnit?.id,
      created_by: user?.id,
      rtb_net: totals.rtbNet,
      status: statusOverride,
      total_deductions: totals.totalDeductions,
      total_net_sales: totals.totalNetSales,
      total_staff_payout: totals.totalStaffPayout,
    };

    const saved = await savePayrollDraft(runPayload, entries);
    setCurrentRun((run) => ({
      ...run,
      id: saved.id,
      status: saved.status,
    }));
    await onRefresh();
    return saved;
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    setNotice('');

    try {
      const saved = await persistDraft('draft');
      setNotice(`Draft saved for ${saved.week_label}.`);
    } catch (err) {
      setError(err.message || 'Unable to save payroll draft.');
    } finally {
      setSaving(false);
    }
  }

  async function handleLock() {
    if (!payrollAdmin) {
      setError('Payroll admin access is required to finalize payroll.');
      return;
    }

    setSaving(true);
    setError('');
    setNotice('');

    try {
      const saved = await persistDraft('draft');
      await lockPayrollRun(saved.id);
      setCurrentRun((run) => ({
        ...run,
        id: saved.id,
        performance_saved_at: new Date().toISOString(),
        status: 'locked',
      }));
      await onRefresh();
      setNotice('Payroll finalized and performance history saved.');
    } catch (err) {
      setError(err.message || 'Unable to finalize payroll run.');
    } finally {
      setSaving(false);
    }
  }

  if (allBusinessesView) {
    return (
      <div className="page-grid payroll-overview-page">
        <section className="panel full-span payroll-overview-hero">
          <div className="section-header">
            <div>
              <span>Payroll</span>
              <h2>Combined payroll history</h2>
            </div>
            <StatusBadge tone="warning">Read only</StatusBadge>
          </div>
          <div className="payroll-overview-note">
            <strong>Choose one business before editing payroll.</strong>
            <span>All Businesses is for review only. Drafts, corrections, payouts, and exports stay separated.</span>
          </div>
          <div className="payroll-overview-summary">
            <article>
              <span>Runs</span>
              <strong>{combinedPayrollSummary.count}</strong>
            </article>
            <article>
              <span>Net sales</span>
              <strong>{formatCurrency(combinedPayrollSummary.totalSales)}</strong>
            </article>
            <article>
              <span>Staff payout</span>
              <strong>{formatCurrency(combinedPayrollSummary.staffPayout)}</strong>
            </article>
            <article>
              <span>RTB net</span>
              <strong>{formatCurrency(combinedPayrollSummary.rtbNet)}</strong>
            </article>
          </div>
        </section>

        <section className="panel full-span payroll-grouped-history">
          <div className="section-header">
            <div>
              <span>History</span>
              <h2>Grouped by business</h2>
            </div>
            {voidedPayrollRuns.length ? (
              <button
                className="ghost-button small"
                type="button"
                onClick={() => setShowVoidedRuns((current) => !current)}
              >
                {showVoidedRuns ? 'Hide voided' : 'Show voided'}
              </button>
            ) : null}
          </div>

          {voidedPayrollRuns.length ? (
            <div className="history-filter-row">
              <span>
                {voidedPayrollRuns.length} voided payroll run
                {voidedPayrollRuns.length === 1 ? '' : 's'} {showVoidedRuns ? 'shown' : 'hidden'}
              </span>
            </div>
          ) : null}

          {combinedBusinessGroups.length ? (
            <div className="payroll-business-groups">
              {combinedBusinessGroups.map((group) => (
                <article className="payroll-business-group" key={group.businessName}>
                  <header>
                    <div>
                      <span>Business</span>
                      <h3>{group.businessName}</h3>
                    </div>
                    <div className="payroll-business-totals">
                      <span>{group.summary.count} run{group.summary.count === 1 ? '' : 's'}</span>
                      <strong>{formatCurrency(group.summary.totalSales)}</strong>
                    </div>
                  </header>
                  <div className="payroll-run-grid">
                    {group.runs.map((run) => (
                      <div className={`payroll-run-tile status-${run.status}`} key={run.id}>
                        <div className="payroll-run-tile__top">
                          <div>
                            <strong>{run.week_label}</strong>
                            <span>{formatDate(run.created_at)}</span>
                          </div>
                          <StatusBadge tone={runStatusTone(run.status)}>{run.status}</StatusBadge>
                        </div>
                        <div className="payroll-run-tile__metrics">
                          <span>
                            <small>Sales</small>
                            <strong>{formatCurrency(run.total_net_sales)}</strong>
                          </span>
                          <span>
                            <small>Payout</small>
                            <strong>{formatCurrency(run.total_staff_payout)}</strong>
                          </span>
                          <span>
                            <small>RTB net</small>
                            <strong>{formatCurrency(run.rtb_net)}</strong>
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={CheckCircle2}
              title="No payroll history"
              message={
                voidedPayrollRuns.length
                  ? 'Only voided correction records exist. Use Show voided to review them.'
                  : 'Saved runs from each business will appear here after they are created.'
              }
            />
          )}
        </section>
      </div>
    );
  }

  async function handleDeleteDraft() {
    if (!payrollAdmin || !currentRun.id || currentRun.status !== 'draft') return;
    setSaving(true);
    setError('');
    setNotice('');

    try {
      await deletePayrollDraft(currentRun.id);
      await onRefresh();
      resetDraft();
      setNotice('Payroll draft deleted.');
      setConfirmAction('');
    } catch (err) {
      setError(err.message || 'Unable to delete payroll draft.');
    } finally {
      setSaving(false);
    }
  }

  async function handleCorrectRun() {
    if (!payrollAdmin || !currentRun.id || !finalized) return;
    setSaving(true);
    setError('');
    setNotice('');

    try {
      const correction = createCorrectionDraft(currentRun, entries, correctionReason);
      const savedCorrection = await createPayrollCorrection(currentRun.id, correctionReason);
      await onRefresh();
      setCurrentRun({ ...correction.run, id: savedCorrection.id });
      setEntries(correction.entries);
      setConfirmAction('');
      setCorrectionReason('');
      setNotice('Original payroll was voided. Update this correction draft, then finalize it.');
    } catch (err) {
      setError(err.message || 'Unable to start payroll correction.');
    } finally {
      setSaving(false);
    }
  }

  async function handleExport(kind, entry = null) {
    if (!currentRun.id) return;
    setExporting(entry ? `paystub-${entry.staff_id || entry.staff_name_snapshot}` : kind);
    setError('');

    try {
      const documents = await import('../utils/payrollDocuments');
      if (kind === 'csv') {
        documents.downloadPayrollRunCsv(documentRun, businessUnit);
      } else if (kind === 'paystub') {
        await documents.downloadPaystubPdf(documentRun, entry, businessUnit);
      } else {
        await documents.downloadPayrollRunPdf(documentRun, businessUnit);
      }
    } catch (err) {
      setError(err.message || 'Unable to generate payroll document.');
    } finally {
      setExporting('');
    }
  }

  return (
    <div className="page-grid payroll-layout">
      <section className="panel payroll-builder">
        <div className="section-header">
          <div>
            <span>Payroll</span>
            <h2>Draft run</h2>
          </div>
          <StatusBadge
            tone={
              currentRun.status === 'voided'
                ? 'danger'
                : currentRun.status === 'draft'
                  ? 'warning'
                  : 'success'
            }
          >
            {currentRun.status}
          </StatusBadge>
        </div>

        {currentRun.corrected_from_run_id && currentRun.status === 'draft' ? (
          <div className="alert warning">
            <strong>Correction draft</strong>
            <span>Review every amount before finalizing this replacement payroll.</span>
          </div>
        ) : null}
        {currentRun.status === 'voided' ? (
          <div className="alert danger">
            Voided for correction: {currentRun.void_reason || 'No reason recorded'}
          </div>
        ) : null}

        <div className="form-grid compact">
          <label className="field">
            <span>Week label</span>
            <input
              disabled={readOnly}
              onChange={(event) => updateRunField('week_label', event.target.value)}
              value={currentRun.week_label || ''}
            />
          </label>
          <label className="field">
            <span>Week start</span>
            <input
              disabled={readOnly}
              onChange={(event) => updateRunField('week_start', event.target.value)}
              type="date"
              value={currentRun.week_start || ''}
            />
          </label>
          <label className="field">
            <span>Week end</span>
            <input
              disabled={readOnly}
              onChange={(event) => updateRunField('week_end', event.target.value)}
              type="date"
              value={currentRun.week_end || ''}
            />
          </label>
          <label className="field">
            <span>Owner net sales</span>
            <input
              disabled={readOnly}
              min="0"
              onChange={(event) => updateRunField('owner_net_sales', toMoneyNumber(event.target.value))}
              step="0.01"
              type="number"
              value={currentRun.owner_net_sales || 0}
            />
          </label>
          <label className="field">
            <span>Owner tips</span>
            <input
              disabled={readOnly}
              min="0"
              onChange={(event) => updateRunField('owner_tips', toMoneyNumber(event.target.value))}
              step="0.01"
              type="number"
              value={currentRun.owner_tips || 0}
            />
          </label>
          <label className="field wide">
            <span>Notes</span>
            <input
              disabled={readOnly}
              onChange={(event) => updateRunField('notes', event.target.value)}
              placeholder="Internal payroll notes"
              value={currentRun.notes || ''}
            />
          </label>
        </div>

        <div className="payroll-summary">
          <div>
            <span>Total net sales</span>
            <strong>{formatCurrency(totals.totalNetSales)}</strong>
          </div>
          <div>
            <span>Staff payout</span>
            <strong>{formatCurrency(totals.totalStaffPayout)}</strong>
          </div>
          <div>
            <span>Deductions</span>
            <strong>{formatCurrency(totals.totalDeductions)}</strong>
          </div>
          <div>
            <span>RTB net</span>
            <strong>{formatCurrency(totals.rtbNet)}</strong>
          </div>
        </div>

        {!readOnly ? (
          <section className="payroll-fix-panel" aria-label="Import Square sales">
            <div>
              <span>Square import</span>
              <strong>Upload this week's Square transaction export</strong>
              <p>
                Parses the raw Square CSV, splits out retail products from commissionable
                revenue, and fills in each staff member's net sales and tips automatically.
              </p>
            </div>
            <div className="payroll-fix-panel__actions">
              <input
                accept=".csv"
                hidden
                ref={squareCsvInputRef}
                type="file"
                onChange={(event) => {
                  handleSquareCsvUpload(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
              <button
                className="secondary-button small"
                disabled={saving}
                type="button"
                onClick={() => squareCsvInputRef.current?.click()}
              >
                <Upload size={15} />
                Upload Square CSV
              </button>
            </div>
            {squareImportSummary ? (
              <p className="subtle-text">
                {squareImportSummary.transactionCount} transactions -- {formatCurrency(squareImportSummary.totalRevenueNet)}{' '}
                commissionable revenue, {formatCurrency(squareImportSummary.totalProductRevenue)} retail product revenue excluded,{' '}
                {formatCurrency(squareImportSummary.totalTips)} in tips.
              </p>
            ) : null}
            {squareImportReview.length ? (
              <div className="payroll-fix-panel__actions" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <p className="subtle-text">
                  These Square names didn't match an active staff member -- assign each one or dismiss it:
                </p>
                {squareImportReview.map((review, index) => (
                  <div className="action-row" key={`${review.squareName}-${index}`}>
                    <span style={{ minWidth: '160px' }}>{review.squareName}</span>
                    <span className="subtle-text">
                      {formatCurrency(review.squareData.netSales)} net sales, {formatCurrency(review.squareData.tips)} tips
                    </span>
                    <select onChange={(event) => event.target.value && assignUnmatchedImport(index, event.target.value)} defaultValue="">
                      <option value="" disabled>
                        Assign to...
                      </option>
                      {activeStaff.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.full_name}
                        </option>
                      ))}
                    </select>
                    <button className="ghost-button small" type="button" onClick={() => dismissUnmatchedImport(index)}>
                      Dismiss
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

        {!readOnly ? (
          <section className="payroll-fix-panel" aria-label="Payroll draft fix-ups">
            <div>
              <span>Draft fix-ups</span>
              <strong>
                {missingStaff.length
                  ? `${missingStaff.length} active staff missing`
                  : 'All active staff included'}
              </strong>
              <p>
                Load any saved draft, add missing staff, remove wrong rows, then save the draft.
              </p>
            </div>
            {missingStaff.length ? (
              <div className="payroll-fix-panel__actions">
                <button
                  className="secondary-button small"
                  disabled={saving}
                  type="button"
                  onClick={addAllMissingStaff}
                >
                  <UserPlus size={15} />
                  Add all missing
                </button>
                {missingStaff.map((member) => (
                  <button
                    className="ghost-button small"
                    disabled={saving}
                    key={member.id}
                    type="button"
                    onClick={() => addStaffToDraft(member)}
                  >
                    <UserPlus size={14} />
                    {member.full_name}
                  </button>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

        {entries.length ? (
          <DataTable className="payroll-table">
            <table>
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Net sales</th>
                  <th>Tips</th>
                  <th>Rate</th>
                  <th>Deduction</th>
                  <th>Take home</th>
                  <th>Notes</th>
                  <th>Paystub</th>
                  {!readOnly ? <th>Fix</th> : null}
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, index) => (
                  <tr key={entry.id || entry.staff_id || entry.staff_name_snapshot}>
                    <td>
                      <div className="person-cell">
                        <strong>{entry.staff_name_snapshot}</strong>
                        <span>
                          {entry.role_snapshot} / {entry.tier_snapshot}
                        </span>
                      </div>
                      <div className="business-chip-list">
                        {entry.fixed_rate_snapshot ? (
                          <StatusBadge tone="gold">Fixed rate</StatusBadge>
                        ) : null}
                        {entry.adjusted ? (
                          <StatusBadge tone="warning">Adjusted</StatusBadge>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <input
                        disabled={readOnly}
                        min="0"
                        onChange={(event) => updateEntry(index, 'net_sales', event.target.value)}
                        step="0.01"
                        type="number"
                        value={entry.net_sales}
                      />
                    </td>
                    <td>
                      <input
                        disabled={readOnly}
                        min="0"
                        onChange={(event) => updateEntry(index, 'tips', event.target.value)}
                        step="0.01"
                        type="number"
                        value={entry.tips}
                      />
                    </td>
                    <td>
                      <strong>{formatPercent(entry.applied_commission_rate)}</strong>
                      <span className="subtle-text">Base {formatPercent(entry.base_commission_rate)}</span>
                    </td>
                    <td>{formatCurrency(entry.deduction)}</td>
                    <td>
                      <strong>{formatCurrency(entry.take_home)}</strong>
                    </td>
                    <td>
                      <input
                        disabled={readOnly}
                        onChange={(event) => updateEntry(index, 'notes', event.target.value)}
                        placeholder="Optional"
                        value={entry.notes || ''}
                      />
                    </td>
                    <td>
                      <button
                        aria-label={`Download ${entry.staff_name_snapshot} paystub`}
                        className="icon-button small"
                        disabled={
                          !currentRun.id ||
                          exporting === `paystub-${entry.staff_id || entry.staff_name_snapshot}`
                        }
                        onClick={() => handleExport('paystub', entry)}
                        title="Download paystub"
                        type="button"
                      >
                        <ReceiptText size={15} />
                      </button>
                    </td>
                    {!readOnly ? (
                      <td>
                        <button
                          aria-label={`Remove ${entry.staff_name_snapshot} from this draft`}
                          className="ghost-button small danger-action"
                          disabled={saving}
                          onClick={() => removeEntry(index)}
                          type="button"
                        >
                          <Trash2 size={14} />
                          Remove
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </DataTable>
        ) : (
          <EmptyState
            icon={Sparkles}
            title={activeStaff.length ? 'No staff rows in this draft' : 'No active staff'}
            message={
              activeStaff.length
                ? 'Add the active roster back into this draft, then save it.'
                : 'Add active staff before drafting payroll.'
            }
            action={
              activeStaff.length && !readOnly ? (
                <button className="ghost-button" type="button" onClick={addAllMissingStaff}>
                  Add active roster
                </button>
              ) : null
            }
          />
        )}

        {error ? <div className="alert danger">{error}</div> : null}
        {notice ? <div className="alert success">{notice}</div> : null}

        <div className="action-row">
          <button
            className="ghost-button"
            disabled={!payrollEditable}
            title={!payrollEditable ? 'Payroll edit access is required.' : undefined}
            type="button"
            onClick={resetDraft}
          >
            New draft
          </button>
          <button
            className="secondary-button"
            disabled={saving || readOnly || !entries.length}
            title={!payrollEditable ? 'Payroll edit access is required.' : undefined}
            type="button"
            onClick={handleSave}
          >
            <Save size={17} />
            Save draft
          </button>
          <button
            className="primary-button"
            disabled={saving || !payrollAdmin || currentRun.status !== 'draft' || !entries.length}
            title={!payrollAdmin ? 'Payroll admin access is required.' : undefined}
            type="button"
            onClick={handleLock}
          >
            <LockKeyhole size={17} />
            {saving ? 'Finalizing...' : 'Finalize payroll'}
          </button>
          {currentRun.id && currentRun.status === 'draft' ? (
            <button
              className="ghost-button danger-action"
              disabled={saving || !payrollAdmin}
              title={!payrollAdmin ? 'Payroll admin access is required.' : undefined}
              onClick={() => setConfirmAction('delete-draft')}
              type="button"
            >
              <Trash2 size={17} />
              Delete draft
            </button>
          ) : null}
          {currentRun.id && finalized ? (
            <button
              className="secondary-button"
              disabled={saving || !payrollAdmin}
              title={!payrollAdmin ? 'Payroll admin access is required.' : undefined}
              onClick={() => {
                setCorrectionReason('');
                setConfirmAction('correct-run');
              }}
              type="button"
            >
              <FilePenLine size={17} />
              Correct this run
            </button>
          ) : null}
          {currentRun.id ? (
            <>
              <button
                className="ghost-button"
                disabled={Boolean(exporting)}
                onClick={() => handleExport('pdf')}
                type="button"
              >
                <Download size={17} />
                Payroll PDF
              </button>
              <button
                className="ghost-button"
                disabled={Boolean(exporting)}
                onClick={() => handleExport('csv')}
                type="button"
              >
                <FileSpreadsheet size={17} />
                Payroll CSV
              </button>
            </>
          ) : null}
        </div>
      </section>

      <aside className="panel side-panel">
        <div className="section-header">
          <div>
            <span>History</span>
            <h2>Saved runs</h2>
          </div>
          {voidedPayrollRuns.length ? (
            <button
              className="ghost-button small"
              type="button"
              onClick={() => setShowVoidedRuns((current) => !current)}
            >
              {showVoidedRuns ? 'Hide voided' : 'Show voided'}
            </button>
          ) : null}
        </div>

        <div className="run-list">
          {activePayrollRuns.map((run) => (
            <button className="run-card" key={run.id} type="button" onClick={() => loadRun(run)}>
              <div>
                <strong>{run.week_label}</strong>
                <span>{formatDate(run.created_at)}</span>
              </div>
              <StatusBadge tone={runStatusTone(run.status)}>
                {run.status}
              </StatusBadge>
              <b>{formatCurrency(run.total_net_sales)}</b>
              {run.corrected_from_run_id ? (
                <small className="success-text">Correction replacement</small>
              ) : null}
              {run.status === 'locked' ? (
                <small className={run.performance_saved_at ? 'success-text' : 'danger-text'}>
                  {run.performance_saved_at ? 'Performance saved' : 'Performance missing'}
                </small>
              ) : null}
            </button>
          ))}
          {!activePayrollRuns.length ? (
            <EmptyState
              icon={CheckCircle2}
              title="No saved runs"
              message={
                voidedPayrollRuns.length
                  ? 'Only voided correction records exist. Use Show voided to review them.'
                  : 'Drafts and locked runs will appear here.'
              }
            />
          ) : null}
        </div>

        {voidedPayrollRuns.length ? (
          <div className="voided-history">
            <button
              className="voided-history__toggle"
              type="button"
              onClick={() => setShowVoidedRuns((current) => !current)}
            >
              <span>Voided / Corrections</span>
              <strong>
                {voidedPayrollRuns.length} {showVoidedRuns ? 'shown' : 'hidden'}
              </strong>
            </button>
            {showVoidedRuns ? (
              <div className="run-list">
                {voidedPayrollRuns.map((run) => {
                  const replacement = replacementByVoidedRunId.get(run.id);

                  return (
                    <button
                      className="run-card voided"
                      key={run.id}
                      type="button"
                      onClick={() => loadRun(run)}
                    >
                      <div>
                        <strong>{run.week_label}</strong>
                        <span>
                          Voided {run.voided_at ? formatDate(run.voided_at) : formatDate(run.created_at)}
                        </span>
                      </div>
                      <StatusBadge tone="danger">voided</StatusBadge>
                      <b>{formatCurrency(run.total_net_sales)}</b>
                      <small className="subtle-text">
                        {replacement
                          ? `Replaced by ${replacement.week_label}`
                          : 'Kept for correction audit trail'}
                      </small>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}
      </aside>

      {confirmAction === 'delete-draft' ? (
        <ConfirmDialog
          busy={saving}
          confirmLabel="Delete draft"
          description={`Delete the draft for ${currentRun.week_label}? Its payroll entries will also be removed.`}
          onClose={() => setConfirmAction('')}
          onConfirm={handleDeleteDraft}
          title="Delete payroll draft"
        >
          {error ? <div className="alert danger">{error}</div> : null}
        </ConfirmDialog>
      ) : null}

      {confirmAction === 'correct-run' ? (
        <ConfirmDialog
          busy={saving}
          confirmDisabled={correctionReason.trim().length < 5}
          confirmLabel="Void and create correction"
          description="The finalized run will remain in history as voided. Its performance data will be removed and a replacement draft will open with the same amounts."
          onClose={() => setConfirmAction('')}
          onConfirm={handleCorrectRun}
          title="Correct finalized payroll"
          tone="warning"
        >
          <label className="field">
            <span>Reason for correction</span>
            <textarea
              autoFocus
              onChange={(event) => setCorrectionReason(event.target.value)}
              placeholder="Example: Entered the wrong sales amount for one staff member"
              rows="3"
              value={correctionReason}
            />
          </label>
          {error ? <div className="alert danger">{error}</div> : null}
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
