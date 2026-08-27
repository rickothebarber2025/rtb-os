import { Eye, EyeOff, ShieldCheck } from 'lucide-react';
import StatusBadge from './StatusBadge';
import { MODULE_IDS, MODULE_LABELS, normalizePermissionsPayload } from '../lib/permissions.js';

const MODULE_HELP = {
  staff_hub: 'Their personal RTB workspace, updates, tasks, schedule and role information.',
  dashboard: 'Business dashboard and owner-level overview data.',
  roster: 'Staff profiles, roster details and talent records.',
  payroll: 'Payroll runs, commission and payout information.',
  performance: 'Staff performance, KPIs and business reporting.',
  appointments: 'Booking and appointment information.',
  booth_rent: 'Booth-rent records and follow-up.',
  operations: 'Tasks, checklists, issues and shop operations.',
  access: 'User roles and permissions. Give this only to trusted administrators.',
  settings: 'Connections, system tools and business settings.',
};

const LEVEL_COPY = {
  view: 'Can see it',
  edit: 'Can use and update it',
  admin: 'Full control',
};

export default function RoleAccessChooser({ disabled, permissions, onChange }) {
  const payload = normalizePermissionsPayload(permissions);
  const sharedCount = MODULE_IDS.filter((moduleId) => payload.modules[moduleId] !== 'none').length;

  function toggleModule(moduleId, checked) {
    onChange(moduleId, checked ? 'view' : 'none');
  }

  return (
    <section className="role-access-chooser">
      <div className="section-header">
        <div>
          <span>Owner access setup</span>
          <h3>Choose exactly what this role can access</h3>
          <p>Start with the role preset, then turn areas on or off before you save the promotion.</p>
        </div>
        <StatusBadge tone={sharedCount ? 'success' : 'warning'}>
          {sharedCount} of {MODULE_IDS.length} areas shared
        </StatusBadge>
      </div>

      <div className="role-access-grid">
        {MODULE_IDS.map((moduleId) => {
          const level = payload.modules[moduleId];
          const shared = level !== 'none';
          const sensitive = moduleId === 'access' || moduleId === 'payroll' || moduleId === 'settings';

          return (
            <article className={`role-access-card ${shared ? 'shared' : ''}`} key={moduleId}>
              <div className="role-access-card__top">
                <label className="check-row">
                  <input
                    checked={shared}
                    disabled={disabled}
                    onChange={(event) => toggleModule(moduleId, event.target.checked)}
                    type="checkbox"
                  />
                  <span>{MODULE_LABELS[moduleId]}</span>
                </label>
                {sensitive ? <StatusBadge tone="warning">Sensitive</StatusBadge> : null}
              </div>

              <p>{MODULE_HELP[moduleId]}</p>

              {shared ? (
                <label className="field">
                  <span>Access level</span>
                  <select
                    disabled={disabled}
                    onChange={(event) => onChange(moduleId, event.target.value)}
                    value={level}
                  >
                    <option value="view">View — {LEVEL_COPY.view}</option>
                    <option value="edit">Edit — {LEVEL_COPY.edit}</option>
                    <option value="admin">Admin — {LEVEL_COPY.admin}</option>
                  </select>
                </label>
              ) : null}

              <div className="business-chip-list">
                {shared ? (
                  <StatusBadge tone={level === 'admin' ? 'gold' : 'muted'}>
                    {level === 'admin' ? <ShieldCheck size={12} /> : <Eye size={12} />}
                    {LEVEL_COPY[level]}
                  </StatusBadge>
                ) : (
                  <StatusBadge tone="muted"><EyeOff size={12} /> Not shared</StatusBadge>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
