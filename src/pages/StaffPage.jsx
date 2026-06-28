import { useMemo, useState } from 'react';
import { Pencil, Plus, RotateCcw, Trash2, UserMinus, Users } from 'lucide-react';
import ConfirmDialog from '../components/ConfirmDialog';
import DataTable from '../components/DataTable';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';
import ProbationProgressCard from '../components/ProbationProgressCard';
import StatusBadge from '../components/StatusBadge';
import { deactivateStaff, deleteStaff, saveAppSetting, saveStaff } from '../services/rtbService';
import { canDeleteStaff, canManageStaff } from '../utils/access';
import {
  getBusinessProfile,
  isAllBusinessesUnit,
  suggestInstagramHandle,
} from '../utils/businessProfiles';
import { formatDate, formatPercent } from '../utils/formatters';
import {
  isProbationStaff,
  PROBATION_RATE,
  STANDARD_RTB_RATE,
  toDateKey,
  toGraduationPayload,
  toProbationPayload,
} from '../utils/probation';
import {
  STAFF_BUSINESS_METADATA_KEY,
  mergeStaffBusinessMetadata,
  staffBusinessIds,
} from '../utils/staffBusiness';

const blankStaff = {
  active: true,
  assigned_business_ids: [],
  booking_platform_profile: '',
  commission_rate: STANDARD_RTB_RATE,
  commission_type: 'Commission',
  email: '',
  fixed_rate: false,
  full_name: '',
  instagram_handle: '',
  instagram_manual_override: false,
  instagram_rule: 'firstname.rtb_lounge',
  notes: '',
  phone: '',
  pos_profile: '',
  probation_start_date: '',
  role: 'Staff',
  start_date: '',
  tier: 'standard',
};

export default function StaffPage({
  accessProfile,
  businessUnit,
  businessUnits,
  onRefresh,
  staff,
  staffBusinessMetadata,
}) {
  const canManage = canManageStaff(accessProfile);
  const canDelete = canDeleteStaff(accessProfile);
  const allBusinessesView = isAllBusinessesUnit(businessUnit);
  const [filter, setFilter] = useState('active');
  const [editing, setEditing] = useState(null);
  const [editingProbationId, setEditingProbationId] = useState('');
  const [confirmAction, setConfirmAction] = useState(null);
  const [form, setForm] = useState(blankStaff);
  const [probationTarget, setProbationTarget] = useState(null);
  const [probationDraftStart, setProbationDraftStart] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const selectedBusinessProfile = getBusinessProfile(businessUnit);

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
    if (!canManage || allBusinessesView) return;
    setEditing(null);
    setForm({
      ...blankStaff,
      assigned_business_ids: [businessUnit?.id].filter(Boolean),
      business_unit_id: businessUnit?.id,
      instagram_rule: selectedBusinessProfile.instagram_format,
      role: selectedBusinessProfile.staff_roles[0] || 'Staff',
    });
    setError('');
    setNotice('');
  }

  function openEdit(member) {
    if (!canManage) return;
    const primaryBusiness = businessUnits.find((unit) => unit.id === member.business_unit_id);
    const primaryProfile = getBusinessProfile(primaryBusiness);
    setEditing(member);
    setForm({
      ...member,
      assigned_business_ids: staffBusinessIds(member),
      booking_platform_profile: member.booking_platform_profile || member.full_name || '',
      commission_rate: Number(member.commission_rate || 0),
      commission_type: member.commission_type || (member.fixed_rate ? 'Fixed rate' : 'Commission'),
      email: member.email || '',
      instagram_handle: member.instagram_handle || '',
      instagram_manual_override: Boolean(member.instagram_manual_override),
      instagram_rule: member.instagram_rule || primaryProfile.instagram_format,
      notes: member.notes || '',
      phone: member.phone || '',
      pos_profile: member.pos_profile || member.full_name || '',
      probation_start_date: member.probation_start_date || '',
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
    setForm((current) => {
      const next = { ...current, [field]: value };
      if (field === 'full_name' && !current.instagram_manual_override) {
        next.instagram_handle = suggestInstagramHandle(value, current.instagram_rule);
      }
      return next;
    });
  }

  function updatePrimaryBusiness(businessUnitId) {
    const nextBusiness = businessUnits.find((unit) => unit.id === businessUnitId);
    const profile = getBusinessProfile(nextBusiness);
    setForm((current) => {
      const next = {
        ...current,
        assigned_business_ids: [
          ...new Set([businessUnitId, ...(current.assigned_business_ids || [])]),
        ],
        business_unit_id: businessUnitId,
        instagram_rule: current.instagram_rule || profile.instagram_format,
        role: current.role || profile.staff_roles[0] || 'Staff',
      };
      if (!current.instagram_manual_override) {
        next.instagram_handle = suggestInstagramHandle(current.full_name, next.instagram_rule);
      }
      return next;
    });
  }

  function updateInstagramRule(rule) {
    setForm((current) => ({
      ...current,
      instagram_handle: current.instagram_manual_override
        ? current.instagram_handle
        : suggestInstagramHandle(current.full_name, rule),
      instagram_rule: rule,
    }));
  }

  function updateInstagramHandle(value) {
    setForm((current) => ({
      ...current,
      instagram_handle: value,
      instagram_manual_override: true,
    }));
  }

  function toggleBusinessAssignment(businessUnitId, checked) {
    setForm((current) => {
      const currentIds = new Set(current.assigned_business_ids || []);
      if (checked) currentIds.add(businessUnitId);
      if (!checked && businessUnitId !== current.business_unit_id) currentIds.delete(businessUnitId);
      currentIds.add(current.business_unit_id);
      return { ...current, assigned_business_ids: [...currentIds] };
    });
  }

  function updateTier(tier) {
    setForm((current) => {
      if (tier === 'probation') {
        return {
          ...current,
          commission_rate: PROBATION_RATE,
          fixed_rate: false,
          probation_start_date: current.probation_start_date || toDateKey(),
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
          ? toProbationPayload(form, form.probation_start_date || toDateKey())
          : form;

      const primaryBusinessId = form.business_unit_id || businessUnit?.id;
      const saved = await saveStaff({
        ...staffPayload,
        business_unit_id: primaryBusinessId,
        id: editing?.id,
      });
      await saveAppSetting(
        STAFF_BUSINESS_METADATA_KEY,
        mergeStaffBusinessMetadata(staffBusinessMetadata, saved.id, {
          assigned_business_ids: [
            primaryBusinessId,
            ...(form.assigned_business_ids || []),
          ],
          booking_platform_profile: form.booking_platform_profile || saved.full_name,
          commission_type: form.commission_type || (saved.fixed_rate ? 'Fixed rate' : 'Commission'),
          instagram_handle:
            form.instagram_handle ||
            suggestInstagramHandle(saved.full_name, form.instagram_rule),
          instagram_manual_override: Boolean(form.instagram_manual_override),
          instagram_rule: form.instagram_rule || selectedBusinessProfile.instagram_format,
          pos_profile: form.pos_profile || saved.full_name,
        }),
      );
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
    setSaving(true);
    setError('');
    setNotice('');

    try {
      await deactivateStaff(member.id);
      await onRefresh();
      setNotice(`${member.full_name} was deactivated.`);
      return true;
    } catch (err) {
      setError(err.message || 'Unable to deactivate staff profile.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(member) {
    if (!canDelete) return;
    setSaving(true);
    setError('');
    setNotice('');

    try {
      await deleteStaff(member.id);
      await onRefresh();
      setNotice(`${member.full_name} was deleted.`);
      return true;
    } catch (err) {
      setError(err.message || 'Unable to delete staff profile.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleGraduate(member) {
    if (!canManage) return;
    setSaving(true);
    setError('');
    setNotice('');

    try {
      await saveStaff(toGraduationPayload(member));
      await onRefresh();
      setNotice(`${member.full_name} graduated to Standard RTB.`);
      return true;
    } catch (err) {
      setError(err.message || 'Unable to graduate staff profile.');
      return false;
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
    setSaving(true);
    setError('');
    setNotice('');

    try {
      await saveStaff(
        toProbationPayload(member, probationDraftStart.trim() || toDateKey()),
      );
      await onRefresh();
      setNotice(`${member.full_name} moved to probation at ${formatPercent(PROBATION_RATE)}.`);
      setProbationTarget(null);
      setProbationDraftStart('');
    } catch (err) {
      setError(err.message || 'Unable to move staff onto probation.');
    } finally {
      setSaving(false);
    }
  }

  async function handleRestore(member) {
    if (!canManage) return;
    setSaving(true);
    setError('');
    setNotice('');

    try {
      await saveStaff({ ...member, active: true });
      await onRefresh();
      setNotice(`${member.full_name} was restored to the active roster.`);
    } catch (err) {
      setError(err.message || 'Unable to restore staff profile.');
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmedAction() {
    const action = confirmAction;
    if (!action) return;

    let completed = false;
    if (action.type === 'deactivate') completed = await handleDeactivate(action.member);
    if (action.type === 'delete') completed = await handleDelete(action.member);
    if (action.type === 'graduate') completed = await handleGraduate(action.member);
    if (completed) setConfirmAction(null);
  }

  const modalOpen = editing !== null || form.business_unit_id;
  const showProbationSection = filter !== 'inactive' && activeProbationStaff.length > 0;
  const formBusiness = businessUnits.find((unit) => unit.id === form.business_unit_id) || businessUnit;
  const formBusinessProfile = getBusinessProfile(formBusiness);
  const roleOptions = [
    ...new Set([form.role, ...(formBusinessProfile.staff_roles || ['Staff'])].filter(Boolean)),
  ];
  const instagramFormats = formBusinessProfile.instagram_formats || ['firstname.rtb_lounge'];

  return (
    <div className="page-grid">
      {allBusinessesView ? (
        <section className="panel full-span">
          <div className="alert warning">
            <strong>All Businesses roster view</strong>
            <span>
              Staff are listed across both businesses. Select RTB Lounge or RTB Beauty Lounge
              before adding a new staff profile.
            </span>
          </div>
        </section>
      ) : null}

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
                  setProbationDraftStart(
                    member.probation_start_date || member.start_date || toDateKey(),
                  );
                }}
                onGraduate={() => setConfirmAction({ member, type: 'graduate' })}
                onDeactivate={() => setConfirmAction({ member, type: 'deactivate' })}
                onEditProfile={() => openEdit(member)}
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
          {canManage && !allBusinessesView ? (
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
                  <th>Business</th>
                  <th>Role</th>
                  <th>Platforms</th>
                  <th>Instagram</th>
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
                        <span>{member.notes || member.primary_business_name || 'No notes'}</span>
                      </div>
                    </td>
                    <td>
                      <div className="business-chip-list">
                        {(member.assigned_business_names || [member.primary_business_name])
                          .filter(Boolean)
                          .map((name) => (
                            <StatusBadge
                              key={name}
                              tone={name === member.primary_business_name ? 'gold' : 'muted'}
                            >
                              {name}
                            </StatusBadge>
                          ))}
                      </div>
                    </td>
                    <td>{member.role}</td>
                    <td>
                      <div className="person-cell">
                        <span>{member.booking_platform_profile || 'No booking profile'}</span>
                        <span>{member.pos_profile || 'No POS profile'}</span>
                      </div>
                    </td>
                    <td>{member.instagram_handle ? `@${member.instagram_handle}` : 'Not set'}</td>
                    <td>
                      <div className="business-chip-list">
                        <strong>{formatPercent(member.commission_rate)}</strong>
                        <StatusBadge tone="muted">{member.commission_type || member.tier}</StatusBadge>
                        {member.fixed_rate ? <StatusBadge tone="gold">Fixed rate</StatusBadge> : null}
                        {isProbationStaff(member) ? <StatusBadge tone="warning">Probation</StatusBadge> : null}
                      </div>
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
                          <button
                            className="ghost-button small"
                            type="button"
                            onClick={() => openEdit(member)}
                          >
                            <Pencil size={14} />
                            Edit
                          </button>
                          {member.active && !isProbationStaff(member) ? (
                            <button
                              className="ghost-button small"
                              disabled={saving}
                              type="button"
                              onClick={() => {
                                setProbationTarget(member);
                                setProbationDraftStart(toDateKey());
                              }}
                            >
                              Prob
                            </button>
                          ) : null}
                          {member.active ? (
                            <button
                              className="ghost-button small danger-action"
                              disabled={saving}
                              type="button"
                              onClick={() =>
                                setConfirmAction({ member, type: 'deactivate' })
                              }
                            >
                              <UserMinus size={14} />
                              Deactivate
                            </button>
                          ) : (
                            <button
                              className="secondary-button small success-action"
                              disabled={saving}
                              type="button"
                              onClick={() => handleRestore(member)}
                            >
                              <RotateCcw size={14} />
                              Restore
                            </button>
                          )}
                          {canDelete ? (
                            <button
                              className="ghost-button small danger-action"
                              disabled={saving}
                              type="button"
                              onClick={() => setConfirmAction({ member, type: 'delete' })}
                            >
                              <Trash2 size={14} />
                              Delete
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
            action={canManage && !allBusinessesView ? (
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
                <span>Primary business</span>
                <select
                  onChange={(event) => updatePrimaryBusiness(event.target.value)}
                  required
                  value={form.business_unit_id || ''}
                >
                  <option value="">Choose business</option>
                  {businessUnits.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name}
                    </option>
                  ))}
                </select>
              </label>
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
                <select
                  onChange={(event) => updateField('role', event.target.value)}
                  required
                  value={form.role}
                >
                  {roleOptions.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
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
                <span>Booking platform profile</span>
                <input
                  onChange={(event) =>
                    updateField('booking_platform_profile', event.target.value)
                  }
                  placeholder={`${formBusinessProfile.booking_platform} name`}
                  value={form.booking_platform_profile || ''}
                />
              </label>
              <label className="field">
                <span>POS profile</span>
                <input
                  onChange={(event) => updateField('pos_profile', event.target.value)}
                  placeholder={`${formBusinessProfile.pos_platform} name`}
                  value={form.pos_profile || ''}
                />
              </label>
              <label className="field">
                <span>Instagram rule</span>
                <select
                  onChange={(event) => updateInstagramRule(event.target.value)}
                  value={form.instagram_rule}
                >
                  {instagramFormats.map((format) => (
                    <option key={format} value={format}>
                      {format}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Instagram handle</span>
                <input
                  onChange={(event) => updateInstagramHandle(event.target.value)}
                  placeholder={suggestInstagramHandle(form.full_name, form.instagram_rule)}
                  value={form.instagram_handle || ''}
                />
              </label>
              <label className="field">
                <span>Commission type</span>
                <select
                  onChange={(event) => updateField('commission_type', event.target.value)}
                  value={form.commission_type}
                >
                  <option value="Commission">Commission</option>
                  <option value="Fixed rate">Fixed rate</option>
                  <option value="Booth rent">Booth rent</option>
                  <option value="Probation">Probation</option>
                </select>
              </label>
              <label className="field">
                <span>Phone</span>
                <input
                  onChange={(event) => updateField('phone', event.target.value)}
                  value={form.phone}
                />
              </label>
              <label className="field">
                <span>Employment start date</span>
                <input
                  onChange={(event) => updateField('start_date', event.target.value)}
                  type="date"
                  value={form.start_date || ''}
                />
              </label>
              {form.tier === 'probation' ? (
                <label className="field">
                  <span>Probation start date</span>
                  <input
                    onChange={(event) =>
                      updateField('probation_start_date', event.target.value)
                    }
                    type="date"
                    value={form.probation_start_date || toDateKey()}
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
              <div className="field wide">
                <span>Assigned businesses</span>
                <div className="checkbox-grid">
                  {businessUnits.map((unit) => (
                    <label className="check-row" key={unit.id}>
                      <input
                        checked={(form.assigned_business_ids || []).includes(unit.id)}
                        disabled={unit.id === form.business_unit_id}
                        onChange={(event) =>
                          toggleBusinessAssignment(unit.id, event.target.checked)
                        }
                        type="checkbox"
                      />
                      <span>{unit.name}</span>
                    </label>
                  ))}
                </div>
              </div>
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

      {probationTarget ? (
        <Modal
          title={`Move ${probationTarget.full_name} to probation`}
          onClose={() => {
            setProbationTarget(null);
            setProbationDraftStart('');
          }}
        >
          <div className="stack">
            <p className="modal-description">
              This sets commission to 50%, turns off fixed rate, and starts the 90-day clock.
            </p>
            <label className="field">
              <span>Probation start date</span>
              <input
                onChange={(event) => setProbationDraftStart(event.target.value)}
                type="date"
                value={probationDraftStart || toDateKey()}
              />
            </label>
            <div className="action-row end">
              <button
                className="ghost-button"
                type="button"
                onClick={() => setProbationTarget(null)}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                disabled={saving}
                type="button"
                onClick={() => handleMoveToProbation(probationTarget)}
              >
                Start probation
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {confirmAction ? (
        <ConfirmDialog
          busy={saving}
          confirmLabel={
            confirmAction.type === 'delete'
              ? 'Delete permanently'
              : confirmAction.type === 'graduate'
                ? 'Graduate staff'
                : 'Deactivate staff'
          }
          description={
            confirmAction.type === 'delete'
              ? `Delete ${confirmAction.member.full_name}? Profiles linked to payroll, performance, or booth rent cannot be deleted and should be deactivated instead.`
              : confirmAction.type === 'graduate'
                ? `Graduate ${confirmAction.member.full_name} early to Standard RTB at 60%?`
                : `Deactivate ${confirmAction.member.full_name}? Their history stays intact and you can restore them later.`
          }
          onClose={() => setConfirmAction(null)}
          onConfirm={handleConfirmedAction}
          title={
            confirmAction.type === 'delete'
              ? 'Delete staff profile'
              : confirmAction.type === 'graduate'
                ? 'Graduate staff'
                : 'Deactivate staff'
          }
          tone={confirmAction.type === 'graduate' ? 'warning' : 'danger'}
        >
          {error ? <div className="alert danger">{error}</div> : null}
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
