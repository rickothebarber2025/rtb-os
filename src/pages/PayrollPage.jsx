import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, LockKeyhole, Save, SendToBack, Sparkles } from 'lucide-react';
import DataTable from '../components/DataTable';
import EmptyState from '../components/EmptyState';
import StatusBadge from '../components/StatusBadge';
import {
  lockPayrollRun,
  savePayrollDraft,
  savePerformanceFromRun,
} from '../services/rtbService';
import { getDefaultPayrollWeek } from '../utils/dates';
import { formatCurrency, formatDate, formatPercent } from '../utils/formatters';
import {
  calculateRunTotals,
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
  const [entries, setEntries] = useState([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
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

  const locked = currentRun.status === 'locked';
  const totals = useMemo(
    () => calculateRunTotals({ entries, ownerNetSales: currentRun.owner_net_sales }),
    [currentRun.owner_net_sales, entries],
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
      id: run.id,
      notes: run.notes || '',
      owner_net_sales: Number(run.owner_net_sales || 0),
      owner_tips: Number(run.owner_tips || 0),
      status: run.status,
      week_end: run.week_end || '',
      week_label: run.week_label,
      week_start: run.week_start || '',
    });
    setEntries(
      (run.payroll_entries || []).map((entry) =>
        recalculateEntry({
          ...entry,
          net_sales: Number(entry.net_sales || 0),
          tips: Number(entry.tips || 0),
        }),
      ),
    );
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
      const saved = currentRun.id ? await persistDraft('draft') : await persistDraft('draft');
      await lockPayrollRun(saved.id);
      setCurrentRun((run) => ({ ...run, id: saved.id, status: 'locked' }));
      await onRefresh();
      setNotice('Payroll run locked.');
    } catch (err) {
      setError(err.message || 'Unable to lock payroll run.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSavePerformance() {
    if (!currentRun.id) return;
    setSaving(true);
    setError('');
    setNotice('');

    try {
      await savePerformanceFromRun(currentRun.id);
      await onRefresh();
      setNotice('Performance saved from locked payroll.');
    } catch (err) {
      setError(err.message || 'Unable to save performance.');
    } finally {
      setSaving(false);
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
          <StatusBadge tone={locked ? 'success' : 'warning'}>{currentRun.status}</StatusBadge>
        </div>

        <div className="form-grid compact">
          <label className="field">
            <span>Week label</span>
            <input
              disabled={locked}
              onChange={(event) => updateRunField('week_label', event.target.value)}
              value={currentRun.week_label || ''}
            />
          </label>
          <label className="field">
            <span>Week start</span>
            <input
              disabled={locked}
              onChange={(event) => updateRunField('week_start', event.target.value)}
              type="date"
              value={currentRun.week_start || ''}
            />
          </label>
          <label className="field">
            <span>Week end</span>
            <input
              disabled={locked}
              onChange={(event) => updateRunField('week_end', event.target.value)}
              type="date"
              value={currentRun.week_end || ''}
            />
          </label>
          <label className="field">
            <span>Owner net sales</span>
            <input
              disabled={locked}
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
              disabled={locked}
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
              disabled={locked}
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
                        disabled={locked}
                        min="0"
                        onChange={(event) => updateEntry(index, 'net_sales', event.target.value)}
                        step="0.01"
                        type="number"
                        value={entry.net_sales}
                      />
                    </td>
                    <td>
                      <input
                        disabled={locked}
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
                        disabled={locked}
                        onChange={(event) => updateEntry(index, 'notes', event.target.value)}
                        placeholder="Optional"
                        value={entry.notes || ''}
                      />
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
            disabled={saving || locked || !entries.length}
            type="button"
            onClick={handleSave}
          >
            <Save size={17} />
            Save draft
          </button>
          <button
            className="secondary-button"
            disabled={saving || locked || !entries.length}
            type="button"
            onClick={handleLock}
          >
            <LockKeyhole size={17} />
            Lock run
          </button>
          <button
            className="primary-button"
            disabled={saving || !currentRun.id || !locked}
            type="button"
            onClick={handleSavePerformance}
          >
            <SendToBack size={17} />
            Save performance
          </button>
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
              <StatusBadge tone={run.status === 'locked' ? 'success' : 'warning'}>
                {run.status}
              </StatusBadge>
              <b>{formatCurrency(run.total_net_sales)}</b>
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
    </div>
  );
}
