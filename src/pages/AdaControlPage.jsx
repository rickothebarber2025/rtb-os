import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, CheckCircle2, Play, RefreshCw, Server, ShieldCheck, Wifi, XCircle } from 'lucide-react';
import { isOwnerProfile } from '../lib/permissions.js';

const ENDPOINT_KEY = 'rtb-ada-control-endpoint';
const TOKEN_KEY = 'rtb-ada-control-token';

function normalizeEndpoint(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function StatusPill({ ok, children }) {
  return <span className={`ada-control-pill ${ok ? 'is-ok' : 'is-bad'}`}>{ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}{children}</span>;
}

export default function AdaControlPage({ accessProfile }) {
  const owner = isOwnerProfile(accessProfile);
  const [endpoint, setEndpoint] = useState(() => normalizeEndpoint(window.localStorage.getItem(ENDPOINT_KEY) || ''));
  const [token, setToken] = useState(() => window.localStorage.getItem(TOKEN_KEY) || '');
  const [health, setHealth] = useState(null);
  const [status, setStatus] = useState(null);
  const [capabilities, setCapabilities] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [lastResult, setLastResult] = useState(null);

  const baseUrl = useMemo(() => normalizeEndpoint(endpoint), [endpoint]);

  const request = useCallback(async (path, options = {}) => {
    if (!baseUrl) throw new Error('Set the Ada Tailscale endpoint first.');
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Ada control request failed (${response.status}).`);
    return payload;
  }, [baseUrl, token]);

  const refresh = useCallback(async () => {
    if (!owner || !baseUrl) return;
    setBusy('refresh');
    setError('');
    try {
      const [healthPayload, statusPayload, capabilitiesPayload] = await Promise.all([
        request('/api/health'),
        request('/api/control/status'),
        request('/api/control/capabilities'),
      ]);
      setHealth(healthPayload);
      setStatus(statusPayload);
      setCapabilities(Array.isArray(capabilitiesPayload.capabilities) ? capabilitiesPayload.capabilities : []);
    } catch (err) {
      setError(err.message || 'Could not reach Ada.');
      setHealth(null);
      setStatus(null);
      setCapabilities([]);
    } finally {
      setBusy('');
    }
  }, [baseUrl, owner, request]);

  useEffect(() => { refresh(); }, [refresh]);

  function saveConnection() {
    const normalized = normalizeEndpoint(endpoint);
    window.localStorage.setItem(ENDPOINT_KEY, normalized);
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
    setEndpoint(normalized);
    setTimeout(refresh, 0);
  }

  async function runCommand(command) {
    setBusy(command);
    setError('');
    try {
      const result = await request('/api/control/commands', {
        method: 'POST',
        body: JSON.stringify({ command }),
      });
      setLastResult(result);
      await refresh();
    } catch (err) {
      setError(err.message || 'Command failed.');
    } finally {
      setBusy('');
    }
  }

  if (!owner) {
    return <section className="panel full-span"><div className="alert danger">Ada operational controls are owner-only.</div></section>;
  }

  const actions = [
    { command: 'ada_sync_run', label: 'Sync Ada now', detail: 'Run the Ada actionable-message sync immediately.' },
    { command: 'ada_sync_restart', label: 'Restart Ada sync', detail: 'Restart the Mac launch agent that keeps Ada sync running.' },
    { command: 'messages_archive_check', label: 'Check Messages feed', detail: 'Verify Ada can read the local staff-message archive.' },
    { command: 'tailscale_status', label: 'Check Tailscale', detail: 'Refresh the Mac tailnet connection and Serve status.' },
  ];

  return (
    <div className="ada-control-page">
      <section className="panel full-span ada-control-hero">
        <div>
          <span className="eyebrow">Owner control plane</span>
          <h1>Ada Control</h1>
          <p>Operate the Mac-side Ada bridge over your private Tailscale connection. No generic remote shell is exposed.</p>
        </div>
        <StatusPill ok={Boolean(health?.ok)}>{health?.ok ? 'Mac bridge online' : 'Bridge offline'}</StatusPill>
      </section>

      <section className="panel full-span">
        <div className="section-header">
          <div><span>Connection</span><h2>Tailscale endpoint</h2></div>
          <button className="ghost-button" type="button" disabled={busy === 'refresh'} onClick={refresh}><RefreshCw size={16} /> Refresh</button>
        </div>
        <div className="ada-control-connection">
          <label className="field wide"><span>Private HTTPS URL</span><input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://your-mac.your-tailnet.ts.net" /></label>
          <label className="field wide"><span>Control token</span><input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Stored only on this device" /></label>
          <button className="primary-button" type="button" onClick={saveConnection}>Save & connect</button>
        </div>
        {error ? <div className="alert danger">{error}</div> : null}
      </section>

      <section className="panel full-span">
        <div className="section-header"><div><span>Live status</span><h2>What Ada can actually control</h2></div></div>
        <div className="ada-control-status-grid">
          <article><Server size={20} /><strong>Local Ada</strong><span>{status?.ada_archive?.ok ? 'Reachable' : 'Unavailable'}</span></article>
          <article><Wifi size={20} /><strong>Tailscale</strong><span>{status?.tailscale?.online ? 'Connected' : 'Unknown / offline'}</span></article>
          <article><Activity size={20} /><strong>Ada sync</strong><span>{status?.ada_sync?.loaded ? 'Loaded' : 'Not loaded'}</span></article>
          <article><ShieldCheck size={20} /><strong>Control API</strong><span>{health?.ok ? 'Authenticated' : 'Unavailable'}</span></article>
        </div>
      </section>

      <section className="panel full-span">
        <div className="section-header"><div><span>Commands</span><h2>Run approved actions</h2></div></div>
        <div className="ada-control-actions">
          {actions.map((action) => {
            const supported = capabilities.includes(action.command);
            return (
              <article className="ada-control-action" key={action.command}>
                <div><strong>{action.label}</strong><p>{action.detail}</p></div>
                <button className="secondary-button" type="button" disabled={!supported || Boolean(busy)} onClick={() => runCommand(action.command)}>
                  <Play size={15} /> {busy === action.command ? 'Running…' : supported ? 'Run' : 'Unavailable'}
                </button>
              </article>
            );
          })}
        </div>
        {lastResult ? <pre className="ada-control-result">{JSON.stringify(lastResult, null, 2)}</pre> : null}
      </section>
    </div>
  );
}
