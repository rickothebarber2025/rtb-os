import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronRight, ShieldCheck, UserCog, X } from 'lucide-react';
import { useAuthProfile } from '../contexts/AuthProfileContext.jsx';
import {
  ALL_BUSINESSES_ACCESS,
  getEffectivePermissionsPayload,
  isOwnerProfile,
  MODULE_IDS,
  MODULE_LABELS,
  normalizePermissionsPayload,
} from '../lib/permissions.js';
import {
  buildPermissionsFromTemplate,
  getRoleTemplate,
  getTemplateRoleValue,
  ROLE_TEMPLATES,
} from '../lib/roleTemplates.js';
import { getBusinessUnits, getUserProfiles, updateUserProfile } from '../services/rtbService';
import StatusBadge from './StatusBadge';
import './OwnerRoleAccessSetup.css';

const LEVEL_LABELS = {
  none: 'No access',
  view: 'View only',
  edit: 'View + edit',
  admin: 'Full admin',
};

const SENSITIVE_MODULES = new Set(['access', 'payroll', 'settings']);

function selectedBusinessIds(profile) {
  const payload = normalizePermissionsPayload(profile?.permissions);
  if (payload.business_scope === 'all' || payload.business_unit_ids.includes(ALL_BUSINESSES_ACCESS)) {
    return [ALL_BUSINESSES_ACCESS];
  }
  return payload.business_unit_ids || [];
}

function profileWithTemplate(profile, templateId) {
  const current = getEffectivePermissionsPayload(profile);
  const next = buildPermissionsFromTemplate(templateId, {
    business_scope: current.business_scope,
    business_unit_ids: current.business_unit_ids,
  });
  return {
    ...profile,
    permissions: next,
    role: getTemplateRoleValue(templateId),
    role_title: next.role_title,
    role_description: next.role_description,
    responsibilities: next.responsibilities,
    restrictions: next.restrictions,
    expectations: next.expectations,
  };
}

export default function OwnerRoleAccessSetup() {
  const { profile: ownerProfile } = useAuthProfile();
  const owner = isOwnerProfile(ownerProfile);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [profiles, setProfiles] = useState([]);
  const [businessUnits, setBusinessUnits] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const staffProfiles = useMemo(
    () => profiles.filter((item) => !isOwnerProfile(item)).sort((a, b) => String(a.full_name || a.email).localeCompare(String(b.full_name || b.email))),
    [profiles],
  );
  const selectedProfile = useMemo(() => staffProfiles.find((item) => item.id === selectedId) || null, [selectedId, staffProfiles]);
  const payload = useMemo(() => draft ? getEffectivePermissionsPayload(draft) : null, [draft]);
  const businessIds = useMemo(() => selectedBusinessIds(draft), [draft]);
  const allBusinesses = businessIds.includes(ALL_BUSINESSES_ACCESS);

  useEffect(() => {
    if (!selectedProfile) {
      setDraft(null);
      return;
    }
    setDraft({ ...selectedProfile, permissions: getEffectivePermissionsPayload(selectedProfile) });
    setError('');
    setMessage('');
  }, [selectedProfile]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [nextProfiles, nextBusinesses] = await Promise.all([getUserProfiles(), getBusinessUnits()]);
      setProfiles(nextProfiles);
      setBusinessUnits(nextBusinesses);
      if (!selectedId) {
        const first = nextProfiles.find((item) => !isOwnerProfile(item));
        if (first) setSelectedId(first.id);
      }
    } catch (err) {
      setError(err.message || 'Could not load role access setup.');
    } finally {
      setLoading(false);
    }
  }

  async function show() {
    setOpen(true);
    setMessage('');
    await load();
  }

  function applyTemplate(templateId) {
    if (!draft) return;
    setDraft(profileWithTemplate(draft, templateId));
    setMessage('');
  }

  function setModule(moduleId, level) {
    if (!draft || !payload) return;
    const permissions = {
      ...payload,
      modules: { ...payload.modules, [moduleId]: level },
    };
    setDraft({ ...draft, permissions });
    setMessage('');
  }

  function setBusiness(id, checked) {
    if (!draft || !payload) return;
    let ids = businessIds.filter((item) => item !== ALL_BUSINESSES_ACCESS);
    ids = checked ? [...new Set([...ids, id])] : ids.filter((item) => item !== id);
    const permissions = {
      ...payload,
      business_scope: 'selected',
      business_unit_ids: ids,
    };
    setDraft({ ...draft, business_unit_id: ids[0] || '', permissions });
  }

  function setAllBusinesses(checked) {
    if (!draft || !payload) return;
    const permissions = {
      ...payload,
      business_scope: checked ? 'all' : 'selected',
      business_unit_ids: checked ? [ALL_BUSINESSES_ACCESS] : [],
    };
    setDraft({ ...draft, business_unit_id: checked ? (businessUnits[0]?.id || '') : '', permissions });
  }

  async function save() {
    if (!draft || !payload) return;
    const hasBusiness = allBusinesses || businessIds.length > 0;
    const hasAccess = MODULE_IDS.some((id) => payload.modules[id] !== 'none');
    if (!hasBusiness) {
      setError('Choose at least one business before saving this promotion.');
      return;
    }
    if (!hasAccess) {
      setError('Choose at least one RTB OS area this staff member can access.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const next = {
        ...draft,
        active: true,
        permissions: payload,
        role: getTemplateRoleValue(payload.role_template),
        role_title: payload.role_title,
        role_description: payload.role_description,
        responsibilities: payload.responsibilities,
        restrictions: payload.restrictions,
        expectations: payload.expectations,
      };
      await updateUserProfile(next);
      setMessage(`${next.full_name || next.email} now has ${payload.role_title} access.`);
      await load();
    } catch (err) {
      setError(err.message || 'Could not save role access.');
    } finally {
      setSaving(false);
    }
  }

  if (!owner) return null;

  return (
    <>
      <button className="owner-role-access-launcher" type="button" onClick={show}>
        <UserCog size={17} /> Role access
      </button>

      {open ? (
        <div className="owner-role-access-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <section className="owner-role-access-modal" role="dialog" aria-modal="true" aria-label="Owner role access setup">
            <header className="owner-role-access-header">
              <div>
                <span className="eyebrow">Owner control</span>
                <h2>Promote staff & choose their access</h2>
                <p>Pick the person, choose the role, then decide exactly what RTB OS shares with them.</p>
              </div>
              <button className="ghost-button small" type="button" onClick={() => setOpen(false)} aria-label="Close role access setup"><X size={18} /></button>
            </header>

            {error ? <div className="alert danger">{error}</div> : null}
            {message ? <div className="alert success">{message}</div> : null}

            <div className="owner-role-access-step">
              <div className="owner-role-access-step__number">1</div>
              <div className="owner-role-access-step__body">
                <strong>Who are you promoting?</strong>
                <select disabled={loading} value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
                  <option value="">Choose staff member</option>
                  {staffProfiles.map((item) => <option key={item.id} value={item.id}>{item.full_name || item.email}</option>)}
                </select>
              </div>
            </div>

            {draft && payload ? (
              <>
                <div className="owner-role-access-step">
                  <div className="owner-role-access-step__number">2</div>
                  <div className="owner-role-access-step__body">
                    <strong>Choose their role</strong>
                    <select value={payload.role_template} onChange={(event) => applyTemplate(event.target.value)}>
                      {ROLE_TEMPLATES.filter((item) => !['owner'].includes(item.id)).map((item) => (
                        <option key={item.id} value={item.id}>{item.title}</option>
                      ))}
                    </select>
                    <div className="owner-role-template-copy">
                      <strong>{getRoleTemplate(payload.role_template).title}</strong>
                      <span>{getRoleTemplate(payload.role_template).description}</span>
                    </div>
                  </div>
                </div>

                <div className="owner-role-access-step">
                  <div className="owner-role-access-step__number">3</div>
                  <div className="owner-role-access-step__body">
                    <strong>Which business can they see?</strong>
                    <label className="check-row owner-role-business-all">
                      <input type="checkbox" checked={allBusinesses} onChange={(event) => setAllBusinesses(event.target.checked)} />
                      <span>All RTB businesses</span>
                    </label>
                    {!allBusinesses ? <div className="owner-role-business-grid">
                      {businessUnits.map((unit) => (
                        <label className="check-row" key={unit.id}>
                          <input type="checkbox" checked={businessIds.includes(unit.id)} onChange={(event) => setBusiness(unit.id, event.target.checked)} />
                          <span>{unit.name}</span>
                        </label>
                      ))}
                    </div> : null}
                  </div>
                </div>

                <div className="owner-role-access-step owner-role-access-step--modules">
                  <div className="owner-role-access-step__number">4</div>
                  <div className="owner-role-access-step__body">
                    <div className="owner-role-access-title-row">
                      <div><strong>What can they access?</strong><span>Role defaults are already selected. Change anything before saving.</span></div>
                      <StatusBadge tone="muted">{MODULE_IDS.filter((id) => payload.modules[id] !== 'none').length} areas shared</StatusBadge>
                    </div>
                    <div className="owner-role-module-grid">
                      {MODULE_IDS.map((moduleId) => {
                        const level = payload.modules[moduleId];
                        const enabled = level !== 'none';
                        return (
                          <article className={`owner-role-module-card ${enabled ? 'enabled' : ''}`} key={moduleId}>
                            <label className="check-row">
                              <input type="checkbox" checked={enabled} onChange={(event) => setModule(moduleId, event.target.checked ? 'view' : 'none')} />
                              <strong>{MODULE_LABELS[moduleId]}</strong>
                            </label>
                            {enabled ? <select value={level} onChange={(event) => setModule(moduleId, event.target.value)}>
                              <option value="view">View only</option>
                              <option value="edit">View + edit</option>
                              <option value="admin">Full admin</option>
                            </select> : <span className="subtle-text">Not shared</span>}
                            {enabled && SENSITIVE_MODULES.has(moduleId) ? <StatusBadge tone="warning">Sensitive</StatusBadge> : null}
                          </article>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <footer className="owner-role-access-footer">
                  <div>
                    <ShieldCheck size={18} />
                    <span><strong>{draft.full_name || draft.email}</strong> → {payload.role_title}</span>
                  </div>
                  <button className="primary-button" disabled={saving} type="button" onClick={save}>
                    {saving ? 'Saving…' : <><Check size={16} /> Save promotion access <ChevronRight size={15} /></>}
                  </button>
                </footer>
              </>
            ) : loading ? <div className="empty-state">Loading team access…</div> : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
