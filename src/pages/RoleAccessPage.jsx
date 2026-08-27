import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronRight, RefreshCw, ShieldCheck, UserRoundCog } from 'lucide-react';
import EmptyState from '../components/EmptyState';
import RoleAccessChooser from '../components/RoleAccessChooser';
import StatusBadge from '../components/StatusBadge';
import { getUserProfiles, updateUserProfile } from '../services/rtbService';
import {
  ALL_BUSINESSES_ACCESS,
  getEffectivePermissionsPayload,
  getProfileBusinessUnitIds,
  isOwnerProfile,
  normalizePermissionsPayload,
} from '../lib/permissions.js';
import {
  buildPermissionsFromTemplate,
  getTemplateRoleValue,
  ROLE_TEMPLATES,
} from '../lib/roleTemplates.js';

function businessIdsFor(profile) {
  const ids = getProfileBusinessUnitIds(profile).filter((id) => id !== ALL_BUSINESSES_ACCESS);
  if (ids.length) return ids;
  return profile.business_unit_id ? [profile.business_unit_id] : [];
}

function templateFor(profile) {
  return getEffectivePermissionsPayload(profile).role_template || 'staff_portal';
}

export default function RoleAccessPage({ businessUnits = [] }) {
  const [profiles, setProfiles] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const eligibleProfiles = useMemo(
    () => profiles.filter((profile) => !isOwnerProfile(profile)),
    [profiles],
  );
  const selectedProfile = eligibleProfiles.find((profile) => profile.id === selectedId) || null;
  const payload = draft ? normalizePermissionsPayload(draft.permissions) : null;

  async function loadProfiles() {
    setLoading(true);
    setError('');
    try {
      const rows = await getUserProfiles();
      setProfiles(rows);
      const first = rows.find((profile) => !isOwnerProfile(profile));
      if (!selectedId && first) {
        setSelectedId(first.id);
        setDraft({ ...first, permissions: getEffectivePermissionsPayload(first) });
      }
    } catch (err) {
      setError(err.message || 'Unable to load staff access.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProfiles();
  }, []);

  function chooseProfile(profileId) {
    const profile = eligibleProfiles.find((item) => item.id === profileId);
    setSelectedId(profileId);
    setDraft(profile ? { ...profile, permissions: getEffectivePermissionsPayload(profile) } : null);
    setError('');
    setMessage('');
  }

  function applyTemplate(templateId) {
    if (!draft) return;
    const current = normalizePermissionsPayload(draft.permissions);
    const next = buildPermissionsFromTemplate(templateId, {
      business_scope: current.business_scope,
      business_unit_ids: current.business_unit_ids,
    });
    setDraft({ ...draft, role: getTemplateRoleValue(templateId), permissions: next });
  }

  function updateModule(moduleId, level) {
    if (!draft) return;
    const current = normalizePermissionsPayload(draft.permissions);
    setDraft({
      ...draft,
      permissions: {
        ...current,
        modules: { ...current.modules, [moduleId]: level },
      },
    });
  }

  function toggleBusiness(businessUnitId, checked) {
    if (!draft) return;
    const current = normalizePermissionsPayload(draft.permissions);
    const ids = new Set(current.business_unit_ids.filter((id) => id !== ALL_BUSINESSES_ACCESS));
    if (checked) ids.add(businessUnitId);
    else ids.delete(businessUnitId);
    const nextIds = [...ids];
    setDraft({
      ...draft,
      business_unit_id: nextIds[0] || '',
      permissions: {
        ...current,
        business_scope: 'selected',
        business_unit_ids: nextIds,
      },
    });
  }

  function setAllBusinesses() {
    if (!draft) return;
    const current = normalizePermissionsPayload(draft.permissions);
    setDraft({
      ...draft,
      business_unit_id: businessUnits[0]?.id || draft.business_unit_id || '',
      permissions: { ...current, business_scope: 'all', business_unit_ids: [ALL_BUSINESSES_ACCESS] },
    });
  }

  async function savePromotion() {
    if (!draft || !selectedProfile) return;
    const current = normalizePermissionsPayload(draft.permissions);
    const hasBusiness = current.business_scope === 'all' || current.business_unit_ids.length > 0;
    const hasAccess = Object.values(current.modules).some((level) => level !== 'none');
    if (!hasBusiness) return setError('Choose at least one business before saving this role.');
    if (!hasAccess) return setError('This role has no app access. Turn on at least one area before saving.');

    setSaving(true);
    setError('');
    setMessage('');
    try {
      await updateUserProfile({ ...draft, active: true });
      setMessage(`${draft.full_name || draft.email} is now ${current.role_title} with the access you selected.`);
      await loadProfiles();
    } catch (err) {
      setError(err.message || 'Unable to save the promotion access.');
    } finally {
      setSaving(false);
    }
  }

  if (loading && !profiles.length) {
    return <EmptyState icon={ShieldCheck} title="Loading role access" message="Checking staff roles and permissions." />;
  }

  return (
    <div className="page-grid role-access-page">
      <section className="hero-panel full-span">
        <div>
          <span className="eyebrow">Owner control</span>
          <h2>Promote staff without over-sharing access</h2>
          <p>Choose the staff member, select the role, then decide exactly what RTB OS areas they can see or manage.</p>
        </div>
        <button className="secondary-button" type="button" onClick={loadProfiles} disabled={loading}>
          <RefreshCw size={16} /> Refresh
        </button>
      </section>

      {error ? <div className="alert danger full-span">{error}</div> : null}
      {message ? <div className="alert success full-span">{message}</div> : null}

      <section className="panel full-span role-access-flow">
        <div className="section-header">
          <div><span>Step 1</span><h3>Who are you promoting?</h3></div>
          <StatusBadge tone="muted">{eligibleProfiles.length} staff accounts</StatusBadge>
        </div>
        <label className="field">
          <span>Staff member</span>
          <select value={selectedId} onChange={(event) => chooseProfile(event.target.value)}>
            <option value="">Choose staff...</option>
            {eligibleProfiles.map((profile) => (
              <option value={profile.id} key={profile.id}>
                {profile.full_name || profile.email} — {getEffectivePermissionsPayload(profile).role_title}
              </option>
            ))}
          </select>
        </label>
      </section>

      {draft && payload ? <>
        <section className="panel full-span role-access-flow">
          <div className="section-header">
            <div><span>Step 2</span><h3>Choose the role preset</h3><p>The preset is only a starting point. You remain in control of every permission.</p></div>
            <StatusBadge tone="gold">Current: {payload.role_title}</StatusBadge>
          </div>
          <div className="role-template-picker">
            {ROLE_TEMPLATES.filter((template) => !['owner', 'custom'].includes(template.id)).map((template) => {
              const active = payload.role_template === template.id;
              return (
                <button className={active ? 'secondary-button active' : 'ghost-button'} key={template.id} type="button" onClick={() => applyTemplate(template.id)}>
                  <strong>{template.title}</strong>
                  <span>{template.description}</span>
                  {active ? <Check size={15} /> : <ChevronRight size={15} />}
                </button>
              );
            })}
          </div>
        </section>

        <section className="panel full-span role-access-flow">
          <div className="section-header"><div><span>Step 3</span><h3>Choose business access</h3><p>They only see data for the businesses selected here.</p></div></div>
          <div className="business-access-toolbar">
            <button className={payload.business_scope === 'all' ? 'secondary-button small active' : 'ghost-button small'} type="button" onClick={setAllBusinesses}>All businesses</button>
          </div>
          <div className="business-access-options">
            {businessUnits.map((unit) => (
              <label className="check-row" key={unit.id}>
                <input
                  checked={payload.business_scope === 'all' || payload.business_unit_ids.includes(unit.id)}
                  disabled={payload.business_scope === 'all'}
                  onChange={(event) => toggleBusiness(unit.id, event.target.checked)}
                  type="checkbox"
                />
                <span>{unit.name}</span>
              </label>
            ))}
          </div>
        </section>

        <section className="panel full-span role-access-flow">
          <div className="section-header"><div><span>Step 4</span><h3>Choose what to share</h3></div></div>
          <RoleAccessChooser permissions={payload} onChange={updateModule} />
        </section>

        <section className="panel full-span role-access-review">
          <div>
            <span className="eyebrow">Final check</span>
            <h3>{draft.full_name || draft.email} → {payload.role_title}</h3>
            <p>{payload.role_description}</p>
            <div className="business-chip-list">
              <StatusBadge tone="success">{Object.values(payload.modules).filter((level) => level !== 'none').length} areas shared</StatusBadge>
              <StatusBadge tone="muted">{payload.business_scope === 'all' ? 'All businesses' : `${businessIdsFor(draft).length} business access`}</StatusBadge>
              {Object.values(payload.modules).some((level) => level === 'admin') ? <StatusBadge tone="warning">Includes admin access</StatusBadge> : null}
            </div>
          </div>
          <button className="primary-button" type="button" disabled={saving} onClick={savePromotion}>
            <UserRoundCog size={17} /> {saving ? 'Saving...' : 'Save role & access'}
          </button>
        </section>
      </> : null}
    </div>
  );
}
