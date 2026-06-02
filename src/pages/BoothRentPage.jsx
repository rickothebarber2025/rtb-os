import { useEffect, useMemo, useState } from 'react';
import { Plus, ReceiptText, Trash2 } from 'lucide-react';
import DataTable from '../components/DataTable';
import EmptyState from '../components/EmptyState';
import StatusBadge from '../components/StatusBadge';
import { deleteBoothRent, saveBoothRent, toggleBoothRentPaid } from '../services/rtbService';
import { canDeleteBoothRent, canManageBoothRent } from '../utils/access';
import { getDefaultPayrollWeek } from '../utils/dates';
import { formatCurrency, formatDate } from '../utils/formatters';

function blankRecord(businessUnitId) {
  return {
    business_unit_id: businessUnitId,
    notes: '',
    paid: false,
    rent_amount: 200,
    renter_name: '',
    staff_id: '',
    week_label: getDefaultPayrollWeek().week_label,
  };
}

export default function BoothRentPage({ accessProfile, boothRent, businessUnit, onRefresh, staff }) {
  const canDelete = canDeleteBoothRent(accessProfile);
  const canManage = canManageBoothRent(accessProfile);
  const [form, setForm] = useState(() => blankRecord(businessUnit?.id));
  const [editingId, setEditingId] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEditingId('');
    setForm(blankRecord(businessUnit?.id));
    setError('');
  }, [businessUnit?.id]);

  const totals = useMemo(
    () =>
      boothRent.reduce(
        (acc, record) => ({
          open: acc.open + (record.paid ? 0 : Number(record.rent_amount || 0)),
          paid: acc.paid + (record.paid ? Number(record.rent_amount || 0) : 0),
        }),
        { open: 0, paid: 0 },
      ),
    [boothRent],
  );

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function handleStaffSelect(staffId) {
    const member = staff.find((item) => item.id === staffId);
    setForm((current) => ({
      ...current,
      renter_name: member?.full_name || current.renter_name,
      staff_id: staffId,
    }));
  }

  function editRecord(record) {
    if (!canManage) return;
    setEditingId(record.id);
    setForm({
      ...record,
      notes: record.notes || '',
      rent_amount: Number(record.rent_amount || 0),
      staff_id: record.staff_id || '',
      week_label: record.week_label || '',
    });
    setError('');
  }

  function resetForm() {
    setEditingId('');
    setForm(blankRecord(businessUnit?.id));
    setError('');
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canManage) return;
    setSaving(true);
    setError('');

    try {
      await saveBoothRent({
        ...form,
        business_unit_id: businessUnit?.id,
        id: editingId || undefined,
      });
      await onRefresh();
      resetForm();
    } catch (err) {
      setError(err.message || 'Unable to save booth rent.');
    } finally {
      setSaving(false);
    }
  }

  async function handleTogglePaid(record) {
    if (!canManage) return;
    setSaving(true);
    setError('');

    try {
      await toggleBoothRentPaid(record);
      await onRefresh();
    } catch (err) {
      setError(err.message || 'Unable to update booth rent status.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteRecord(record) {
    if (!canDelete) return;
    const confirmed = window.confirm(`Delete booth rent record for ${record.renter_name}?`);
    if (!confirmed) return;

    setSaving(true);
    setError('');

    try {
      await deleteBoothRent(record.id);
      if (editingId === record.id) resetForm();
      await onRefresh();
    } catch (err) {
      setError(err.message || 'Unable to delete booth rent record.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-grid booth-layout">
      {canManage ? (
      <section className="panel">
        <div className="section-header">
          <div>
            <span>Booth rent</span>
            <h2>{editingId ? 'Edit record' : 'New record'}</h2>
          </div>
          <button className="ghost-button" type="button" onClick={resetForm}>
            Clear
          </button>
        </div>

        <form className="stack" onSubmit={handleSubmit}>
          <label className="field">
            <span>Staff link</span>
            <select value={form.staff_id || ''} onChange={(event) => handleStaffSelect(event.target.value)}>
              <option value="">Manual renter</option>
              {staff.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.full_name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Renter name</span>
            <input
              onChange={(event) => updateField('renter_name', event.target.value)}
              required
              value={form.renter_name}
            />
          </label>
          <label className="field">
            <span>Week label</span>
            <input
              onChange={(event) => updateField('week_label', event.target.value)}
              value={form.week_label || ''}
            />
          </label>
          <label className="field">
            <span>Rent amount</span>
            <input
              min="0"
              onChange={(event) => updateField('rent_amount', Number(event.target.value))}
              step="0.01"
              type="number"
              value={form.rent_amount}
            />
          </label>
          <label className="check-row">
            <input
              checked={Boolean(form.paid)}
              onChange={(event) => updateField('paid', event.target.checked)}
              type="checkbox"
            />
            <span>Paid</span>
          </label>
          <label className="field">
            <span>Notes</span>
            <textarea
              onChange={(event) => updateField('notes', event.target.value)}
              rows="4"
              value={form.notes || ''}
            />
          </label>

          {error ? <div className="alert danger">{error}</div> : null}

          <button className="primary-button" disabled={saving} type="submit">
            <Plus size={17} />
            {saving ? 'Saving...' : editingId ? 'Update record' : 'Save record'}
          </button>
        </form>
      </section>
      ) : null}

      <section className="panel booth-records">
        <div className="section-header">
          <div>
            <span>{formatCurrency(totals.open)} open</span>
            <h2>Rent tracker</h2>
          </div>
          <StatusBadge tone="success">{formatCurrency(totals.paid)} paid</StatusBadge>
        </div>

        {boothRent.length ? (
          <DataTable>
            <table>
              <thead>
                <tr>
                  <th>Renter</th>
                  <th>Week</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Paid at</th>
                  <th>Notes</th>
                  {canManage ? <th>Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {boothRent.map((record) => (
                  <tr key={record.id}>
                    <td>{record.renter_name}</td>
                    <td>{record.week_label || 'Not set'}</td>
                    <td>{formatCurrency(record.rent_amount)}</td>
                    <td>
                      <StatusBadge tone={record.paid ? 'success' : 'warning'}>
                        {record.paid ? 'Paid' : 'Open'}
                      </StatusBadge>
                    </td>
                    <td>{record.paid_at ? formatDate(record.paid_at) : 'Not paid'}</td>
                    <td>{record.notes || 'No notes'}</td>
                    {canManage ? (
                      <td>
                        <div className="row-actions">
                          <button className="ghost-button small" type="button" onClick={() => editRecord(record)}>
                            Edit
                          </button>
                          <button
                            className="secondary-button small"
                            disabled={saving}
                            type="button"
                            onClick={() => handleTogglePaid(record)}
                          >
                            {record.paid ? 'Reopen' : 'Mark paid'}
                          </button>
                          {canDelete ? (
                            <button
                              className="icon-button danger small"
                              disabled={saving}
                              type="button"
                              onClick={() => handleDeleteRecord(record)}
                              aria-label={`Delete booth rent record for ${record.renter_name}`}
                            >
                              <Trash2 size={15} />
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
            icon={ReceiptText}
            title="No booth rent records"
            message="Create a rent record for this business unit."
          />
        )}
      </section>
    </div>
  );
}
