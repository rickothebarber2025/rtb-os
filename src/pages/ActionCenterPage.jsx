import { useEffect, useMemo, useState } from 'react';
import {
  BellRing,
  CheckCircle2,
  ClipboardCheck,
  FileWarning,
  Plus,
  Trash2,
} from 'lucide-react';
import ConfirmDialog from '../components/ConfirmDialog';
import MetricCard from '../components/MetricCard';
import StatusBadge from '../components/StatusBadge';
import { saveAppSetting } from '../services/rtbService';
import { canAdminOperations, canManageOperations } from '../utils/access';
import { isAllBusinessesUnit } from '../utils/businessProfiles';
import {
  ACTION_CENTER_SETTING_KEY,
  buildActionCenterItems,
  createActionId,
  getActionCenterSummary,
  getPriorityIcon,
  normalizeActionCenterState,
  toDateKey,
  updateManualRecord,
} from '../utils/actionCenter';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'urgent', label: 'Urgent' },
  { id: 'probation', label: 'Probation' },
  { id: 'payroll', label: 'Payroll' },
  { id: 'task', label: 'Tasks' },
  { id: 'time_off', label: 'Time Off' },
  { id: 'content', label: 'Content' },
  { id: 'warning', label: 'Warnings' },
  { id: 'docs', label: 'Documents' },
];

const DOCUMENT_OPTIONS = [
  'Commission agreement',
  'Employment contract',
  'Confidentiality agreement',
  'Social media agreement',
  'New hire checklist',
  'Performance review form',
  'Other onboarding document',
];

function blankWarning(staff = []) {
  const first = staff.find((member) => member.active) || staff[0];
  return {
    date: toDateKey(),
    note: '',
    staff_id: first?.id || '',
  };
}

function blankDocument(staff = []) {
  const first = staff.find((member) => member.active) || staff[0];
  return {
    document_name: DOCUMENT_OPTIONS[0],
    due_date: toDateKey(),
    note: '',
    staff_id: first?.id || '',
  };
}

function priorityTone(priority) {
  if (priority === 'urgent') return 'danger';
  if (priority === 'high') return 'warning';
  if (priority === 'medium') return 'gold';
  return 'muted';
}

function getStaffName(staff, staffId) {
  return staff.find((member) => member.id === staffId)?.full_name || 'Staff member';
}

function getStaffOptions(staff) {
  return staff.filter((member) => member.active);
}

function matchesCurrentStaff(record, staffIds, businessUnitId) {
  if (businessUnitId && record.business_unit_id) {
    return record.business_unit_id === businessUnitId;
  }

  if (record.staff_id) {
    return staffIds.has(record.staff_id);
  }

  return true;
}

export default function ActionCenterPage({
  accessProfile,
  actionCenter,
  businessUnit,
  onRefresh,
  payrollRuns,
  setActivePage,
  staff,
  staffHub,
}) {
  const canEditOperations = canManageOperations(accessProfile);
  const canAdminOps = canAdminOperations(accessProfile);
  const normalized = useMemo(() => normalizeActionCenterState(actionCenter), [actionCenter]);
  const [localState, setLocalState] = useState(normalized);
  const [filter, setFilter] = useState('all');
  const [warningForm, setWarningForm] = useState(() => blankWarning(staff));
  const [documentForm, setDocumentForm] = useState(() => blankDocument(staff));
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const scopedBusinessUnitId = isAllBusinessesUnit(businessUnit) ? null : businessUnit?.id;
  const staffOptions = useMemo(() => getStaffOptions(staff), [staff]);
  const staffIds = useMemo(() => new Set(staff.map((member) => member.id).filter(Boolean)), [staff]);

  useEffect(() => {
    setLocalState(normalized);
  }, [normalized]);

  useEffect(() => {
    setWarningForm((current) =>
      staffOptions.some((member) => member.id === current.staff_id) ? current : blankWarning(staff),
    );
    setDocumentForm((current) =>
      staffOptions.some((member) => member.id === current.staff_id) ? current : blankDocument(staff),
    );
  }, [staff, staffOptions]);

  const items = useMemo(
    () =>
      buildActionCenterItems({
        accessProfile,
        actionCenter: localState,
        businessUnitId: scopedBusinessUnitId,
        contentSubmissions: staffHub?.contentSubmissions || [],
        payrollRuns,
        staff,
        tasks: staffHub?.tasks || [],
        timeOffRequests: staffHub?.timeOffRequests || [],
      }),
    [accessProfile, localState, payrollRuns, scopedBusinessUnitId, staff, staffHub],
  );
  const summary = getActionCenterSummary(items);
  const filteredItems = items.filter((item) => {
    if (filter === 'all') return true;
    if (filter === 'urgent') return item.priority === 'urgent' || item.priority === 'high';
    return item.category === filter;
  });
  const activeWarnings = localState.warnings.filter(
    (warning) =>
      !warning.resolved_at && matchesCurrentStaff(warning, staffIds, scopedBusinessUnitId),
  );
  const activeDocuments = localState.documents.filter(
    (document) =>
      !document.resolved_at && matchesCurrentStaff(document, staffIds, scopedBusinessUnitId),
  );

  async function persist(nextState, message) {
    if (!canEditOperations) {
      setError('Operations edit access is required to update Action Center records.');
      return;
    }

    setLocalState(nextState);
    setSaving(true);
    setError('');
    setNotice('');

    try {
      await saveAppSetting(ACTION_CENTER_SETTING_KEY, nextState);
      await onRefresh();
      setNotice(message);
    } catch (err) {
      setError(err.message || 'Unable to save Action Center.');
    } finally {
      setSaving(false);
    }
  }

  function addWarning(event) {
    event.preventDefault();
    const selectedStaff = staff.find((member) => member.id === warningForm.staff_id);
    const staffName = selectedStaff?.full_name || getStaffName(staff, warningForm.staff_id);
    const nextWarning = {
      business_unit_id: selectedStaff?.business_unit_id || null,
      date: warningForm.date || toDateKey(),
      id: createActionId('warning'),
      note: warningForm.note.trim(),
      staff_id: warningForm.staff_id,
      staff_name: staffName,
    };

    persist(
      {
        ...localState,
        warnings: [nextWarning, ...localState.warnings],
      },
      `Warning recorded for ${staffName}.`,
    );
    setWarningForm(blankWarning(staff));
  }

  function addDocument(event) {
    event.preventDefault();
    const selectedStaff = staff.find((member) => member.id === documentForm.staff_id);
    const staffName = selectedStaff?.full_name || getStaffName(staff, documentForm.staff_id);
    const nextDocument = {
      business_unit_id: selectedStaff?.business_unit_id || null,
      document_name: documentForm.document_name.trim() || 'Onboarding document',
      due_date: documentForm.due_date || '',
      id: createActionId('document'),
      note: documentForm.note.trim(),
      staff_id: documentForm.staff_id,
      staff_name: staffName,
    };

    persist(
      {
        ...localState,
        documents: [nextDocument, ...localState.documents],
      },
      `Missing document added for ${staffName}.`,
    );
    setDocumentForm(blankDocument(staff));
  }

  function resolveManualItem(type, id) {
    const resolvedAt = new Date().toISOString();
    const key = type === 'warning' ? 'warnings' : 'documents';
    persist(
      {
        ...localState,
        [key]: updateManualRecord(localState[key], id, (record) => ({
          ...record,
          resolved_at: resolvedAt,
        })),
      },
      type === 'warning' ? 'Warning marked resolved.' : 'Document marked complete.',
    );
  }

  function deleteManualItem() {
    if (!deleteTarget) return;
    if (!canAdminOps) {
      setError('Operations admin access is required to delete manual Action Center records.');
      setDeleteTarget(null);
      return;
    }

    const key = deleteTarget.type === 'warning' ? 'warnings' : 'documents';

    persist(
      {
        ...localState,
        [key]: localState[key].filter((record) => record.id !== deleteTarget.id),
      },
      deleteTarget.type === 'warning' ? 'Warning removed.' : 'Document item removed.',
    );
    setDeleteTarget(null);
  }

  return (
    <div className="page-grid action-center-page">
      <section className="hero-panel full-span">
        <div>
          <h2>Action Center</h2>
          <p>
            The issues that need attention come to you: probation deadlines, payroll drafts,
            staff warnings, and missing onboarding documents.
          </p>
        </div>
        <button className="secondary-button" type="button" onClick={onRefresh}>
          Refresh live data
        </button>
      </section>

      {notice ? <div className="alert success full-span">{notice}</div> : null}
      {error ? <div className="alert danger full-span">{error}</div> : null}
      {!canEditOperations ? (
        <div className="alert warning full-span">
          <strong>Action Center view-only mode.</strong>
          <span>Operations edit access is required to add, resolve, or complete manual records.</span>
        </div>
      ) : null}

      <section className="metrics-grid">
        <MetricCard icon={BellRing} label="Open actions" trend="Need attention" value={summary.total} />
        <MetricCard icon={FileWarning} label="Urgent actions" trend="Highest priority" value={summary.urgent} />
        <MetricCard icon={ClipboardCheck} label="Manual trackers" trend="Warnings + docs" value={summary.manual} />
        <MetricCard icon={CheckCircle2} label="Automatic checks" trend="Live data" value={summary.automatic} />
      </section>

      <section className="panel full-span">
        <div className="section-header">
          <div>
            <span>Attention</span>
            <h2>What needs your attention</h2>
          </div>
          <StatusBadge tone={summary.urgent ? 'warning' : summary.total ? 'gold' : 'success'}>
            {summary.total ? `${summary.total} open` : 'Clear'}
          </StatusBadge>
        </div>

        <div className="insight-tabs action-filter-tabs">
          {FILTERS.map((option) => (
            <button
              className={filter === option.id ? 'active' : ''}
              key={option.id}
              type="button"
              onClick={() => setFilter(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        {filteredItems.length ? (
          <div className="action-list">
            {filteredItems.map((item) => {
              const Icon = getPriorityIcon(item.category);
              return (
                <article className={`action-card ${item.priority}`} key={item.id}>
                  <div className="action-card__icon">
                    <Icon size={20} />
                  </div>
                  <div>
                    <div className="action-card__meta">
                      <StatusBadge tone={priorityTone(item.priority)}>{item.priority}</StatusBadge>
                      <span>{item.categoryLabel}</span>
                      <span>{item.source}</span>
                    </div>
                    <h3>{item.title}</h3>
                    <p>{item.detail}</p>
                    <div className="action-row">
                      <button
                        className="primary-button small"
                        type="button"
                        onClick={() => setActivePage(item.page)}
                      >
                        {item.actionLabel}
                      </button>
                      {item.resolveType ? (
                        <button
                          className="secondary-button small"
                          disabled={saving || !canEditOperations}
                          title={!canEditOperations ? 'Operations edit access is required.' : undefined}
                          type="button"
                          onClick={() => resolveManualItem(item.resolveType, item.id.replace('document-', ''))}
                        >
                          Mark complete
                        </button>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="empty-state compact">
            <h3>No open actions in this view</h3>
            <p>Switch filters or add a manual tracker below.</p>
          </div>
        )}
      </section>

      <section className="panel two-thirds">
        <div className="section-header">
          <div>
            <span>Manual tracker</span>
            <h2>Add staff warning</h2>
          </div>
        </div>
        <form className="stack" onSubmit={addWarning}>
          <div className="form-grid">
            <label className="field">
              <span>Staff</span>
              <select
                disabled={!canEditOperations}
                required
                value={warningForm.staff_id}
                onChange={(event) => setWarningForm({ ...warningForm, staff_id: event.target.value })}
              >
                {!staffOptions.length ? <option value="">No active staff</option> : null}
                {staffOptions.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.full_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Date</span>
              <input
                disabled={!canEditOperations}
                required
                type="date"
                value={warningForm.date}
                onChange={(event) => setWarningForm({ ...warningForm, date: event.target.value })}
              />
            </label>
            <label className="field wide">
              <span>Note</span>
              <textarea
                disabled={!canEditOperations}
                placeholder="What happened and what follow-up is needed?"
                value={warningForm.note}
                onChange={(event) => setWarningForm({ ...warningForm, note: event.target.value })}
              />
            </label>
          </div>
          <button
            className="primary-button"
            disabled={saving || !warningForm.staff_id || !canEditOperations}
            title={!canEditOperations ? 'Operations edit access is required.' : undefined}
            type="submit"
          >
            <Plus size={16} />
            Add warning
          </button>
        </form>
      </section>

      <section className="panel">
        <div className="section-header">
          <div>
            <span>Manual tracker</span>
            <h2>Missing document</h2>
          </div>
        </div>
        <form className="stack" onSubmit={addDocument}>
          <label className="field">
            <span>Staff</span>
            <select
              disabled={!canEditOperations}
              required
              value={documentForm.staff_id}
              onChange={(event) => setDocumentForm({ ...documentForm, staff_id: event.target.value })}
            >
              {!staffOptions.length ? <option value="">No active staff</option> : null}
              {staffOptions.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.full_name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Document</span>
            <select
              disabled={!canEditOperations}
              value={documentForm.document_name}
              onChange={(event) => setDocumentForm({ ...documentForm, document_name: event.target.value })}
            >
              {DOCUMENT_OPTIONS.map((document) => (
                <option key={document}>{document}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Due date</span>
            <input
              disabled={!canEditOperations}
              type="date"
              value={documentForm.due_date}
              onChange={(event) => setDocumentForm({ ...documentForm, due_date: event.target.value })}
            />
          </label>
          <button
            className="primary-button"
            disabled={saving || !documentForm.staff_id || !canEditOperations}
            title={!canEditOperations ? 'Operations edit access is required.' : undefined}
            type="submit"
          >
            <Plus size={16} />
            Add document gap
          </button>
        </form>
      </section>

      <section className="panel full-span">
        <div className="section-header">
          <div>
            <span>Manual records</span>
            <h2>Warnings and document gaps</h2>
          </div>
        </div>
        <div className="manual-record-grid">
          <div>
            <h3>Active warnings</h3>
            {activeWarnings.length ? (
              activeWarnings.map((warning) => (
                <div className="manual-record" key={warning.id}>
                  <div>
                    <strong>{warning.staff_name}</strong>
                    <span>{warning.date}</span>
                    <p>{warning.note || 'No note saved.'}</p>
                  </div>
                  <div className="row-actions">
                    <button
                      className="secondary-button small"
                      disabled={saving || !canEditOperations}
                      title={!canEditOperations ? 'Operations edit access is required.' : undefined}
                      type="button"
                      onClick={() => resolveManualItem('warning', warning.id)}
                    >
                      Resolve
                    </button>
                    <button
                      className="icon-button small danger"
                      disabled={!canAdminOps}
                      type="button"
                      aria-label="Delete warning"
                      title={!canAdminOps ? 'Operations admin access is required.' : undefined}
                      onClick={() => setDeleteTarget({ id: warning.id, type: 'warning' })}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <p className="subtle-text">No active warnings recorded.</p>
            )}
          </div>

          <div>
            <h3>Missing documents</h3>
            {activeDocuments.length ? (
              activeDocuments.map((document) => (
                <div className="manual-record" key={document.id}>
                  <div>
                    <strong>{document.staff_name}</strong>
                    <span>{document.document_name} {document.due_date ? `- due ${document.due_date}` : ''}</span>
                    <p>{document.note || 'Waiting for document.'}</p>
                  </div>
                  <div className="row-actions">
                    <button
                      className="secondary-button small"
                      disabled={saving || !canEditOperations}
                      title={!canEditOperations ? 'Operations edit access is required.' : undefined}
                      type="button"
                      onClick={() => resolveManualItem('document', document.id)}
                    >
                      Complete
                    </button>
                    <button
                      className="icon-button small danger"
                      disabled={!canAdminOps}
                      type="button"
                      aria-label="Delete missing document"
                      title={!canAdminOps ? 'Operations admin access is required.' : undefined}
                      onClick={() => setDeleteTarget({ id: document.id, type: 'document' })}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <p className="subtle-text">No missing onboarding documents recorded.</p>
            )}
          </div>
        </div>
      </section>

      {deleteTarget ? (
        <ConfirmDialog
          busy={saving}
          confirmLabel="Delete"
          description="Delete this manual Action Center record? Use resolve/complete instead when the issue was actually handled."
          onClose={() => setDeleteTarget(null)}
          onConfirm={deleteManualItem}
          title="Delete manual record"
        />
      ) : null}
    </div>
  );
}
