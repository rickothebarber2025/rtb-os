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
  beginIntegrationConnection,
  disconnectIntegration,
  listIntegrationConnections,
  testIntegrationConnection,
} from '../services/integrationService';

function statusTone(status) {
  if (status === 'connected') return 'success';
  if (status === 'reauthorize' || status === 'error') return 'danger';
  if (status === 'setup_required') return 'warning';
  return 'neutral';
}

function statusLabel(status) {
  if (status === 'connected') return 'Connected';
  if (status === 'reauthorize') return 'Reauthorize';
  if (status === 'error') return 'Error';
  if (status === 'setup_required') return 'Setup required';
  return 'Not connected';
}

function connectionKey(provider, businessUnitId) {
  return `${provider}:${businessUnitId || 'global'}`;
}

export default function IntegrationsPage({ businessUnit, isAllBusinessesView }) {
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyProvider, setBusyProvider] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [category, setCategory] = useState('All');
  const [query, setQuery] = useState('');

  const businessUnitId = isAllBusinessesView ? null : businessUnit?.id || null;

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      setConnections(await listIntegrationConnections());
    } catch (err) {
      setError(err.message || 'Could not load integrations.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
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

  const connectedCount = connections.filter((item) => item.status === 'connected').length;
  const attentionCount = connections.filter((item) => ['error', 'reauthorize'].includes(item.status)).length;

  async function handleConnect(provider) {
    if (provider.authType === 'manual') {
      setNotice(`${provider.name} does not expose a supported direct connection in Ricko OS yet. It will remain available for imports and future API access.`);
      return;
    }

    if (provider.authType === 'system') {
      setNotice(`${provider.name} is part of the Ricko OS infrastructure and is managed through system configuration.`);
      return;
    }

    setBusyProvider(provider.id);
    setError('');
    setNotice('');
    try {
      const result = await beginIntegrationConnection(provider.id, businessUnitId);
      if (result.authorizationUrl) {
        window.location.assign(result.authorizationUrl);
        return;
      }
      setNotice(result.message || `${provider.name} setup is ready for the next configuration step.`);
      await refresh();
    } catch (err) {
      setError(err.message || `Could not connect ${provider.name}.`);
    } finally {
      setBusyProvider('');
    }
  }

  async function handleDisconnect(provider) {
    if (!window.confirm(`Disconnect ${provider.name} from Ricko OS?`)) return;
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
            Connect the services Ricko OS can use for email, bookings, payments, documents,
            marketing, finance, staff operations, development and AI.
          </p>
        </div>
        <button className="secondary-button" type="button" onClick={refresh} disabled={loading}>
          <RefreshCw size={16} />
          Refresh status
        </button>
      </section>

      {error ? <div className="alert danger full-span">{error}</div> : null}
      {notice ? <div className="alert success full-span">{notice}</div> : null}

      <section className="metrics-grid full-span integrations-metrics">
        <div className="panel integration-metric-card">
          <CheckCircle2 size={20} />
          <div><strong>{connectedCount}</strong><span>Connected</span></div>
        </div>
        <div className="panel integration-metric-card">
          <CircleAlert size={20} />
          <div><strong>{attentionCount}</strong><span>Need attention</span></div>
        </div>
        <div className="panel integration-metric-card">
          <ShieldCheck size={20} />
          <div><strong>Server-side</strong><span>Credential handling</span></div>
        </div>
      </section>

      <section className="panel full-span integrations-toolbar">
        <label className="integration-search">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search integrations"
          />
        </label>
        <div className="integration-category-row">
          {INTEGRATION_CATEGORIES.map((item) => (
            <button
              className={category === item ? 'secondary-button small' : 'ghost-button small'}
              key={item}
              type="button"
              onClick={() => setCategory(item)}
            >
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

          return (
            <article className="panel integration-card" key={provider.id}>
              <div className="integration-card-header">
                <div className="integration-provider-icon"><AuthIcon size={20} /></div>
                <div>
                  <div className="integration-title-row">
                    <h3>{provider.name}</h3>
                    {provider.recommended ? <span className="integration-recommended">Recommended</span> : null}
                  </div>
                  <span className="subtle-text">{provider.category} · {provider.authType.replace('_', ' ')}</span>
                </div>
                <StatusBadge tone={statusTone(status)}>{statusLabel(status)}</StatusBadge>
              </div>

              <p>{provider.description}</p>

              <div className="integration-capabilities">
                {provider.capabilities.map((item) => <span key={item}>{item}</span>)}
              </div>

              {connection?.account_name ? (
                <p className="subtle-text">Connected account: {connection.account_name}</p>
              ) : null}
              {connection?.last_error ? (
                <div className="alert warning">{connection.last_error}</div>
              ) : null}

              <div className="action-row integration-actions">
                {status === 'connected' && provider.id !== 'supabase' ? (
                  <>
                    <button className="ghost-button small" type="button" disabled={busy} onClick={() => handleTest(provider)}>
                      <RefreshCw size={14} /> Test
                    </button>
                    <button className="ghost-button small danger" type="button" disabled={busy} onClick={() => handleDisconnect(provider)}>
                      <Unplug size={14} /> Disconnect
                    </button>
                  </>
                ) : (
                  <button
                    className="primary-button small"
                    type="button"
                    disabled={busy || provider.id === 'supabase'}
                    onClick={() => handleConnect(provider)}
                  >
                    <Link2 size={14} />
                    {status === 'reauthorize' ? 'Reconnect' : provider.authType === 'api_key' ? 'Configure' : 'Connect'}
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
