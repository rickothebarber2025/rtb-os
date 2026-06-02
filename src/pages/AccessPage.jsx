import { useEffect, useMemo, useState } from 'react';
import { Check, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import DataTable from '../components/DataTable';
import EmptyState from '../components/EmptyState';
import StatusBadge from '../components/StatusBadge';
import { getUserProfiles, updateUserProfile } from '../services/rtbService';
import { getRoleLabel, ROLE_OPTIONS } from '../utils/access';

function getDraft(profile, drafts) {
  return drafts[profile.id] || profile;
}

export default function AccessPage({ businessUnits, currentUserId }) {
  const [drafts, setDrafts] = useState({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [profiles, setProfiles] = useState([]);
  const [savingId, setSavingId] = useState('');

  const pendingCount = useMemo(
    () => profiles.filter((profile) => profile.role === 'pending' || !profile.active).length,
    [profiles],
  );

  async function loadProfiles() {
    setLoading(true);
    setError('');

    try {
      setProfiles(await getUserProfiles());
      setDrafts({});
    } catch (err) {
      setError(err.message || 'Unable to load user access.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProfiles();
  }, []);

  function updateDraft(profile, field, value) {
    setDrafts((current) => {
      const next = { ...getDraft(profile, current), [field]: value };

      if (field === 'role') {
        next.active = value !== 'pending';
      }

      return { ...current, [profile.id]: next };
    });
  }

  async function saveProfile(profile) {
    const draft = getDraft(profile, drafts);

    if (profile.id === currentUserId && (draft.role !== 'admin' || !draft.active)) {
      setError('You cannot remove admin access from the account you are using right now.');
      return;
    }

    setSavingId(profile.id);
    setError('');
    setMessage('');

    try {
      await updateUserProfile(draft);
      setMessage(`${draft.full_name || draft.email} is now ${getRoleLabel(draft.role)}.`);
      await loadProfiles();
    } catch (err) {
      setError(err.message || 'Unable to save access changes.');
    } finally {
      setSavingId('');
    }
  }

  return (
    <div className="page-grid">
      <section className="hero-panel access-hero">
        <div>
          <span className="eyebrow">Users & access</span>
          <h2>Admin and manager roles</h2>
          <p>
            Admins control payroll and staff changes. Managers can view operations, update booth
            rent, and manage appointment imports.
          </p>
        </div>
        <div className="hero-meta">
          <strong>{pendingCount}</strong>
          <span>pending or inactive</span>
        </div>
      </section>

      <section className="panel full-span">
        <div className="section-header">
          <div>
            <span>Access control</span>
            <h2>Team logins</h2>
          </div>
          <button className="secondary-button" type="button" onClick={loadProfiles}>
            <RefreshCw size={17} />
            Refresh
          </button>
        </div>

        {error ? <div className="alert danger">{error}</div> : null}
        {message ? <div className="alert success">{message}</div> : null}

        {profiles.length ? (
          <DataTable>
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Business unit</th>
                  <th>Status</th>
                  <th>Access</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((profile) => {
                  const draft = getDraft(profile, drafts);
                  const isCurrentUser = profile.id === currentUserId;
                  const isDirty = JSON.stringify(draft) !== JSON.stringify(profile);

                  return (
                    <tr key={profile.id}>
                      <td>
                        <div className="person-cell">
                          <input
                            disabled={isCurrentUser}
                            onChange={(event) =>
                              updateDraft(profile, 'full_name', event.target.value)
                            }
                            value={draft.full_name || ''}
                          />
                          <span>{profile.email}</span>
                        </div>
                      </td>
                      <td>
                        <select
                          disabled={isCurrentUser}
                          onChange={(event) => updateDraft(profile, 'role', event.target.value)}
                          value={draft.role}
                        >
                          {ROLE_OPTIONS.map((role) => (
                            <option key={role.value} value={role.value}>
                              {role.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          disabled={isCurrentUser}
                          onChange={(event) =>
                            updateDraft(profile, 'business_unit_id', event.target.value)
                          }
                          value={draft.business_unit_id || ''}
                        >
                          <option value="">All business units</option>
                          {businessUnits.map((unit) => (
                            <option key={unit.id} value={unit.id}>
                              {unit.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <StatusBadge tone={draft.active ? 'success' : 'muted'}>
                          {draft.active ? 'Active' : 'Inactive'}
                        </StatusBadge>
                      </td>
                      <td>
                        <label className="access-toggle">
                          <input
                            checked={Boolean(draft.active)}
                            disabled={isCurrentUser}
                            onChange={(event) =>
                              updateDraft(profile, 'active', event.target.checked)
                            }
                            type="checkbox"
                          />
                          <span>{getRoleLabel(draft.role)}</span>
                        </label>
                      </td>
                      <td>
                        <button
                          className="primary-button"
                          disabled={!isDirty || savingId === profile.id}
                          onClick={() => saveProfile(profile)}
                          type="button"
                        >
                          {savingId === profile.id ? (
                            'Saving...'
                          ) : (
                            <>
                              <Check size={17} />
                              Save
                            </>
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </DataTable>
        ) : (
          <EmptyState
            icon={loading ? ShieldCheck : Users}
            title={loading ? 'Loading access' : 'No user profiles'}
            message={
              loading
                ? 'Checking RTB OS access.'
                : 'Users appear here after they sign in for the first time.'
            }
          />
        )}
      </section>
    </div>
  );
}
