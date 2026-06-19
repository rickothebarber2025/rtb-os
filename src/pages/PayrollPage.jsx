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
import { formatCurrency, formatDate, formatPercent } from '../utils/formatters';
import {
  calculateRunTotals,
  createCorrectionDraft,
  createDraftEntry,
  recalculateEntry,
  toMoneyNumber,
} from '../utils/payroll';

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

export default function PayrollPage({
  businessUnit,
  onRefresh,
  payrollRuns,
  staff,
  user,
}) {
  const activeStaff = useMemo(() => staff.filter((member) => member.active), [staff]);
  const [currentRun, setCurrentRun] = useState(() => createInitialRun(businessUnit?.id));
  const [confirmAction, setConfirmAction] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [entries, setEntries] = useState([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState('');
  const previousBusinessUnitId = useRef(null);

  useEffect(() => {
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
  }, [activeStaff, businessUnit?.id, currentRun.id, entries.length]);

  const readOnly = currentRun.status !== 'draft';
  const finalized = ['locked', 'sent'].includes(currentRun.status);
  const totals = useMemo(
    () => calculateRunTotals({ entries, ownerNetSales: currentRun.owner_net_sales }),
    [currentRun.owner_net_sales, entries],
  );
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
    setCurrentRun(createInitialRun(businessUnit?.id));
    setEntries(activeStaff.map(createDraftEntry));
    setError('');
    setNotice('');
  }

  function updateRunField(field, value) {
    setCurrentRun((run) => ({ ...run, [field]: value }));
  }

  function updateEntry(index, field, value) {
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

  async function handleDeleteDraft() {
    if (!currentRun.id || currentRun.status !== 'draft') return;
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
    if (!currentRun.id || !finalized) return;
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
                      {entry.fixed_rate_snapshot ? (
                        <StatusBadge tone="gold">Fixed rate</StatusBadge>
                      ) : entry.adjusted ? (
                        <StatusBadge tone="warning">Adjusted</StatusBadge>
                      ) : null}
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
                  </tr>
                ))}
              </tbody>
            </table>
          </DataTable>
        ) : (
          <EmptyState
            icon={Sparkles}
            title="No active staff"
            message="Add active staff before drafting payroll."
          />
        )}

        {error ? <div className="alert danger">{error}</div> : null}
        {notice ? <div className="alert success">{notice}</div> : null}

        <div className="action-row">
          <button className="ghost-button" type="button" onClick={resetDraft}>
            New draft
          </button>
          <button
            className="secondary-button"
            disabled={saving || readOnly || !entries.length}
            type="button"
            onClick={handleSave}
          >
            <Save size={17} />
            Save draft
          </button>
          <button
            className="primary-button"
            disabled={saving || readOnly || !entries.length}
            type="button"
            onClick={handleLock}
          >
            <LockKeyhole size={17} />
            {saving ? 'Finalizing...' : 'Finalize payroll'}
          </button>
          {currentRun.id && currentRun.status === 'draft' ? (
            <button
              className="ghost-button danger-action"
              disabled={saving}
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
              disabled={saving}
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
        </div>

        <div className="run-list">
          {payrollRuns.map((run) => (
            <button className="run-card" key={run.id} type="button" onClick={() => loadRun(run)}>
              <div>
                <strong>{run.week_label}</strong>
                <span>{formatDate(run.created_at)}</span>
              </div>
              <StatusBadge
                tone={
                  run.status === 'voided'
                    ? 'danger'
                    : run.status === 'draft'
                      ? 'warning'
                      : 'success'
                }
              >
                {run.status}
              </StatusBadge>
              <b>{formatCurrency(run.total_net_sales)}</b>
              {run.status === 'locked' ? (
                <small className={run.performance_saved_at ? 'success-text' : 'danger-text'}>
                  {run.performance_saved_at ? 'Performance saved' : 'Performance missing'}
                </small>
              ) : null}
            </button>
          ))}
          {!payrollRuns.length ? (
            <EmptyState
              icon={CheckCircle2}
              title="No saved runs"
              message="Drafts and locked runs will appear here."
            />
          ) : null}
        </div>
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
