import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  CircleAlert,
  KeyRound,
  Link2,
  Plug,
  RefreshCw,
  Search,
  ShieldCheck,
  Unplug,
} from 'lucide-react';
import StatusBadge from '../components/StatusBadge';
import {
  INTEGRATION_CATEGORIES,
  INTEGRATION_PROVIDERS,
} from '../config/integrationProviders';
import {
  beginAccountLogin,
  beginIntegrationConnection,
  disconnectIntegration,
  finalizeAccountLogin,
  listIntegrationConnections,
  saveIntegrationSetup,
  testIntegrationConnection,
} from '../services/integrationService';

function statusTone(status) {
  if (status === 'connected' || status === 'configured') return 'success';
  if (status === 'reauthorize' || status === 'error') return 'danger';
  if (status === 'setup_ready' || status === 'setup_required') return 'warning';
  return 'neutral';
}

function statusLabel(status) {
  if (status === 'connected') return 'Connected';
  if (status === 'configured') return 'Configured';
  if (status === 'setup_ready') return 'Ready to sign in';
  if (status === 'reauthorize') return 'Reconnect';
  if (status === 'error') return 'Needs attention';
  if (status === 'setup_required') return 'Server setup needed';
  return 'Not connected';
}

function connectionKey(provider, businessUnitId) {
  return `${provider}:${businessUnitId || 'global'}`;
}

const EMPTY_SETUP = { api_key: '' };
const ACCOUNT_LOGIN_PROVIDERS = new Set(['google', 'google_business']);

export default function IntegrationsPage({ businessUnit, isAllBusinessesView }) {
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyProvider, setBusyProvider] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [category, setCategory] = useState('All');
  const [query, setQuery] = useState('');
  const [setupProvider, setSetupProvider] = useState(null);
  const [setupForm, setSetupForm] = useState(EMPTY_SETUP);

  const businessUnitId = isAllBusinessesView ? null : businessUnit?.id || null;

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      setConnections(await listIntegrationConnections());
    } catch (err) {
      setError(err.message || 'Could not load integrations. Try Refresh status.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const provider = params.get('integration_return');
    if (!provider || !ACCOUNT_LOGIN_PROVIDERS.has(provider)) return;

    const returnedBusinessUnitId = params.get('integration_business') || null;
    let cancelled = false;

    async function finish() {
      setBusyProvider(provider);
      setError('');
      try {
        const result = await finalizeAccountLogin(provider, returnedBusinessUnitId);
        if (!cancelled) {
          setNotice(result?.message || 'Account connected to RTB OS.');
          await refresh();
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'The account sign-in finished, but RTB OS could not save the connection.');
      } finally {
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete('integration_return');
        cleanUrl.searchParams.delete('integration_business');
        window.history.replaceState({}, '', cleanUrl.toString());
        if (!cancelled) setBusyProvider('');
      }
    }

    finish();
    return () => { cancelled = true; };
  }, []);

  const byKey = useMemo(() => {
    const map = new Map();
    connections.forEach((item) => {
      map.set(connectionKey(item.provider, item.business_unit_id), item);
      if (!item.business_unit_id) map.set(connectionKey(item.provider, null), item);
    });
    return map;
  }, [connections]);

  const visibleProviders = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return INTEGRATION_PROVIDERS.filter((provider) => {
      if (category !== 'All' && provider.category !== category) return false;
      if (!normalizedQuery) return true;
      return [provider.name, provider.description, provider.category, ...provider.capabilities]
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [category, query]);

  const connectedCount = connections.filter((item) => ['connected', 'configured'].includes(item.status)).length;
  const attentionCount = connections.filter((item) => ['error', 'reauthorize'].includes(item.status)).length;

  function openApiKeySetup(provider) {
    setSetupProvider(provider);
    setSetupForm(EMPTY_SETUP);
    setNotice('');
    setError('');
  }

  async function handleConnect(provider) {
    if (provider.authType === 'manual') {
      setNotice(`${provider.name} does not currently support direct account sign-in. RTB OS will use imports or a supported data feed when available.`);
      return;
    }

    if (provider.authType === 'system') {
      setNotice(`${provider.name} is managed automatically by RTB OS.`);
      return;
    }

    setBusyProvider(provider.id);
    setError('');
    setNotice('');
    try {
      if (ACCOUNT_LOGIN_PROVIDERS.has(provider.id)) {
        await beginAccountLogin(provider.id, businessUnitId);
        return;
      }

      const result = await beginIntegrationConnection(provider.id, businessUnitId);
      if (result.authorizationUrl) {
        window.location.assign(result.authorizationUrl);
        return;
      }
      if (result.mode === 'api_key' && result.setupRequired) {
        openApiKeySetup(provider);
        return;
      }
      if (result.setupRequired) {
        setNotice(result.message || `${provider.name} needs one-time server setup by RTB OS. You do not need to enter developer credentials.`);
        return;
      }
      setNotice(result.message || `${provider.name} is ready.`);
      await refresh();
    } catch (err) {
      setError(err.message || `Could not connect ${provider.name}. Try again.`);
    } finally {
      setBusyProvider('');
    }
  }

  async function handleSaveSetup(event) {
    event.preventDefault();
    if (!setupProvider) return;

    setBusyProvider(setupProvider.id);
    setError('');
    setNotice('');
    try {
      const result = await saveIntegrationSetup(setupProvider.id, businessUnitId, { api_key: setupForm.api_key });
      setNotice(result.message || `${setupProvider.name} credential saved securely.`);
      setSetupProvider(null);
      setSetupForm(EMPTY_SETUP);
      await refresh();
    } catch (err) {
      setError(err.message || `Could not save ${setupProvider.name} setup.`);
    } finally {
      setBusyProvider('');
    }
  }

  async function handleDisconnect(provider) {
    if (!window.confirm(`Disconnect ${provider.name} from RTB OS?`)) return;
    setBusyProvider(provider.id);
    setError('');
    try {
      await disconnectIntegration(provider.id, businessUnitId);
      setNotice(`${provider.name} disconnected.`);
      await refresh();
    } catch (err) {
      setError(err.message || `Could not disconnect ${provider.name}.`);
    } finally {
      setBusyProvider('');
    }
  }

  async function handleTest(provider) {
    setBusyProvider(provider.id);
    setError('');
    try {
      const result = await testIntegrationConnection(provider.id, businessUnitId);
      setNotice(result.message || `${provider.name} connection checked.`);
      await refresh();
    } catch (err) {
      setError(err.message || `${provider.name} connection check failed.`);
    } finally {
      setBusyProvider('');
    }
  }

  return (
    <div className="page-grid integrations-page">
      <section className="hero-panel full-span">
        <div>
          <h2>Connections & integrations</h2>
          <p>
            Connect your accounts with normal provider sign-in. RTB OS keeps developer credentials and technical setup out of your way.
          </p>
        </div>
        <button className="secondary-button" type="button" onClick={refresh} disabled={loading}>
          <RefreshCw size={16} />
          {loading ? 'Checking…' : 'Refresh status'}
        </button>
      </section>

      {error ? <div className="alert danger full-span">{error}</div> : null}
      {notice ? <div className="alert success full-span">{notice}</div> : null}

      {setupProvider ? (
        <section className="panel full-span">
          <div className="integration-card-header">
            <div className="integration-provider-icon"><ShieldCheck size={20} /></div>
            <div>
              <h3>Connect {setupProvider.name}</h3>
              <p className="subtle-text">This service uses an API credential instead of account sign-in. Enter it once; RTB OS encrypts it and does not show it again.</p>
            </div>
          </div>

          <form className="page-grid" onSubmit={handleSaveSetup}>
            <label className="full-span">
              <span>Credential / API key</span>
              <input
                type="password"
                autoComplete="off"
                value={setupForm.api_key}
                onChange={(event) => setSetupForm({ api_key: event.target.value })}
                placeholder={`Paste your ${setupProvider.name} credential`}
                required
              />
            </label>
            <div className="action-row full-span">
              <button className="primary-button" type="submit" disabled={busyProvider === setupProvider.id}>
                {busyProvider === setupProvider.id ? 'Saving…' : 'Save securely'}
              </button>
              <button className="ghost-button" type="button" disabled={busyProvider === setupProvider.id} onClick={() => setSetupProvider(null)}>
                Cancel
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="metrics-grid full-span integrations-metrics">
        <div className="panel integration-metric-card">
          <CheckCircle2 size={20} />
          <div><strong>{connectedCount}</strong><span>Ready</span></div>
        </div>
        <div className="panel integration-metric-card">
          <CircleAlert size={20} />
          <div><strong>{attentionCount}</strong><span>Need attention</span></div>
        </div>
        <div className="panel integration-metric-card">
          <ShieldCheck size={20} />
          <div><strong>Protected</strong><span>Server-side credentials</span></div>
        </div>
      </section>

      <section className="panel full-span integrations-toolbar">
        <label className="integration-search">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search integrations" />
        </label>
        <div className="integration-category-row">
          {INTEGRATION_CATEGORIES.map((item) => (
            <button className={category === item ? 'secondary-button small' : 'ghost-button small'} key={item} type="button" onClick={() => setCategory(item)}>
              {item}
            </button>
          ))}
        </div>
      </section>

      <section className="integration-grid full-span">
        {visibleProviders.map((provider) => {
          const connection = byKey.get(connectionKey(provider.id, businessUnitId)) || byKey.get(connectionKey(provider.id, null));
          const status = connection?.status || (provider.id === 'supabase' ? 'connected' : 'disconnected');
          const busy = busyProvider === provider.id;
          const AuthIcon = provider.authType === 'api_key' ? KeyRound : provider.authType === 'manual' ? Plug : Link2;
          const ready = ['connected', 'configured', 'setup_ready'].includes(status);

          return (
            <article className="panel integration-card" key={provider.id}>
              <div className="integration-card-header">
                <div className="integration-provider-icon"><AuthIcon size={20} /></div>
                <div>
                  <div className="integration-title-row">
                    <h3>{provider.name}</h3>
                    {provider.recommended ? <span className="integration-recommended">Recommended</span> : null}
                  </div>
                  <span className="subtle-text">
                    {provider.category} · {provider.authType === 'oauth' ? 'Sign in to connect' : provider.authType === 'api_key' ? 'Enter once' : provider.authType.replace('_', ' ')}
                  </span>
                </div>
                <StatusBadge tone={statusTone(status)}>{statusLabel(status)}</StatusBadge>
              </div>

              <p>{provider.description}</p>

              <div className="integration-capabilities">
                {provider.capabilities.map((item) => <span key={item}>{item}</span>)}
              </div>

              {connection?.account_name ? <p className="subtle-text">Connected account: {connection.account_name}</p> : null}
              {connection?.last_error ? <div className="alert warning">{connection.last_error}</div> : null}

              <div className="action-row integration-actions">
                {ready && provider.id !== 'supabase' ? (
                  <>
                    <button className="ghost-button small" type="button" disabled={busy} onClick={() => handleTest(provider)}>
                      <RefreshCw size={14} /> Check
                    </button>
                    {status === 'setup_ready' ? (
                      <button className="primary-button small" type="button" disabled={busy} onClick={() => handleConnect(provider)}>
                        <Link2 size={14} /> Sign in
                      </button>
                    ) : null}
                    <button className="ghost-button small danger" type="button" disabled={busy} onClick={() => handleDisconnect(provider)}>
                      <Unplug size={14} /> Disconnect
                    </button>
                  </>
                ) : (
                  <button className="primary-button small" type="button" disabled={busy || provider.id === 'supabase'} onClick={() => handleConnect(provider)}>
                    <Link2 size={14} />
                    {busy ? 'Connecting…' : status === 'reauthorize' ? 'Reconnect' : provider.authType === 'api_key' ? 'Set up' : 'Sign in'}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}
