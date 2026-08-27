import { Eye, EyeOff, ShieldCheck } from 'lucide-react';
import StatusBadge from './StatusBadge';
import { MODULE_IDS, MODULE_LABELS, normalizePermissionsPayload } from '../lib/permissions.js';

const MODULE_HELP = {
  staff_hub: 'Personal RTB workspace, updates, tasks, schedule and role information.',
  dashboard: 'Business overview and dashboard reporting.',
  roster: 'Staff profiles, roster details and talent records.',
  payroll: 'Payroll runs, commission and payout information.',
  performance: 'Staff performance, KPIs and business reporting.',
  appointments: 'Booking and appointment information.',
  booth_rent: 'Booth-rent records and follow-up.',
  operations: 'Tasks, checklists, incidents and shop operations.',
  access: 'User roles and permissions. Reserve this for trusted administrators.',
  settings: 'Connections, system tools and business settings.',
};

const LEVEL_COPY = {
  view: 'Can see it',
  edit: 'Can use & update it',
  admin: 'Full control',
};

export default function RoleAccessChooser({ disabled, permissions, onChange, compact = false }) {
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
          <h3>Choose exactly what they can access</h3>
          <p>Start with the role template, then turn individual areas on or off before saving the promotion.</p>
        </div>
        <StatusBadge tone={sharedCount ? 'success' : 'warning'}>
          {sharedCount} of {MODULE_IDS.length} areas shared
        </StatusBadge>
      </div>

      <div className={compact ? 'permission-matrix role-access-grid compact' : 'permission-matrix role-access-grid'}>
        {MODULE_IDS.map((moduleId) => {
          const level = payload.modules[moduleId];
          const shared = level !== 'none';
          const sensitive = ['access', 'payroll', 'settings'].includes(moduleId);

          return (
            <div className={`permission-cell role-access-card ${shared ? 'is-shared' : ''}`} key={moduleId}>
              <label className="check-row role-access-toggle">
                <input
                  checked={shared}
                  disabled={disabled}
                  onChange={(event) => toggleModule(moduleId, event.target.checked)}
                  type="checkbox"
                />
                <span>{MODULE_LABELS[moduleId]}</span>
              </label>

              <small className="subtle-text">{MODULE_HELP[moduleId]}</small>

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
              ) : (
                <div className="business-chip-list">
                  <StatusBadge tone="muted"><EyeOff size={12} /> Not shared</StatusBadge>
                </div>
              )}

              {shared ? (
                <div className="business-chip-list">
                  <StatusBadge tone={level === 'admin' ? 'gold' : 'muted'}>
                    {level === 'admin' ? <ShieldCheck size={12} /> : <Eye size={12} />}
                    {LEVEL_COPY[level]}
                  </StatusBadge>
                  {sensitive ? <StatusBadge tone="warning">Sensitive</StatusBadge> : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
