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

const ADMIN_CONTROL_ITEMS = [
  {
    detail: 'Owner workspace, staff hub, combined business status, and quick links.',
    moduleId: 'dashboard',
    page: 'My Workspace / Staff Hub',
    write: 'View only',
  },
  {
    detail: 'Create staff, edit staff profiles, manage probation, deactivate, restore, and delete.',
    moduleId: 'roster',
    page: 'Roster',
    write: 'Edit staff; Admin deletes',
  },
  {
    detail: 'Build payroll drafts, save runs, correct old runs, and finalize payroll.',
    moduleId: 'payroll',
    page: 'Payroll',
    write: 'Edit drafts; Admin finalizes',
  },
  {
    detail: 'Booksy imports, Square appointment sync, appointment review, and import cleanup.',
    moduleId: 'appointments',
    page: 'Appointments',
    write: 'Edit imports and syncs',
  },
  {
    detail: 'Create rent records, mark paid, reopen, and remove mistakes.',
    moduleId: 'booth_rent',
    page: 'Booth Rent',
    write: 'Edit records; Admin deletes',
  },
  {
    detail: 'Action Center records, SOP checklists, hiring workflows, forms, and change logs.',
    moduleId: 'operations',
    page: 'Action Center / Operations',
    write: 'Edit records; Admin deletes/resets',
  },
  {
    detail: 'Performance reporting, Customer IQ requests, feedback queue, and improvement projects.',
    moduleId: 'performance',
    page: 'Performance / Customer IQ',
    write: 'Edit Customer IQ projects',
  },
  {
    detail: 'Invite staff, assign businesses, revoke users, and change role templates.',
    moduleId: 'access',
    page: 'Access',
    write: 'Admin only',
  },
  {
    detail: 'Backups, exports, health checks, support bundle, and recovery links.',
    moduleId: 'settings',
    page: 'System Tools',
    write: 'View/export tools',
  },
];

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

function permissionTone(level) {
  if (level === 'admin') return 'gold';
  if (level === 'edit') return 'success';
  if (level === 'view') return 'muted';
  return 'danger';
}

function AdminControlOverview({ accessProfile }) {
  const payload = getEffectivePermissionsPayload(accessProfile);

  return (
    <section className="panel full-span admin-control-overview">
      <div className="section-header">
        <div>
          <span>Admin control map</span>
          <h2>What each access switch controls</h2>
        </div>
        <StatusBadge tone="gold">{payload.role_title}</StatusBadge>
      </div>
      <div className="admin-control-grid">
        {ADMIN_CONTROL_ITEMS.map((item) => {
          const level = payload.modules[item.moduleId] || 'none';
          return (
            <article className="admin-control-card" key={item.moduleId}>
              <div>
                <strong>{MODULE_LABELS[item.moduleId]}</strong>
                <span>{item.page}</span>
              </div>
              <StatusBadge tone={permissionTone(level)}>{level}</StatusBadge>
              <p>{item.detail}</p>
              <small>{item.write}</small>
            </article>
          );
        })}
      </div>
    </section>
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
  const activeCount = useMemo(
    () => profiles.filter((profile) => profile.active && !isOwnerProfile(profile)).length,
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

      <section className="panel full-span access-overview">
        <div className="section-header">
          <div>
            <span>Access overview</span>
            <h2>Less hunting, more clarity</h2>
          </div>
          <StatusBadge tone="muted">Built for faster decisions</StatusBadge>
        </div>
        <div className="access-overview-grid">
          <article className="access-overview-card">
            <span className="eyebrow">At a glance</span>
            <strong>{activeCount} active team logins</strong>
            <p>Everyone who can work in RTB OS is surfaced in one place.</p>
          </article>
          <article className="access-overview-card">
            <span className="eyebrow">Needs attention</span>
            <strong>{pendingCount} users need setup</strong>
            <p>Invite or update profiles before they start using the app.</p>
          </article>
          <article className="access-overview-card">
            <span className="eyebrow">Templates ready</span>
            <strong>{ROLE_TEMPLATES.length} role presets</strong>
            <p>Use a starting point and tailor it without rebuilding permissions.</p>
          </article>
        </div>
      </section>

      <AdminControlOverview accessProfile={accessProfile} />

      <section className="panel full-span">
        <div className="section-header">
          <div>
            <span>Invite</span>
            <h2>Add team login</h2>
          </div>
          {!accessAdmin ? <StatusBadge tone="danger">Access admin required</StatusBadge> : null}
        </div>

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

              <BusinessAccessPicker
                businessUnits={businessUnits}
                disabled={!accessAdmin}
                onChange={(nextRecord) => setInvite(nextRecord)}
                owner={isOwnerEmail(inviteForm.email)}
                record={inviteForm}
              />

              <details className="access-details">
                <summary>
                  <span>Advanced permissions and role notes</span>
                  <StatusBadge tone="muted">Optional</StatusBadge>
                </summary>
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
              </details>

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
            </div>

            <aside className="invite-side-card">
              <div className="invite-side-card__header">
                <span className="eyebrow">What they’ll get</span>
                <h3>Preview before you send</h3>
                <p>Keep the invite experience clear by reviewing role scope, permissions, and business access together.</p>
              </div>
              <RoleTemplatePreview permissions={inviteForm.permissions} />
              <div className="help-list">
                <div>
                  <strong>Fast onboarding</strong>
                  <span>Start with a preset and fine-tune it instead of building from scratch.</span>
                </div>
                <div>
                  <strong>Business-first access</strong>
                  <span>Choose the right scope before saving so the user sees the right data.</span>
                </div>
              </div>
            </aside>
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
                        {businessAccessLabel(businessUnits, draft, owner)}
                      </StatusBadge>
                    </div>
                  </div>

                  <div className="access-card__meta">
                    <div className="access-card__meta-item">
                      <span>Business access</span>
                      <strong>{businessAccessLabel(businessUnits, draft, owner)}</strong>
                    </div>
                    <div className="access-card__meta-item">
                      <span>Role preview</span>
                      <strong>{payload.role_title}</strong>
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
                    open={isDirty || (!owner && !hasAnyModulePermission(draft))}
                  >
                    <summary>
                      <span>Business, permissions, and role notes</span>
                      <StatusBadge tone={isDirty ? 'warning' : 'muted'}>
                        {isDirty ? 'Unsaved' : 'Manage'}
                      </StatusBadge>
                    </summary>

                    <BusinessAccessPicker
                      businessUnits={businessUnits}
                      disabled={disabled}
                      onChange={(nextRecord) => updateDraftBusinessAccess(profile, nextRecord)}
                      owner={owner}
                      record={draft}
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
