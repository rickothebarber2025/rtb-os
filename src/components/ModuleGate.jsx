import { LockKeyhole } from 'lucide-react';
import { useAuthProfile } from '../contexts/AuthProfileContext.jsx';
import LoadingState from './LoadingState';
import { hasModulePermission, MODULE_LABELS } from '../lib/permissions.js';

export default function ModuleGate({
  children,
  fallback = null,
  minimum = 'view',
  module,
}) {
  const { loading, profile } = useAuthProfile();

  if (loading) return <LoadingState label="Checking access" />;
  const allowed = hasModulePermission(profile, module, minimum)
    || (module === 'roster' && minimum === 'edit' && hasModulePermission(profile, 'operations', 'edit'));
  if (allowed) return <>{children}</>;

  if (fallback) return <>{fallback}</>;

  return (
    <section className="panel full-span access-denied-panel">
      <LockKeyhole size={26} />
      <div>
        <span className="eyebrow">Access blocked</span>
        <h2>{MODULE_LABELS[module]} access is required</h2>
        <p className="subtle-text">
          Ask an access admin to update your role template or module permissions.
        </p>
      </div>
    </section>
  );
}
