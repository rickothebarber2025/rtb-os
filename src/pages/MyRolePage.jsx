import { CheckCircle2, LockKeyhole, ShieldCheck, UserCog } from 'lucide-react';
import StatusBadge from '../components/StatusBadge';
import {
  getProfileBusinessUnitIds,
  hasAllBusinessAccess,
  getEffectivePermissionsPayload,
  isOwnerProfile,
  MODULE_IDS,
  MODULE_LABELS,
} from '../lib/permissions.js';

function permissionTone(level) {
  if (level === 'admin') return 'gold';
  if (level === 'edit') return 'success';
  if (level === 'view') return 'muted';
  return 'danger';
}

export default function MyRolePage({ accessProfile, businessUnits }) {
  const payload = getEffectivePermissionsPayload(accessProfile);
  const owner = isOwnerProfile(accessProfile);
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
