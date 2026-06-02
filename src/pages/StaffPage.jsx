import { useMemo, useState } from 'react';
import { Plus, Trash2, UserMinus, Users } from 'lucide-react';
import DataTable from '../components/DataTable';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';
import ProbationProgressCard from '../components/ProbationProgressCard';
import StatusBadge from '../components/StatusBadge';
import { deactivateStaff, deleteStaff, saveStaff } from '../services/rtbService';
import { canDeleteStaff, canManageStaff } from '../utils/access';
import { formatDate, formatPercent } from '../utils/formatters';
import {
  isProbationStaff,
  PROBATION_RATE,
  STANDARD_RTB_RATE,
  toDateKey,
  toGraduationPayload,
  toProbationPayload,
} from '../utils/probation';

const blankStaff = {
  active: true,
  commission_rate: STANDARD_RTB_RATE,
  email: '',
  fixed_rate: false,
  full_name: '',
  notes: '',
  phone: '',
  role: 'Staff',
  start_date: '',
  tier: 'standard',
};

export default function StaffPage({ accessProfile, businessUnit, onRefresh, staff }) {
  const canManage = canManageStaff(accessProfile);
  const canDelete = canDeleteStaff(accessProfile);
  const [filter, setFilter] = useState('active');
  const [editing, setEditing] = useState(null);
  const [editingProbationId, setEditingProbationId] = useState('');
  const [form, setForm] = useState(blankStaff);
  const [probationDraftStart, setProbationDraftStart] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  const activeProbationStaff = useMemo(
    () => staff.filter((member) => member.active && isProbationStaff(member)),
    [staff],
  );

  const filteredStaff = useMemo(() => {
    const regularRoster = staff.filter((member) => !(member.active && isProbationStaff(member)));

    if (filter === 'active') return regularRoster.filter((member) => member.active);
    if (filter === 'inactive') return regularRoster.filter((member) => !member.active);
    if (filter === 'fixed') return regularRoster.filter((member) => member.fixed_rate);
    return regularRoster;
  }, [filter, staff]);

  function openCreate() {
    if (!canManage) return;
    setEditing(null);
    setForm({ ...blankStaff, business_unit_id: businessUnit?.id });
    setError('');
    setNotice('');
  }

  function openEdit(member) {
    if (!canManage) return;
    setEditing(member);
    setForm({
      ...member,
      commission_rate: Number(member.commission_rate || 0),
      email: member.email || '',
      notes: member.notes || '',
      phone: member.phone || '',
      start_date: member.start_date || '',
    });
    setError('');
    setNotice('');
  }

  function closeModal() {
    setEditing(null);
    setForm(blankStaff);
    setError('');
  }

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateTier(tier) {
    setForm((current) => {
      if (tier === 'probation') {
        return {
          ...current,
          commission_rate: PROBATION_RATE,
          fixed_rate: false,
          start_date: current.start_date || toDateKey(),
          tier,
        };
      }

      return {
        ...current,
        commission_rate:
          current.tier === 'probation' ? STANDARD_RTB_RATE : current.commission_rate,
        tier,
      };
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canManage) return;
    setSaving(true);
    setError('');
    setNotice('');

    try {
      const staffPayload =
        form.tier === 'probation'
          ? toProbationPayload(form, form.start_date || toDateKey())
          : form;

      const saved = await saveStaff({
        ...staffPayload,
        business_unit_id: businessUnit?.id,
        id: editing?.id,
      });
      await onRefresh();
      setNotice(`${saved.full_name} was saved.`);
      closeModal();
    } catch (err) {
      setError(err.message || 'Unable to save staff profile.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(member) {
    if (!canManage) return;
    const confirmed = window.confirm(`Deactivate ${member.full_name}? They will move to the inactive staff view.`);
    if (!confirmed) return;

    setSaving(true);
    setError('');
    setNotice('');

    try {
      await deactivateStaff(member.id);
      await onRefresh();
      setNotice(`${member.full_name} was deactivated.`);
    } catch (err) {
      setError(err.message || 'Unable to deactivate staff profile.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(member) {
    if (!canDelete) return;
    const confirmed = window.confirm(
      `Delete ${member.full_name}? This only works when the profile is not tied to payroll, performance, or booth rent records.`,
    );
    if (!confirmed) return;

    setSaving(true);
    setError('');
    setNotice('');

    try {
      await deleteStaff(member.id);
      await onRefresh();
      setNotice(`${member.full_name} was deleted.`);
    } catch (err) {
      setError(err.message || 'Unable to delete staff profile.');
    } finally {
      setSaving(false);
    }
  }

  async function handleGraduate(member) {
    if (!canManage) return;
    const confirmed = window.confirm(`Graduate ${member.full_name} to Standard RTB at 60%?`);
    if (!confirmed) return;

    setSaving(true);
    setError('');
    setNotice('');

    try {
      await saveStaff(toGraduationPayload(member));
      await onRefresh();
      setNotice(`${member.full_name} graduated to Standard RTB.`);
    } catch (err) {
      setError(err.message || 'Unable to graduate staff profile.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveProbationDate(member, startDate) {
    if (!canManage) return;
    setSaving(true);
    setError('');
    setNotice('');

    try {
      await saveStaff(toProbationPayload(member, startDate || toDateKey()));
      await onRefresh();
      setEditingProbationId('');
      setProbationDraftStart('');
      setNotice(`${member.full_name}'s probation date was updated.`);
    } catch (err) {
      setError(err.message || 'Unable to update probation date.');
    } finally {
      setSaving(false);
    }
  }

  async function handleMoveToProbation(member) {
    if (!canManage) return;
    const enteredDate = window.prompt(
      `Probation start date for ${member.full_name}`,
      toDateKey(),
    );

    if (enteredDate === null) return;

    setSaving(true);
    setError('');
    setNotice('');

    try {
      await saveStaff(toProbationPayload(member, enteredDate.trim() || toDateKey()));
      await onRefresh();
      setNotice(`${member.full_name} moved to probation at ${formatPercent(PROBATION_RATE)}.`);
    } catch (err) {
      setError(err.message || 'Unable to move staff onto probation.');
    } finally {
      setSaving(false);
    }
  }

  const modalOpen = editing !== null || form.business_unit_id;
  const showProbationSection = filter !== 'inactive' && activeProbationStaff.length > 0;

  return (
    <div className="page-grid">
      {showProbationSection ? (
        <section className="panel full-span probation-section">
          <div className="section-header">
            <div>
              <span>Probation</span>
              <h2>90-day staff progress</h2>
            </div>
            <StatusBadge tone="gold">{activeProbationStaff.length} active</StatusBadge>
          </div>
          <div className="probation-grid">
            {activeProbationStaff.map((member) => (
              <ProbationProgressCard
                editing={editingProbationId === member.id}
                key={member.id}
                member={member}
                onCancelEdit={() => {
                  setEditingProbationId('');
                  setProbationDraftStart('');
                }}
                onEdit={() => {
                  setEditingProbationId(member.id);
                  setProbationDraftStart(member.start_date || toDateKey());
                }}
                onGraduate={() => handleGraduate(member)}
                onSaveDate={(startDate) => handleSaveProbationDate(member, startDate)}
                saving={saving}
                setStartDateDraft={setProbationDraftStart}
                showActions={canManage}
                startDateDraft={editingProbationId === member.id ? probationDraftStart : ''}
              />
            ))}
          </div>
        </section>
      ) : null}

      <section className="panel full-span">
        <div className="section-header">
          <div>
            <span>Roster</span>
            <h2>Staff profiles</h2>
          </div>
          {canManage ? (
            <button className="primary-button" type="button" onClick={openCreate}>
              <Plus size={17} />
              Add staff
            </button>
          ) : null}
        </div>

        <div className="toolbar">
          {['active', 'all', 'fixed', 'inactive'].map((item) => (
            <button
              className={filter === item ? 'active' : ''}
              key={item}
              type="button"
              onClick={() => setFilter(item)}
            >
              {item}
            </button>
          ))}
        </div>

        {error ? <div className="alert danger">{error}</div> : null}
        {notice ? <div className="alert success">{notice}</div> : null}

        {filteredStaff.length ? (
          <DataTable>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Tier</th>
                  <th>Commission</th>
                  <th>Status</th>
                  <th>Contact</th>
                  <th>Start</th>
                  {canManage ? <th>Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {filteredStaff.map((member) => (
                  <tr key={member.id}>
                    <td>
                      <div className="person-cell">
                        <strong>{member.full_name}</strong>
                        <span>{member.notes || 'No notes'}</span>
                      </div>
                    </td>
                    <td>{member.role}</td>
                    <td>{member.tier}</td>
                    <td>
                      <strong>{formatPercent(member.commission_rate)}</strong>
                      {member.fixed_rate ? (
                        <StatusBadge tone="gold">Fixed rate</StatusBadge>
                      ) : null}
                    </td>
                    <td>
                      <StatusBadge tone={member.active ? 'success' : 'muted'}>
                        {member.active ? 'Active' : 'Inactive'}
                      </StatusBadge>
                    </td>
                    <td>
                      <div className="person-cell">
                        <span>{member.email || 'No email'}</span>
                        <span>{member.phone || 'No phone'}</span>
                      </div>
                    </td>
                    <td>{formatDate(member.start_date)}</td>
                    {canManage ? (
                      <td>
                        <div className="row-actions">
                          <button className="ghost-button small" type="button" onClick={() => openEdit(member)}>
                            Edit
                          </button>
                          {member.active && !isProbationStaff(member) ? (
                            <button
                              className="ghost-button small"
                              disabled={saving}
                              type="button"
                              onClick={() => handleMoveToProbation(member)}
                            >
                              Prob
                            </button>
                          ) : null}
                          {member.active ? (
                            <button
                              className="icon-button danger"
                              disabled={saving}
                              type="button"
                              onClick={() => handleDeactivate(member)}
                              aria-label={`Deactivate ${member.full_name}`}
                            >
                              <UserMinus size={16} />
                            </button>
                          ) : null}
                          {canDelete ? (
                            <button
                              className="icon-button danger"
                              disabled={saving}
                              type="button"
                              onClick={() => handleDelete(member)}
                              aria-label={`Delete ${member.full_name}`}
                            >
                              <Trash2 size={16} />
                            </button>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </DataTable>
        ) : (
          <EmptyState
            icon={Users}
            title="No staff in this view"
            message="Switch filters or add a staff profile."
            action={canManage ? (
              <button className="ghost-button" type="button" onClick={openCreate}>
                Add staff
              </button>
            ) : null}
          />
        )}
      </section>

      {modalOpen && canManage ? (
        <Modal title={editing ? 'Edit staff' : 'Add staff'} onClose={closeModal}>
          <form className="stack" onSubmit={handleSubmit}>
            <div className="form-grid">
              <label className="field">
                <span>Full name</span>
                <input
                  onChange={(event) => updateField('full_name', event.target.value)}
                  required
                  value={form.full_name}
                />
              </label>
              <label className="field">
                <span>Role</span>
                <input
                  onChange={(event) => updateField('role', event.target.value)}
                  required
                  value={form.role}
                />
              </label>
              <label className="field">
                <span>Tier</span>
                <select onChange={(event) => updateTier(event.target.value)} value={form.tier}>
                  <option value="probation">probation</option>
                  <option value="review">review</option>
                  <option value="standard">standard</option>
                  <option value="growth">growth</option>
                  <option value="elite">elite</option>
                  <option value="booth">booth</option>
                </select>
              </label>
              <label className="field">
                <span>Commission rate</span>
                <input
                  disabled={form.tier === 'probation'}
                  min="0"
                  onChange={(event) => updateField('commission_rate', Number(event.target.value))}
                  step="0.01"
                  type="number"
                  value={form.commission_rate}
                />
              </label>
              <label className="field">
                <span>Email</span>
                <input
                  onChange={(event) => updateField('email', event.target.value)}
                  type="email"
                  value={form.email}
                />
              </label>
              <label className="field">
                <span>Phone</span>
                <input
                  onChange={(event) => updateField('phone', event.target.value)}
                  value={form.phone}
                />
              </label>
              {form.tier === 'probation' ? (
                <label className="field">
                  <span>Probation start date</span>
                  <input
                    onChange={(event) => updateField('start_date', event.target.value)}
                    type="date"
                    value={form.start_date || toDateKey()}
                  />
                </label>
              ) : null}
              <label className="check-row">
                <input
                  checked={Boolean(form.fixed_rate)}
                  disabled={form.tier === 'probation'}
                  onChange={(event) => updateField('fixed_rate', event.target.checked)}
                  type="checkbox"
                />
                <span>Fixed-rate staff</span>
              </label>
              <label className="check-row">
                <input
                  checked={Boolean(form.active)}
                  onChange={(event) => updateField('active', event.target.checked)}
                  type="checkbox"
                />
                <span>Active profile</span>
              </label>
              <label className="field wide">
                <span>Notes</span>
                <textarea
                  onChange={(event) => updateField('notes', event.target.value)}
                  rows="3"
                  value={form.notes || ''}
                />
              </label>
            </div>

            {error ? <div className="alert danger">{error}</div> : null}

            <div className="action-row end">
              <button className="ghost-button" type="button" onClick={closeModal}>
                Cancel
              </button>
              <button className="primary-button" disabled={saving} type="submit">
                {saving ? 'Saving...' : 'Save staff'}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
