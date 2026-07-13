import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ClipboardCheck,
  LockKeyhole,
  Palette,
  RotateCcw,
  Save,
  ShieldCheck,
  UserCog,
} from 'lucide-react';
import StatusBadge from '../components/StatusBadge';
import { DEFAULT_USER_PREFERENCES } from '../hooks/useUserPreferences';
import {
  getProfileBusinessUnitIds,
  hasAllBusinessAccess,
  getEffectivePermissionsPayload,
  isOwnerProfile,
  MODULE_IDS,
  MODULE_LABELS,
} from '../lib/permissions.js';
import { buildRoleWorkspace } from '../utils/workspaces';

function permissionTone(level) {
  if (level === 'admin') return 'gold';
  if (level === 'edit') return 'success';
  if (level === 'view') return 'muted';
  return 'danger';
}

const THEME_OPTIONS = [
  {
    description: 'Changes with the business selector',
    label: 'Auto',
    swatchClass: 'auto',
    value: 'auto',
  },
  {
    description: 'Soft pink and polished for the salon',
    label: 'Beauty',
    swatchClass: 'beauty',
    value: 'beauty',
  },
  {
    description: 'Clean black and gold for RTB Lounge',
    label: 'RTB Lounge',
    swatchClass: 'lounge',
    value: 'lounge',
  },
  {
    description: 'Balanced owner view for both businesses',
    label: 'Combined',
    swatchClass: 'combined',
    value: 'combined',
  },
];

export default function MyRolePage({
  accessProfile,
  businessUnit,
  businessUnits,
  navItems,
  setActivePage,
  setUserPreferences,
  userPreferences,
}) {
  const payload = getEffectivePermissionsPayload(accessProfile);
  const workspace = buildRoleWorkspace(accessProfile, navItems, businessUnit);
  const owner = isOwnerProfile(accessProfile);
  const [draftPreferences, setDraftPreferences] = useState(
    userPreferences || DEFAULT_USER_PREFERENCES,
  );
  const [saveMessage, setSaveMessage] = useState('');
  const allBusinesses = owner || hasAllBusinessAccess(accessProfile);
  const businessNames = allBusinesses
    ? ['All Businesses']
    : getProfileBusinessUnitIds(accessProfile)
        .map((id) => businessUnits.find((unit) => unit.id === id)?.name)
        .filter(Boolean);
  const businessLabel = businessNames.length ? businessNames.join(', ') : 'Not assigned';
  const responsibilities = payload.responsibilities.length
    ? payload.responsibilities
    : ['No responsibilities are assigned yet.'];
  const restrictions = payload.restrictions.length
    ? payload.restrictions
    : ['No restrictions are listed for this role.'];
  const expectations = payload.expectations || 'No extra expectations are listed for this role.';
  const selectedTheme =
    THEME_OPTIONS.find((option) => option.value === draftPreferences.themePreference) ||
    THEME_OPTIONS[0];

  useEffect(() => {
    setDraftPreferences(userPreferences || DEFAULT_USER_PREFERENCES);
  }, [userPreferences]);

  function updatePreference(field, value) {
    setSaveMessage('');
    setDraftPreferences((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function savePreferences(event) {
    event.preventDefault();
    setUserPreferences?.(draftPreferences);
    setSaveMessage('Saved on this device.');
  }

  function resetPreferences() {
    setDraftPreferences(DEFAULT_USER_PREFERENCES);
    setUserPreferences?.(DEFAULT_USER_PREFERENCES);
    setSaveMessage('Reset to automatic style.');
  }

  return (
    <div className="page-grid my-role-page">
      <section className="hero-panel full-span">
        <div>
          <span className="eyebrow">My Role</span>
          <h2>{payload.role_title}</h2>
          <p>{payload.role_description}</p>
        </div>
        <div className="hero-meta">
          <strong>{owner ? 'Owner' : businessLabel}</strong>
          <span>{allBusinesses ? 'All businesses' : 'Business access'}</span>
        </div>
      </section>

      <section className="panel">
        <div className="section-header">
          <div>
            <span>Profile</span>
            <h2>Access summary</h2>
          </div>
          <UserCog size={20} />
        </div>
        <div className="role-summary-list">
          <div>
            <span>Email</span>
            <strong>{accessProfile?.email || 'Not set'}</strong>
          </div>
          <div>
            <span>Business access</span>
            <strong>{businessLabel}</strong>
          </div>
          <div>
            <span>Template</span>
            <strong>{payload.role_template}</strong>
          </div>
          <div>
            <span>Status</span>
            <StatusBadge tone={accessProfile?.active || owner ? 'success' : 'muted'}>
              {accessProfile?.active || owner ? 'Active' : 'Inactive'}
            </StatusBadge>
          </div>
        </div>
      </section>

      <section className="panel two-thirds profile-customizer">
        <div className="section-header">
          <div>
            <span>Profile edits</span>
            <h2>Make RTB OS feel like yours</h2>
          </div>
          <Palette size={20} />
        </div>

        <form className="profile-customizer__form" onSubmit={savePreferences}>
          <label className="field">
            <span>Display name</span>
            <input
              type="text"
              value={draftPreferences.displayName}
              placeholder={accessProfile?.email || 'Your name'}
              onChange={(event) => updatePreference('displayName', event.target.value)}
            />
          </label>

          <div className="field full-span">
            <span>App style</span>
            <div className="theme-choice-grid" role="radiogroup" aria-label="App style">
              {THEME_OPTIONS.map((option) => (
                <button
                  aria-checked={draftPreferences.themePreference === option.value}
                  className={`theme-choice ${
                    draftPreferences.themePreference === option.value ? 'selected' : ''
                  }`}
                  key={option.value}
                  role="radio"
                  type="button"
                  onClick={() => updatePreference('themePreference', option.value)}
                >
                  <span className={`theme-swatch ${option.swatchClass}`} />
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </button>
              ))}
            </div>
          </div>

          <div className="preference-grid full-span">
            <label className="field">
              <span>Spacing</span>
              <select
                value={draftPreferences.density}
                onChange={(event) => updatePreference('density', event.target.value)}
              >
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </select>
            </label>

            <label className="field">
              <span>Navigation</span>
              <select
                value={draftPreferences.navigationStyle}
                onChange={(event) => updatePreference('navigationStyle', event.target.value)}
              >
                <option value="simple">Simple</option>
                <option value="full">Full</option>
              </select>
            </label>

            <label className="check-row preference-toggle">
              <input
                checked={draftPreferences.reduceMotion}
                type="checkbox"
                onChange={(event) => updatePreference('reduceMotion', event.target.checked)}
              />
              <span>Reduce motion</span>
            </label>
          </div>

          <div className="profile-customizer__actions full-span">
            <button className="primary-button" type="submit">
              <Save size={16} />
              Save profile style
            </button>
            <button className="secondary-button" type="button" onClick={resetPreferences}>
              <RotateCcw size={16} />
              Reset
            </button>
            {saveMessage ? <span>{saveMessage}</span> : null}
          </div>
        </form>
      </section>

      <section className="panel profile-preview-card">
        <div className="section-header">
          <div>
            <span>Preview</span>
            <h2>{selectedTheme.label} mode</h2>
          </div>
          <span className={`theme-swatch ${selectedTheme.swatchClass}`} />
        </div>
        <div className="profile-preview-card__body">
          <strong>{draftPreferences.displayName || 'Your profile'}</strong>
          <span>{businessLabel}</span>
          <div>
            <StatusBadge tone="gold">{draftPreferences.density}</StatusBadge>
            <StatusBadge tone="muted">{draftPreferences.navigationStyle}</StatusBadge>
          </div>
        </div>
      </section>

      <section className="panel two-thirds">
        <div className="section-header">
          <div>
            <span>Workspace</span>
            <h2>Start here</h2>
          </div>
          <ClipboardCheck size={20} />
        </div>
        <p className="subtle-text">{workspace.description}</p>
        <div className="workspace-actions">
          {workspace.focusPages.map((page) => (
            <button
              className="secondary-button small"
              key={page.id}
              type="button"
              onClick={() => setActivePage(page.id)}
            >
              {page.label}
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="section-header">
          <div>
            <span>Setup</span>
            <h2>Onboarding checklist</h2>
          </div>
          <CheckCircle2 size={20} />
        </div>
        <div className="workspace-checklist">
          {workspace.onboarding.map((item) => (
            <div className={item.complete ? 'complete' : 'open'} key={item.label}>
              <CheckCircle2 size={16} />
              <strong>{item.label}</strong>
              <small>{item.detail}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="panel two-thirds">
        <div className="section-header">
          <div>
            <span>Modules</span>
            <h2>What I can access</h2>
          </div>
          <ShieldCheck size={20} />
        </div>
        <div className="permission-overview-grid">
          {MODULE_IDS.map((moduleId) => (
            <div className="permission-overview-card" key={moduleId}>
              <span>{MODULE_LABELS[moduleId]}</span>
              <StatusBadge tone={permissionTone(payload.modules[moduleId])}>
                {payload.modules[moduleId]}
              </StatusBadge>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="section-header">
          <div>
            <span>Responsibilities</span>
            <h2>Expected work</h2>
          </div>
          <CheckCircle2 size={20} />
        </div>
        <ul className="role-list">
          {responsibilities.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <div className="section-header">
          <div>
            <span>Expectations</span>
            <h2>Role notes</h2>
          </div>
          <ClipboardCheck size={20} />
        </div>
        <p className="subtle-text">{expectations}</p>
      </section>

      <section className="panel two-thirds">
        <div className="section-header">
          <div>
            <span>Restrictions</span>
            <h2>What I cannot do</h2>
          </div>
          <LockKeyhole size={20} />
        </div>
        <ul className="role-list columns">
          {restrictions.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
