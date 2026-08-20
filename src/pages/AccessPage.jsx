import { useEffect, useMemo, useState } from 'react';
import {
  Ban,
  Check,
  Link2,
  MailPlus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Undo2,
  UserPlus,
  Users,
} from 'lucide-react';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import RoleAccessChooser from '../components/RoleAccessChooser';
import RolePromotionSummary from '../components/RolePromotionSummary';
import StatusBadge from '../components/StatusBadge';
import { getUserProfiles, inviteUserProfile, linkUserProfile, updateUserProfile } from '../services/rtbService';
import {
  ALL_BUSINESSES_ACCESS,
  getEffectivePermissionsPayload,
  getModulePermission,
  getProfileBusinessUnitIds,
  hasAnyModulePermission,
  hasAllBusinessAccess,
  isOwnerEmail,
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
import { canManageAccess, getRoleLabel, ROLE_OPTIONS } from '../utils/access';

function makeBlankInvite() {
  const defaultTemplate = 'staff_portal';
  return {
    active: true,
    business_unit_id: '',
    email: '',
    full_name: '',
    permissions: buildPermissionsFromTemplate(defaultTemplate),
    role: getTemplateRoleValue(defaultTemplate),
  };
}

function getDraft(profile, drafts) {
  const draft = drafts[profile.id] || profile;
  return {
    ...draft,
    active: Boolean(draft.active),
    business_unit_id: draft.business_unit_id || '',
    permissions: draft.permissions === null ? null : normalizePermissionsPayload(draft.permissions),
    role: draft.role || 'staff',
  };
}

function comparable(profile) {
  const payload = normalizePermissionsPayload(profile.permissions);
  return {
    active: Boolean(profile.active),
    business_unit_id: profile.business_unit_id || '',
    full_name: profile.full_name || profile.email || '',
    permissions: payload,
    role: profile.role || 'staff',
  };
}

function listToText(items) {
  return (items || []).join('\n');
}

function textToList(value) {
  return String(value || '')
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueIds(ids) {
  return [...new Set((ids || []).filter(Boolean).map(String))];
}

function actualBusinessIds(businessUnits) {
  return businessUnits.map((unit) => unit.id);
}

function getBusinessAccess(record, businessUnits) {
  if (isOwnerProfile(record) || isOwnerEmail(record?.email) || hasAllBusinessAccess(record)) {
    return {
      all: true,
      ids: actualBusinessIds(businessUnits),
    };
  }

  const ids = uniqueIds(getProfileBusinessUnitIds(record)).filter(
    (id) => id !== ALL_BUSINESSES_ACCESS,
  );

  return {
    all: false,
    ids,
  };
}

function businessAccessLabel(businessUnits, record, owner) {
  if (owner) return 'All Businesses';
  const access = getBusinessAccess(record, businessUnits);
  if (access.all) return 'All Businesses';
  if (!access.ids.length) return 'Business required';

  return access.ids
    .map((id) => businessUnits.find((unit) => unit.id === id)?.name)
    .filter(Boolean)
    .join(', ') || 'Business required';
}

function setBusinessAccess(record, selectedIds, businessUnits, all = false) {
  const payload = normalizePermissionsPayload(record.permissions);
  const ids = all
    ? [ALL_BUSINESSES_ACCESS]
    : uniqueIds(selectedIds).filter((id) => actualBusinessIds(businessUnits).includes(id));
  const primaryId = all
    ? businessUnits[0]?.id || record.business_unit_id || ''
    : ids[0] || '';

  return {
    ...record,
    business_unit_id: primaryId,
    permissions: {
      ...payload,
      business_scope: all ? 'all' : 'selected',
      business_unit_ids: ids,
    },
  };
}

function preserveBusinessAccess(record, permissions, businessUnits) {
  const access = getBusinessAccess(record, businessUnits);
  return {
    ...normalizePermissionsPayload(permissions),
    business_scope: access.all ? 'all' : 'selected',
    business_unit_ids: access.all ? [ALL_BUSINESSES_ACCESS] : access.ids,
  };
}

function hasBusinessAccess(record, businessUnits) {
  const access = getBusinessAccess(record, businessUnits);
  return access.all || access.ids.length > 0;
}

function BusinessAccessPicker({ businessUnits, disabled, owner, record, onChange }) {
  const access = getBusinessAccess(record, businessUnits);

  function updateOne(businessUnitId, checked) {
    const nextIds = checked
      ? uniqueIds([...access.ids, businessUnitId])
      : access.ids.filter((id) => id !== businessUnitId);
    onChange(setBusinessAccess(record, nextIds, businessUnits, false));
  }

  return (
    <fieldset className="business-access-picker" disabled={disabled || owner}>
      <legend>Business access</legend>
      <p>
        Choose every business this user can see. Data stays separated unless All Businesses is
        intentionally selected.
      </p>
      <div className="business-access-toolbar">
        <button
          className={access.all ? 'secondary-button small active' : 'ghost-button small'}
          disabled={disabled || owner || !businessUnits.length}
          onClick={() => onChange(setBusinessAccess(record, [], businessUnits, true))}
          type="button"
        >
          All businesses
        </button>
        <button
          className="ghost-button small"
          disabled={disabled || owner}
          onClick={() => onChange(setBusinessAccess(record, [], businessUnits, false))}
          type="button"
        >
          Clear
        </button>
      </div>
      <div className="business-access-options">
        {businessUnits.map((unit) => (
          <label className="check-row" key={unit.id}>
            <input
              checked={access.all || access.ids.includes(unit.id)}
              disabled={disabled || owner || access.all}
              onChange={(event) => updateOne(unit.id, event.target.checked)}
              type="checkbox"
            />
            <span>{unit.name}</span>
          </label>
        ))}
      </div>
      {owner ? (
        <StatusBadge tone="gold">Owner always has all businesses</StatusBadge>
      ) : (
        <StatusBadge tone={access.all || access.ids.length ? 'success' : 'danger'}>
          {access.all
            ? 'All businesses selected'
            : `${access.ids.length} business${access.ids.length === 1 ? '' : 'es'} selected`}
        </StatusBadge>
      )}
    </fieldset>
  );
}

function ResponsibilitiesEditor({ disabled, permissions, onChange }) {
  const payload = normalizePermissionsPayload(permissions);

  return (
    <div className="role-detail-grid">
      <label className="field">
        <span>Role title</span>
        <input
          disabled={disabled}
          onChange={(event) => onChange('role_title', event.target.value)}
          value={payload.role_title}
        />
      </label>
      <label className="field">
        <span>Role description</span>
        <input
          disabled={disabled}
          onChange={(event) => onChange('role_description', event.target.value)}
          value={payload.role_description}
        />
      </label>
      <label className="field">
        <span>Responsibilities checklist</span>
        <textarea
          disabled={disabled}
          onChange={(event) => onChange('responsibilities', textToList(event.target.value))}
          value={listToText(payload.responsibilities)}
        />
      </label>
      <label className="field">
        <span>Restrictions / cannot do</span>
        <textarea
          disabled={disabled}
          onChange={(event) => onChange('restrictions', textToList(event.target.value))}
          value={listToText(payload.restrictions)}
        />
      </label>
      <label className="field full-width">
        <span>Notes / expectations</span>
        <textarea
          disabled={disabled}
          onChange={(event) => onChange('expectations', event.target.value)}
          value={payload.expectations}
        />
      </label>
    </div>
  );
}

function RoleTemplatePreview({ permissions }) {
  const payload = normalizePermissionsPayload(permissions);
  const visibleModules = MODULE_IDS.filter((moduleId) => payload.modules[moduleId] !== 'none');

  return (
    <div className="template-preview">
      <div>
        <strong>{payload.role_title}</strong>
        <span>{payload.role_description}</span>
        {payload.expectations ? <small>{payload.expectations}</small> : null}
      </div>
      <div className="business-chip-list">
        {visibleModules.length ? (
          visibleModules.map((moduleId) => (
            <StatusBadge key={moduleId} tone={payload.modules[moduleId] === 'admin' ? 'gold' : 'muted'}>
              {MODULE_LABELS[moduleId]}: {payload.modules[moduleId]}
            </StatusBadge>
          ))
        ) : (
          <StatusBadge tone="danger">No module access</StatusBadge>
        )}
      </div>
    </div>
  );
}

export default function AccessPage({ accessProfile, businessUnits, currentUserId }) {
  const accessAdmin = canManageAccess(accessProfile);
  const [expandedProfileId, setExpandedProfileId] = useState('');
  const [drafts, setDrafts] = useState({});
  const [accessTarget, setAccessTarget] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [inviteForm, setInviteForm] = useState(() => makeBlankInvite());
  const [inviting, setInviting] = useState(false);
  const [linkPicker, setLinkPicker] = useState({});
  const [linkTarget, setLinkTarget] = useState(null);
  const [linking, setLinking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [profiles, setProfiles] = useState([]);
  const [savingId, setSavingId] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const pendingCount = useMemo(
    () =>
      profiles.filter(
        (profile) => !profile.active || (!isOwnerProfile(profile) && !hasAnyModulePermission(profile)),
      ).length,
    [profiles],
  );
  const activeCount = useMemo(
    () => profiles.filter((profile) => profile.active && !isOwnerProfile(profile)).length,
    [profiles],
  );
  const adminCount = useMemo(
    () => profiles.filter((profile) => isOwnerProfile(profile) || getModulePermission(profile, 'access') === 'admin').length,
    [profiles],
  );
  const filteredProfiles = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    return profiles.filter((profile) => {
      const draft = getDraft(profile, drafts);
      const owner = isOwnerProfile(profile);
      const payload = getEffectivePermissionsPayload(draft);
      const needsSetup =
        !owner &&
        (!draft.active || !hasAnyModulePermission(draft) || !hasBusinessAccess(draft, businessUnits));
      const text = [
        draft.full_name,
        profile.email,
        payload.role_title,
        payload.role_template,
        businessAccessLabel(businessUnits, draft, owner),
      ]
        .join(' ')
        .toLowerCase();

      if (term && !text.includes(term)) return false;
      if (filter === 'needs') return needsSetup;
      if (filter === 'active') return Boolean(draft.active || owner);
      if (filter === 'inactive') return !draft.active && !owner;
      if (filter === 'staff') return payload.role_template === 'staff_portal';
      if (filter === 'admins') return owner || getModulePermission(draft, 'access') === 'admin';
      return true;
    });
  }, [businessUnits, drafts, filter, profiles, searchTerm]);

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

  function setInvite(next) {
    setInviteForm((current) => ({ ...current, ...next }));
  }

  function updateInvite(field, value) {
    setInvite({ [field]: value });
  }

  function updateInvitePermissions(nextPermissions) {
    setInvite({ permissions: nextPermissions });
  }

  function applyInviteTemplate(templateId) {
    setInvite({
      permissions: preserveBusinessAccess(
        inviteForm,
        buildPermissionsFromTemplate(templateId),
        businessUnits,
      ),
      role: getTemplateRoleValue(templateId),
    });
  }

  function updateInviteModule(moduleId, permission) {
    const payload = normalizePermissionsPayload(inviteForm.permissions);
    updateInvitePermissions({
      ...payload,
      modules: {
        ...payload.modules,
        [moduleId]: permission,
      },
    });
  }

  function updateInviteList(field, value) {
    const payload = normalizePermissionsPayload(inviteForm.permissions);
    updateInvitePermissions({
      ...payload,
      [field]: value,
    });
  }

  function updateDraft(profile, field, value) {
    setDrafts((current) => ({
      ...current,
      [profile.id]: {
        ...getDraft(profile, current),
        [field]: value,
      },
    }));
  }

  function updateDraftBusinessAccess(profile, nextRecord) {
    setDrafts((current) => ({
      ...current,
      [profile.id]: {
        ...getDraft(profile, current),
        ...nextRecord,
      },
    }));
  }

  function applyDraftTemplate(profile, templateId) {
    setDrafts((current) => ({
      ...current,
      [profile.id]: {
        ...getDraft(profile, current),
        permissions: preserveBusinessAccess(
          getDraft(profile, current),
          buildPermissionsFromTemplate(templateId),
          businessUnits,
        ),
        role: getTemplateRoleValue(templateId),
      },
    }));
  }

  function updateDraftModule(profile, moduleId, permission) {
    setDrafts((current) => {
      const draft = getDraft(profile, current);
      const payload = getEffectivePermissionsPayload(draft);
      return {
        ...current,
        [profile.id]: {
          ...draft,
          permissions: {
            ...payload,
            modules: {
              ...payload.modules,
              [moduleId]: permission,
            },
          },
        },
      };
    });
  }

  function updateDraftList(profile, field, value) {
    setDrafts((current) => {
      const draft = getDraft(profile, current);
      const payload = getEffectivePermissionsPayload(draft);
      return {
        ...current,
        [profile.id]: {
          ...draft,
          permissions: {
            ...payload,
            [field]: value,
          },
        },
      };
    });
  }

  async function sendInvite(event) {
    event.preventDefault();
    if (!accessAdmin) return;

    if (!hasBusinessAccess(inviteForm, businessUnits) && !isOwnerEmail(inviteForm.email)) {
      setError('Choose at least one business before inviting this user.');
      return;
    }

    if (inviteForm.active && !hasAnyModulePermission(inviteForm)) {
      setError('Choose Staff Portal or another role template before inviting an active user.');
      return;
    }

    setInviting(true);
    setError('');
    setMessage('');

    try {
      const result = await inviteUserProfile(inviteForm);

      if (result.profile?.id) {
        await updateUserProfile({
          ...result.profile,
          ...inviteForm,
          email: result.profile.email || inviteForm.email,
          id: result.profile.id,
        });
      }

      const profile = result.profile || inviteForm;
      setMessage(
        result.invited
          ? `Invite sent to ${profile.email}.`
          : `${profile.email} already has a login. Access was updated to ${normalizePermissionsPayload(inviteForm.permissions).role_title}.`,
      );
      setInviteForm(makeBlankInvite());
      await loadProfiles();
    } catch (err) {
      setError(err.message || 'Unable to send invite.');
    } finally {
      setInviting(false);
    }
  }

  async function saveProfile(profile, overrideDraft = null) {
    if (!accessAdmin) return false;

    const draft = overrideDraft || getDraft(profile, drafts);
    const owner = isOwnerProfile(profile);
    const self = profile.id === currentUserId;

    if (owner) {
      setError('Owner access cannot be restricted.');
      return false;
    }

    if (!hasBusinessAccess(draft, businessUnits) && !isOwnerEmail(profile.email)) {
      setError('Choose at least one business before saving this user.');
      return false;
    }

    if (draft.active && !hasAnyModulePermission(draft)) {
      setError('Choose Staff Portal or another role template before saving an active user.');
      return false;
    }

    if (self && (!draft.active || getModulePermission(draft, 'access') !== 'admin')) {
      setError('You cannot remove your own Access admin permission while using this account.');
      return false;
    }

    setSavingId(profile.id);
    setError('');
    setMessage('');

    try {
      await updateUserProfile(draft);
      setMessage(
        `${draft.full_name || draft.email} is now ${getEffectivePermissionsPayload(draft).role_title}.`,
      );
      await loadProfiles();
      return true;
    } catch (err) {
      setError(err.message || 'Unable to save access changes.');
      return false;
    } finally {
      setSavingId('');
    }
  }

  function resetDraft(profile) {
    setDrafts((current) => {
      const next = { ...current };
      delete next[profile.id];
      return next;
    });
  }

  async function confirmAccessChange() {
    if (!accessTarget) return;
    const saved = await saveProfile(accessTarget.profile, accessTarget.next);
    if (saved) setAccessTarget(null);
  }

  function setLinkChoice(profileId, keepProfileId) {
    setLinkPicker((current) => ({ ...current, [profileId]: keepProfileId }));
  }

  function openLinkConfirm(signInProfile) {
    const keepProfileId = linkPicker[signInProfile.id];
    const keepProfile = profiles.find((candidate) => candidate.id === keepProfileId);
    if (!keepProfile) return;
    setLinkTarget({ keepProfile, signInProfile });
  }

  async function confirmLink() {
    if (!linkTarget) return;
    setLinking(true);
    setError('');
    setMessage('');

    try {
      await linkUserProfile(linkTarget.signInProfile.id, linkTarget.keepProfile.id);
      setMessage(
        `Linked ${linkTarget.signInProfile.email} to ${linkTarget.keepProfile.full_name || linkTarget.keepProfile.email}.`,
      );
      setLinkPicker((current) => {
        const next = { ...current };
        delete next[linkTarget.signInProfile.id];
        return next;
      });
      setLinkTarget(null);
      await loadProfiles();
    } catch (err) {
      setError(err.message || 'Unable to link accounts.');
    } finally {
      setLinking(false);
    }
  }

  return (
    <div className="page-grid access-page">
      <section className="panel full-span access-command-panel">
        <div>
          <span className="eyebrow">Access control</span>
          <h2>Team logins</h2>
          <p>
            Pick a role as the starting point, then choose exactly what that person can see or control before you promote them.
          </p>
        </div>
        <div className="access-command-stats">
          <div>
            <strong>{profiles.length}</strong>
            <span>Total</span>
          </div>
          <div>
            <strong>{activeCount}</strong>
            <span>Active</span>
          </div>
          <div>
            <strong>{pendingCount}</strong>
            <span>Needs setup</span>
          </div>
          <div>
            <strong>{adminCount}</strong>
            <span>Admins</span>
          </div>
        </div>
      </section>

      <details className="panel full-span access-create-panel">
        <summary>
          <span>
            <UserPlus size={18} />
            Add team login
          </span>
          {!accessAdmin ? (
            <StatusBadge tone="danger">Access admin required</StatusBadge>
          ) : (
            <StatusBadge tone="gold">Invite</StatusBadge>
          )}
        </summary>
        <form className="access-template-form" onSubmit={sendInvite}>
          <div className="invite-layout">
            <div className="invite-form-stack">
              <div className="form-grid compact">
                <label className="field">
                  <span>Name</span>
                  <input
                    disabled={!accessAdmin}
                    onChange={(event) => updateInvite('full_name', event.target.value)}
                    placeholder="Full name"
                    value={inviteForm.full_name}
                  />
                </label>
                <label className="field">
                  <span>Email</span>
                  <input
                    disabled={!accessAdmin}
                    onChange={(event) => updateInvite('email', event.target.value)}
                    placeholder="name@example.com"
                    required
                    type="email"
                    value={inviteForm.email}
                  />
                </label>
                <label className="field">
                  <span>Starting role</span>
                  <select
                    disabled={!accessAdmin}
                    onChange={(event) => applyInviteTemplate(event.target.value)}
                    value={normalizePermissionsPayload(inviteForm.permissions).role_template}
                  >
                    {ROLE_TEMPLATES.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>System role label</span>
                  <select
                    disabled={!accessAdmin}
                    onChange={(event) => updateInvite('role', event.target.value)}
                    value={inviteForm.role}
                  >
                    {ROLE_OPTIONS.map((role) => (
                      <option key={role.value} value={role.value}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="check-row">
                  <input
                    checked={Boolean(inviteForm.active)}
                    disabled={!accessAdmin}
                    onChange={(event) => updateInvite('active', event.target.checked)}
                    type="checkbox"
                  />
                  <span>Active login</span>
                </label>
              </div>

              <BusinessAccessPicker
                businessUnits={businessUnits}
                disabled={!accessAdmin}
                onChange={(nextRecord) => setInvite(nextRecord)}
                owner={isOwnerEmail(inviteForm.email)}
                record={inviteForm}
              />

              <RoleAccessChooser
                compact
                disabled={!accessAdmin}
                onChange={updateInviteModule}
                permissions={inviteForm.permissions}
              />

              <details className="access-details">
                <summary>
                  <span>Responsibilities, restrictions, and role notes</span>
                  <StatusBadge tone="muted">Optional</StatusBadge>
                </summary>
                <ResponsibilitiesEditor
                  disabled={!accessAdmin}
                  onChange={updateInviteList}
                  permissions={inviteForm.permissions}
                />
              </details>

              <div className="action-row">
                <button className="primary-button" disabled={!accessAdmin || inviting} type="submit">
                  {inviting ? (
                    'Sending...'
                  ) : (
                    <>
                      <MailPlus size={17} />
                      Send invite with this access
                    </>
                  )}
                </button>
              </div>
            </div>

            <aside className="invite-side-card">
              <div className="invite-side-card__header">
                <span className="eyebrow">What they’ll get</span>
                <h3>Preview before you send</h3>
                <p>Role templates are starting points. Your choices below are the access they actually receive.</p>
              </div>
              <RolePromotionSummary
                businessLabel={businessAccessLabel(businessUnits, inviteForm, isOwnerEmail(inviteForm.email))}
                permissions={inviteForm.permissions}
              />
              <RoleTemplatePreview permissions={inviteForm.permissions} />
              <div className="help-list">
                <div>
                  <strong>You stay in control</strong>
                  <span>Promoting someone does not automatically give them every management area.</span>
                </div>
                <div>
                  <strong>Sensitive access is obvious</strong>
                  <span>Payroll, Access and Settings are flagged so you can review them before sharing.</span>
                </div>
              </div>
            </aside>
          </div>
        </form>
      </details>

      <section className="panel full-span">
        <div className="section-header">
          <div>
            <span>Manage access</span>
            <h2>{filteredProfiles.length} user{filteredProfiles.length === 1 ? '' : 's'} shown</h2>
          </div>
          <button className="secondary-button" type="button" onClick={loadProfiles}>
            <RefreshCw size={17} />
            Refresh
          </button>
        </div>

        <div className="access-toolbar">
          <label className="access-search">
            <Search size={16} />
            <input
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search name, email, role, business..."
              value={searchTerm}
            />
          </label>
          <div className="access-filter-tabs" role="tablist" aria-label="Access user filters">
            {[
              ['all', 'All'],
              ['needs', 'Needs setup'],
              ['active', 'Active'],
              ['staff', 'Staff Hub'],
              ['admins', 'Admins'],
              ['inactive', 'Inactive'],
            ].map(([id, label]) => (
              <button
                className={filter === id ? 'active' : ''}
                key={id}
                onClick={() => setFilter(id)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {error ? <div className="alert danger">{error}</div> : null}
        {message ? <div className="alert success">{message}</div> : null}

        {filteredProfiles.length ? (
          <div className="access-card-list">
            {filteredProfiles.map((profile) => {
              const draft = getDraft(profile, drafts);
              const owner = isOwnerProfile(profile);
              const isCurrentUser = profile.id === currentUserId;
              const disabled = !accessAdmin || owner;
              const payload = getEffectivePermissionsPayload(draft);
              const template = getRoleTemplate(payload.role_template);
              const needsSetup =
                !owner &&
                (!draft.active ||
                  !hasAnyModulePermission(draft) ||
                  !hasBusinessAccess(draft, businessUnits));
              const isDirty =
                JSON.stringify(comparable(draft)) !==
                JSON.stringify(comparable({ ...profile, permissions: normalizePermissionsPayload(profile.permissions) }));

              return (
                <article className="access-card" key={profile.id}>
                  <div className="access-card__header">
                    <div className="person-cell">
                      <input
                        disabled={disabled}
                        onChange={(event) => updateDraft(profile, 'full_name', event.target.value)}
                        value={draft.full_name || ''}
                      />
                      <span>{profile.email}</span>
                    </div>
                    <div className="business-chip-list">
                      {needsSetup ? <StatusBadge tone="warning">Needs setup</StatusBadge> : null}
                      <StatusBadge tone={draft.active || owner ? 'success' : 'muted'}>
                        {draft.active || owner ? 'Active' : 'Inactive'}
                      </StatusBadge>
                      <StatusBadge tone={owner ? 'gold' : 'muted'}>{payload.role_title}</StatusBadge>
                      <StatusBadge tone="muted">
                        {businessAccessLabel(businessUnits, draft, owner)}
                      </StatusBadge>
                    </div>
                  </div>

                  <div className="access-card__controls">
                    <label className="field">
                      <span>Promote / assign role</span>
                      <select
                        disabled={disabled}
                        onChange={(event) => applyDraftTemplate(profile, event.target.value)}
                        value={payload.role_template}
                      >
                        {ROLE_TEMPLATES.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>System role label</span>
                      <select
                        disabled={disabled}
                        onChange={(event) => updateDraft(profile, 'role', event.target.value)}
                        value={draft.role}
                      >
                        {ROLE_OPTIONS.map((role) => (
                          <option key={role.value} value={role.value}>
                            {role.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="check-row">
                      <input
                        checked={Boolean(draft.active || owner)}
                        disabled={disabled || isCurrentUser}
                        onChange={(event) => updateDraft(profile, 'active', event.target.checked)}
                        type="checkbox"
                      />
                      <span>Active login</span>
                    </label>
                  </div>

                  <details
                    className="access-details"
                    onToggle={(event) => {
                      if (event.currentTarget.open) {
                        setExpandedProfileId(profile.id);
                      } else if (expandedProfileId === profile.id) {
                        setExpandedProfileId('');
                      }
                    }}
                    open={expandedProfileId === profile.id || isDirty}
                  >
                    <summary>
                      <span>Review promotion access before saving</span>
                      <StatusBadge tone={isDirty ? 'warning' : 'muted'}>
                        {isDirty ? 'Review changes' : 'Open access setup'}
                      </StatusBadge>
                    </summary>

                    <BusinessAccessPicker
                      businessUnits={businessUnits}
                      disabled={disabled}
                      onChange={(nextRecord) => updateDraftBusinessAccess(profile, nextRecord)}
                      owner={owner}
                      record={draft}
                    />

                    <RolePromotionSummary
                      businessLabel={businessAccessLabel(businessUnits, draft, owner)}
                      permissions={payload}
                    />

                    <div className="template-preview">
                      <div>
                        <strong>{payload.role_title}</strong>
                        <span>{template.description}</span>
                      </div>
                      <StatusBadge tone={owner ? 'gold' : 'muted'}>
                        {owner ? 'Owner override' : getRoleLabel(draft.role)}
                      </StatusBadge>
                    </div>

                    <RoleAccessChooser
                      compact
                      disabled={disabled}
                      onChange={(moduleId, permission) =>
                        updateDraftModule(profile, moduleId, permission)
                      }
                      permissions={payload}
                    />
                    <details className="access-details">
                      <summary>
                        <span>Responsibilities, restrictions, and role notes</span>
                        <StatusBadge tone="muted">Optional</StatusBadge>
                      </summary>
                      <ResponsibilitiesEditor
                        disabled={disabled}
                        onChange={(field, value) => updateDraftList(profile, field, value)}
                        permissions={payload}
                      />
                    </details>
                  </details>

                  <div className="row-actions">
                    {isDirty ? (
                      <button
                        className="ghost-button small"
                        disabled={savingId === profile.id}
                        onClick={() => resetDraft(profile)}
                        type="button"
                      >
                        <Undo2 size={14} />
                        Undo
                      </button>
                    ) : null}
                    <button
                      className="primary-button small"
                      disabled={disabled || !isDirty || savingId === profile.id}
                      onClick={() => saveProfile(profile)}
                      type="button"
                    >
                      {savingId === profile.id ? (
                        'Saving...'
                      ) : (
                        <>
                          <Check size={15} />
                          Apply role & access
                        </>
                      )}
                    </button>
                    {!owner && !isCurrentUser ? (
                      <button
                        className={
                          draft.active
                            ? 'ghost-button small danger-action'
                            : 'secondary-button small success-action'
                        }
                        disabled={!accessAdmin || savingId === profile.id}
                        onClick={() =>
                          setAccessTarget({
                            next: {
                              ...draft,
                              active: !draft.active,
                            },
                            profile,
                          })
                        }
                        type="button"
                      >
                        {draft.active ? <Ban size={14} /> : <RotateCcw size={14} />}
                        {draft.active ? 'Revoke' : 'Restore'}
                      </button>
                    ) : null}
                  </div>

                  {!owner && !isCurrentUser && profiles.length > 1 ? (
                    <div className="row-actions link-account-row">
                      <select
                        aria-label={`Link ${profile.email} to an existing profile`}
                        disabled={!accessAdmin}
                        onChange={(event) => setLinkChoice(profile.id, event.target.value)}
                        value={linkPicker[profile.id] || ''}
                      >
                        <option value="">Duplicate sign-in? Link to existing profile...</option>
                        {profiles
                          .filter((candidate) => candidate.id !== profile.id && !isOwnerProfile(candidate))
                          .map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>
                              {candidate.full_name || candidate.email} ({candidate.email})
                            </option>
                          ))}
                      </select>
                      <button
                        className="ghost-button small"
                        disabled={!accessAdmin || !linkPicker[profile.id]}
                        onClick={() => openLinkConfirm(profile)}
                        type="button"
                      >
                        <Link2 size={14} />
                        Link
                      </button>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : profiles.length ? (
          <EmptyState
            icon={Search}
            title="No matching users"
            message="Clear the search or choose a different filter."
          />
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

      {accessTarget ? (
        <ConfirmDialog
          busy={savingId === accessTarget.profile.id}
          confirmLabel={accessTarget.next.active ? 'Restore access' : 'Revoke access'}
          description={
            accessTarget.next.active
              ? `Restore RTB OS access for ${accessTarget.profile.full_name || accessTarget.profile.email}?`
              : `Revoke RTB OS access for ${accessTarget.profile.full_name || accessTarget.profile.email}? Their login account remains available to restore later.`
          }
          onClose={() => setAccessTarget(null)}
          onConfirm={confirmAccessChange}
          title={accessTarget.next.active ? 'Restore user access' : 'Revoke user access'}
          tone={accessTarget.next.active ? 'warning' : 'danger'}
        >
          {error ? <div className="alert danger">{error}</div> : null}
        </ConfirmDialog>
      ) : null}

      {linkTarget ? (
        <ConfirmDialog
          busy={linking}
          confirmLabel="Link accounts"
          description={
            `${linkTarget.signInProfile.email} signed in as a separate login. Linking keeps ` +
            `${linkTarget.keepProfile.full_name || linkTarget.keepProfile.email}'s role, permissions, and ` +
            `business access, moves them onto the ${linkTarget.signInProfile.email} sign-in, and removes the ` +
            `duplicate profile.`
          }
          onClose={() => setLinkTarget(null)}
          onConfirm={confirmLink}
          title="Link duplicate sign-in"
          tone="warning"
        >
          {error ? <div className="alert danger">{error}</div> : null}
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
