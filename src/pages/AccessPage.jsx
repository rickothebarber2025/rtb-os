import { useEffect, useMemo, useState } from 'react';
import {
  Ban,
  Check,
  MailPlus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Undo2,
  Users,
} from 'lucide-react';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import StatusBadge from '../components/StatusBadge';
import { getUserProfiles, inviteUserProfile, updateUserProfile } from '../services/rtbService';
import {
  getEffectivePermissionsPayload,
  getModulePermission,
  hasAnyModulePermission,
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
  return {
    active: true,
    business_unit_id: '',
    email: '',
    full_name: '',
    permissions: buildPermissionsFromTemplate('custom'),
    role: getTemplateRoleValue('custom'),
  };
}

function getDraft(profile, drafts) {
  const draft = drafts[profile.id] || profile;
  return {
    ...draft,
    active: Boolean(draft.active),
    business_unit_id: draft.business_unit_id || '',
    permissions: normalizePermissionsPayload(draft.permissions),
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

function businessLabel(businessUnits, businessUnitId, owner) {
  if (owner) return 'All Businesses';
  return businessUnits.find((unit) => unit.id === businessUnitId)?.name || 'Business required';
}

function PermissionMatrix({ disabled, permissions, onChange }) {
  const payload = normalizePermissionsPayload(permissions);

  return (
    <div className="permission-matrix">
      {MODULE_IDS.map((moduleId) => (
        <label className="permission-cell" key={moduleId}>
          <span>{MODULE_LABELS[moduleId]}</span>
          <select
            disabled={disabled}
            onChange={(event) => onChange(moduleId, event.target.value)}
            value={payload.modules[moduleId]}
          >
            <option value="none">None</option>
            <option value="view">View</option>
            <option value="edit">Edit</option>
            <option value="admin">Admin</option>
          </select>
        </label>
      ))}
    </div>
  );
}

function ResponsibilitiesEditor({ disabled, permissions, onChange }) {
  const payload = normalizePermissionsPayload(permissions);

  return (
    <div className="role-detail-grid">
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
  const [drafts, setDrafts] = useState({});
  const [accessTarget, setAccessTarget] = useState(null);
  const [error, setError] = useState('');
  const [inviteForm, setInviteForm] = useState(() => makeBlankInvite());
  const [inviting, setInviting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [profiles, setProfiles] = useState([]);
  const [savingId, setSavingId] = useState('');

  const pendingCount = useMemo(
    () =>
      profiles.filter(
        (profile) => !profile.active || (!isOwnerProfile(profile) && !hasAnyModulePermission(profile)),
      ).length,
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
      permissions: buildPermissionsFromTemplate(templateId),
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

  function applyDraftTemplate(profile, templateId) {
    setDrafts((current) => ({
      ...current,
      [profile.id]: {
        ...getDraft(profile, current),
        permissions: buildPermissionsFromTemplate(templateId),
        role: getTemplateRoleValue(templateId),
      },
    }));
  }

  function updateDraftModule(profile, moduleId, permission) {
    setDrafts((current) => {
      const draft = getDraft(profile, current);
      const payload = normalizePermissionsPayload(draft.permissions);
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
      return {
        ...current,
        [profile.id]: {
          ...draft,
          permissions: {
            ...normalizePermissionsPayload(draft.permissions),
            [field]: value,
          },
        },
      };
    });
  }

  async function sendInvite(event) {
    event.preventDefault();
    if (!accessAdmin) return;

    if (!inviteForm.business_unit_id && !isOwnerEmail(inviteForm.email)) {
      setError('Choose a business unit before inviting this user.');
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

    if (!draft.business_unit_id && !isOwnerEmail(profile.email)) {
      setError('Choose a business unit before saving this user.');
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
        `${draft.full_name || draft.email} is now ${normalizePermissionsPayload(draft.permissions).role_title}.`,
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

  return (
    <div className="page-grid access-page">
      <section className="hero-panel access-hero">
        <div>
          <span className="eyebrow">Users & access</span>
          <h2>Role templates and module permissions</h2>
          <p>
            Templates are quick presets. Permissions control access. Responsibilities explain the
            work expected from each user.
          </p>
        </div>
        <div className="hero-meta">
          <strong>{pendingCount}</strong>
          <span>need setup</span>
        </div>
      </section>

      <section className="panel full-span">
        <div className="section-header">
          <div>
            <span>Invite</span>
            <h2>Add team login</h2>
          </div>
          {!accessAdmin ? <StatusBadge tone="danger">Access admin required</StatusBadge> : null}
        </div>

        <form className="access-template-form" onSubmit={sendInvite}>
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
              <span>Business unit</span>
              <select
                disabled={!accessAdmin}
                onChange={(event) => updateInvite('business_unit_id', event.target.value)}
                required={!isOwnerEmail(inviteForm.email)}
                value={inviteForm.business_unit_id}
              >
                <option value="">Choose business unit</option>
                {businessUnits.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Choose role template</span>
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
              <span>Role label</span>
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

          <RoleTemplatePreview permissions={inviteForm.permissions} />
          <PermissionMatrix
            disabled={!accessAdmin}
            onChange={updateInviteModule}
            permissions={inviteForm.permissions}
          />
          <ResponsibilitiesEditor
            disabled={!accessAdmin}
            onChange={updateInviteList}
            permissions={inviteForm.permissions}
          />

          <div className="action-row">
            <button className="primary-button" disabled={!accessAdmin || inviting} type="submit">
              {inviting ? (
                'Sending...'
              ) : (
                <>
                  <MailPlus size={17} />
                  Send invite
                </>
              )}
            </button>
          </div>
        </form>
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
          <div className="access-card-list">
            {profiles.map((profile) => {
              const draft = getDraft(profile, drafts);
              const owner = isOwnerProfile(profile);
              const isCurrentUser = profile.id === currentUserId;
              const disabled = !accessAdmin || owner;
              const payload = getEffectivePermissionsPayload(draft);
              const template = getRoleTemplate(payload.role_template);
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
                      <StatusBadge tone={draft.active || owner ? 'success' : 'muted'}>
                        {draft.active || owner ? 'Active' : 'Inactive'}
                      </StatusBadge>
                      <StatusBadge tone={owner ? 'gold' : 'muted'}>{payload.role_title}</StatusBadge>
                      <StatusBadge tone="muted">
                        {businessLabel(businessUnits, draft.business_unit_id, owner)}
                      </StatusBadge>
                    </div>
                  </div>

                  <div className="access-card__controls">
                    <label className="field">
                      <span>Choose role template</span>
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
                      <span>Role label</span>
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
                    <label className="field">
                      <span>Business unit</span>
                      <select
                        disabled={disabled}
                        onChange={(event) =>
                          updateDraft(profile, 'business_unit_id', event.target.value)
                        }
                        required={!owner}
                        value={draft.business_unit_id || ''}
                      >
                        <option value="">{owner ? 'All Businesses' : 'Choose business unit'}</option>
                        {businessUnits.map((unit) => (
                          <option key={unit.id} value={unit.id}>
                            {unit.name}
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

                  <div className="template-preview">
                    <div>
                      <strong>{payload.role_title}</strong>
                      <span>{template.description}</span>
                    </div>
                    <StatusBadge tone={owner ? 'gold' : 'muted'}>
                      {owner ? 'Owner override' : getRoleLabel(draft.role)}
                    </StatusBadge>
                  </div>

                  <PermissionMatrix
                    disabled={disabled}
                    onChange={(moduleId, permission) =>
                      updateDraftModule(profile, moduleId, permission)
                    }
                    permissions={payload}
                  />
                  <ResponsibilitiesEditor
                    disabled={disabled}
                    onChange={(field, value) => updateDraftList(profile, field, value)}
                    permissions={payload}
                  />

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
                          Save changes
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
                </article>
              );
            })}
          </div>
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
    </div>
  );
}
