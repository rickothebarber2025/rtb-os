import { LogOut, RefreshCw, ShieldAlert } from 'lucide-react';
import { getProfileRoleTitle, hasAnyModulePermission } from '../lib/permissions.js';

export default function AccessPendingPage({ error, profile, refreshProfile, signOut }) {
  const roleLabel = profile ? getProfileRoleTitle(profile) : 'Pending';
  const active = Boolean(profile?.active);
  const hasAssignedAccess = profile ? hasAnyModulePermission(profile) : false;
  const statusMessage = (() => {
    if (error) return error;
    if (!profile) {
      return 'Your login was created, but RTB OS could not find an access profile yet. Ask Ricko or an access admin to resend the invite.';
    }
    if (!active) {
      return `This login is saved as ${roleLabel}, but it is not active yet. Ask Ricko or an access admin to activate the login.`;
    }
    if (!hasAssignedAccess) {
      return `This login is active as ${roleLabel}, but no role template or module access is assigned yet. Ask Ricko or an access admin to choose Staff Portal or another role template.`;
    }
    return `This login is saved as ${roleLabel}. Ask Ricko or an access admin to review the assigned role template.`;
  })();
  const title = error
    ? 'Access check failed'
    : !profile
      ? 'Access profile missing'
      : !active
      ? 'Login not active yet'
      : !hasAssignedAccess
        ? 'Role access not assigned'
        : 'Access setup needed';

  return (
    <div className="auth-page">
      <div className="access-gate">
        <div className="brand-mark large">
          <ShieldAlert size={30} />
        </div>
        <div>
          <span className="eyebrow">RTB OS Access</span>
          <h1>{title}</h1>
          <p>{statusMessage}</p>
        </div>
        <div className="action-row">
          <button className="secondary-button" type="button" onClick={refreshProfile}>
            <RefreshCw size={17} />
            Check again
          </button>
          <button className="ghost-button" type="button" onClick={signOut}>
            <LogOut size={17} />
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
