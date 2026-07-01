import { LogOut, RefreshCw, ShieldAlert } from 'lucide-react';
import { getProfileRoleTitle } from '../lib/permissions.js';

export default function AccessPendingPage({ error, profile, refreshProfile, signOut }) {
  const roleLabel = profile ? getProfileRoleTitle(profile) : 'Pending';

  return (
    <div className="auth-page">
      <div className="access-gate">
        <div className="brand-mark large">
          <ShieldAlert size={30} />
        </div>
        <div>
          <span className="eyebrow">RTB OS Access</span>
          <h1>{error ? 'Access check failed' : 'Waiting for admin approval'}</h1>
          <p>
            {error ||
              `This login is saved as ${roleLabel}. An access admin needs to activate it and assign module permissions before the dashboard opens.`}
          </p>
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
