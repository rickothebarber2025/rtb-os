import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import StatusBadge from './StatusBadge';
import { MODULE_IDS, MODULE_LABELS, normalizePermissionsPayload } from '../lib/permissions.js';

export default function RolePromotionSummary({ permissions, businessLabel }) {
  const payload = normalizePermissionsPayload(permissions);
  const shared = MODULE_IDS.filter((moduleId) => payload.modules[moduleId] !== 'none');
  const adminModules = shared.filter((moduleId) => payload.modules[moduleId] === 'admin');

  return (
    <div className="template-preview">
      <div>
        <strong>{payload.role_title}</strong>
        <span>{payload.role_description}</span>
        <small>{businessLabel}</small>
      </div>
      <div className="business-chip-list">
        {shared.length ? (
          <StatusBadge tone="success"><CheckCircle2 size={12} /> {shared.length} areas shared</StatusBadge>
        ) : (
          <StatusBadge tone="danger">No app access</StatusBadge>
        )}
        {adminModules.length ? (
          <StatusBadge tone="warning"><AlertTriangle size={12} /> Admin: {adminModules.map((id) => MODULE_LABELS[id]).join(', ')}</StatusBadge>
        ) : null}
      </div>
    </div>
  );
}
