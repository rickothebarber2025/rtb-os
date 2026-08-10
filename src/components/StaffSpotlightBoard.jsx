import { useEffect, useState } from 'react';
import { Trophy } from 'lucide-react';
import EmptyState from './EmptyState';
import { getStaff, getStaffSpotlight, saveStaffSpotlight } from '../services/rtbService';

function monthKey(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1).toISOString().slice(0, 10);
}

function monthLabel(value) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// This board deliberately never touches payroll, net_sales, tips, or any
// dollar figure -- staff_spotlight (the table this reads from) has no
// financial columns at all, so there's nothing here that could leak.
export default function StaffSpotlightBoard({ businessUnitId, isAdmin }) {
  const [entries, setEntries] = useState([]);
  const [activeStaff, setActiveStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [formStaffId, setFormStaffId] = useState('');
  const [formReason, setFormReason] = useState('');

  const currentMonth = monthKey(new Date());

  async function load() {
    if (!businessUnitId) return;
    setLoading(true);
    setError('');
    try {
      const [spotlightRows, staffRows] = await Promise.all([
        getStaffSpotlight(businessUnitId, 12),
        isAdmin ? getStaff(businessUnitId, false) : Promise.resolve([]),
      ]);
      setEntries(spotlightRows);
      setActiveStaff(staffRows || []);

      const current = spotlightRows.find((row) => row.month === currentMonth);
      if (current) {
        setFormStaffId(current.staff?.id || '');
        setFormReason(current.reason || '');
      }
    } catch (err) {
      setError(err.message || 'Unable to load the spotlight board.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessUnitId]);

  async function handleSave() {
    if (!formStaffId || !formReason.trim()) {
      setError('Pick a staff member and write a short reason first.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await saveStaffSpotlight({
        businessUnitId,
        month: currentMonth,
        staffId: formStaffId,
        reason: formReason.trim(),
      });
      setNotice('Saved.');
      setFormOpen(false);
      await load();
    } catch (err) {
      setError(err.message || 'Unable to save.');
    } finally {
      setSaving(false);
    }
  }

  if (!businessUnitId) return null;

  const current = entries.find((row) => row.month === currentMonth);
  const history = entries.filter((row) => row.month !== currentMonth);

  return (
    <section className="panel full-span spotlight-board">
      <div className="section-header">
        <div>
          <span>Spotlight</span>
          <h2>Staff of the Month</h2>
        </div>
        {isAdmin ? (
          <button className="ghost-button small" onClick={() => setFormOpen((value) => !value)} type="button">
            {current ? 'Edit this month' : 'Set this month'}
          </button>
        ) : null}
      </div>

      {error ? <div className="alert danger">{error}</div> : null}
      {notice ? <div className="alert success">{notice}</div> : null}

      {isAdmin && formOpen ? (
        <div className="spotlight-form">
          <label className="field">
            <span>Staff member</span>
            <select value={formStaffId} onChange={(event) => setFormStaffId(event.target.value)}>
              <option value="">Choose someone...</option>
              {activeStaff.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.full_name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Why (no numbers -- keep it to what they did well)</span>
            <textarea
              onChange={(event) => setFormReason(event.target.value)}
              placeholder="Great attitude with clients, always on time, helped train the new hire..."
              rows={3}
              value={formReason}
            />
          </label>
          <button className="primary-button" disabled={saving} onClick={handleSave} type="button">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      ) : null}

      {loading ? (
        <p className="subtle-text">Loading...</p>
      ) : current ? (
        <div className="spotlight-current">
          <div className="spotlight-current__avatar">
            {current.photo_url || current.staff?.photo_url ? (
              <img alt={current.staff?.full_name} src={current.photo_url || current.staff?.photo_url} />
            ) : (
              <Trophy size={32} />
            )}
          </div>
          <div>
            <span className="spotlight-current__month">{monthLabel(currentMonth)}</span>
            <h3>{current.staff?.full_name || 'Staff member'}</h3>
            {current.staff?.role ? <small>{current.staff.role}</small> : null}
            <p>{current.reason}</p>
          </div>
        </div>
      ) : (
        <EmptyState
          icon={Trophy}
          title="Not set yet this month"
          message={isAdmin ? 'Use "Set this month" above to feature someone.' : "Check back soon -- this month's pick hasn't been posted yet."}
        />
      )}

      {history.length ? (
        <div className="spotlight-history">
          <h4>Past months</h4>
          <div className="spotlight-history__grid">
            {history.map((row) => (
              <div className="spotlight-history__card" key={row.id}>
                {row.photo_url || row.staff?.photo_url ? (
                  <img alt={row.staff?.full_name} src={row.photo_url || row.staff?.photo_url} />
                ) : (
                  <Trophy size={18} />
                )}
                <div>
                  <strong>{row.staff?.full_name || 'Staff member'}</strong>
                  <small>{monthLabel(row.month)}</small>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
