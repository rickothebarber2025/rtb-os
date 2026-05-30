import { useMemo, useState } from 'react';
import { Plus, UserMinus, Users } from 'lucide-react';
import DataTable from '../components/DataTable';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';
import StatusBadge from '../components/StatusBadge';
import { deactivateStaff, saveStaff } from '../services/rtbService';
import { formatDate, formatPercent } from '../utils/formatters';

const blankStaff = {
  active: true,
  commission_rate: 60,
  email: '',
  fixed_rate: false,
  full_name: '',
  notes: '',
  phone: '',
  role: 'Staff',
  start_date: '',
  tier: 'standard',
};

export default function StaffPage({ businessUnit, onRefresh, staff }) {
  const [filter, setFilter] = useState('active');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blankStaff);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const filteredStaff = useMemo(() => {
    if (filter === 'active') return staff.filter((member) => member.active);
    if (filter === 'inactive') return staff.filter((member) => !member.active);
    if (filter === 'fixed') return staff.filter((member) => member.fixed_rate);
    return staff;
  }, [filter, staff]);

  function openCreate() {
    setEditing(null);
    setForm({ ...blankStaff, business_unit_id: businessUnit?.id });
    setError('');
  }

  function openEdit(member) {
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
  }

  function closeModal() {
    setEditing(null);
    setForm(blankStaff);
    setError('');
  }

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');

    try {
      await saveStaff({
        ...form,
        business_unit_id: businessUnit?.id,
        id: editing?.id,
      });
      await onRefresh();
      closeModal();
    } catch (err) {
      setError(err.message || 'Unable to save staff profile.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(member) {
    setSaving(true);
    setError('');

    try {
      await deactivateStaff(member.id);
      await onRefresh();
    } catch (err) {
      setError(err.message || 'Unable to deactivate staff profile.');
    } finally {
      setSaving(false);
    }
  }

  const modalOpen = editing !== null || form.business_unit_id;

  return (
    <div className="page-grid">
      <section className="panel full-span">
        <div className="section-header">
          <div>
            <span>Roster</span>
            <h2>Staff profiles</h2>
          </div>
          <button className="primary-button" type="button" onClick={openCreate}>
            <Plus size={17} />
            Add staff
          </button>
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
                  <th>Actions</th>
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
                    <td>
                      <div className="row-actions">
                        <button className="ghost-button small" type="button" onClick={() => openEdit(member)}>
                          Edit
                        </button>
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
                      </div>
                    </td>
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
            action={
              <button className="ghost-button" type="button" onClick={openCreate}>
                Add staff
              </button>
            }
          />
        )}
      </section>

      {modalOpen ? (
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
                <select onChange={(event) => updateField('tier', event.target.value)} value={form.tier}>
                  <option value="probation">probation</option>
                  <option value="review">review</option>
                  <option value="standard">standard</option>
                  <option value="growth">growth</option>
                  <option value="senior">senior</option>
                </select>
              </label>
              <label className="field">
                <span>Commission rate</span>
                <input
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
              <label className="field">
                <span>Start date</span>
                <input
                  onChange={(event) => updateField('start_date', event.target.value)}
                  type="date"
                  value={form.start_date || ''}
                />
              </label>
              <label className="check-row">
                <input
                  checked={Boolean(form.fixed_rate)}
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
