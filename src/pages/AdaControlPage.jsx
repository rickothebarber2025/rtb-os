import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, CheckCircle2, HardDrive, Play, RefreshCw, Server, ShieldCheck, Wifi, XCircle } from 'lucide-react';
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

function formatPercent(value) {
  return Number.isFinite(Number(value)) ? `${Number(value).toFixed(0)}%` : 'Unknown';
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
      setLastResult({ command, ...result });
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
    { command: 'run_diagnostics', label: 'Run full diagnostics', detail: 'Check the Mac, Ada archive, sync service, and Tailscale in one tap.' },
    { command: 'ada_sync_restart', label: 'Restart Ada sync', detail: 'Restart the service that keeps Ada data moving into RTB OS.' },
    { command: 'ada_sync_run', label: 'Sync now', detail: 'Pull the latest actionable Ada items into RTB OS immediately.' },
    { command: 'system_status', label: 'Check Mac health', detail: 'Refresh storage and memory usage without opening the Mac.' },
    { command: 'messages_archive_check', label: 'Check staff-message feed', detail: 'Verify the local message archive is reachable.' },
    { command: 'tailscale_status', label: 'Check private connection', detail: 'Verify the Mac is online on Tailscale and Serve is available.' },
  ];

  const systemOk = Boolean(status?.system?.ok);
  const diskUsed = status?.system?.disk_used_percent;
  const memoryUsed = status?.system?.memory_used_percent;

  return (
    <div className="ada-control-page">
      <section className="panel full-span ada-control-hero">
        <div>
          <span className="eyebrow">Owner command center</span>
          <h1>Ada Control</h1>
          <p>One-tap controls for the Mac-side Ada services. Tailscale is only the secure connection underneath.</p>
        </div>
        <StatusPill ok={Boolean(health?.ok)}>{health?.ok ? 'Mac bridge online' : 'Bridge offline'}</StatusPill>
      </section>

      <section className="panel full-span">
        <div className="section-header">
          <div><span>Live health</span><h2>Mac + Ada</h2></div>
          <button className="ghost-button" type="button" disabled={busy === 'refresh'} onClick={refresh}><RefreshCw size={16} /> {busy === 'refresh' ? 'Refreshing…' : 'Refresh'}</button>
        </div>
        <div className="ada-control-status-grid">
          <article><Server size={20} /><strong>Ada bridge</strong><span>{health?.ok ? 'Online' : 'Offline'}</span></article>
          <article><Activity size={20} /><strong>Ada sync</strong><span>{status?.ada_sync?.loaded ? 'Running' : 'Needs attention'}</span></article>
          <article><Wifi size={20} /><strong>Private connection</strong><span>{status?.tailscale?.online ? 'Connected' : 'Offline / unknown'}</span></article>
          <article><HardDrive size={20} /><strong>Storage</strong><span>{systemOk ? `${formatPercent(diskUsed)} used` : 'Unknown'}</span></article>
          <article><Activity size={20} /><strong>Memory</strong><span>{systemOk ? `${formatPercent(memoryUsed)} used` : 'Unknown'}</span></article>
          <article><ShieldCheck size={20} /><strong>Staff-message feed</strong><span>{status?.ada_archive?.ok ? 'Reachable' : 'Unavailable'}</span></article>
        </div>
        {error ? <div className="alert danger">{error}</div> : null}
      </section>

      <section className="panel full-span">
        <div className="section-header"><div><span>Actions</span><h2>Fix or verify from your phone</h2></div></div>
        <div className="ada-control-actions">
          {actions.map((action) => {
            const supported = capabilities.includes(action.command);
            const running = busy === action.command;
            return (
              <article className="ada-control-action" key={action.command}>
                <div><strong>{action.label}</strong><p>{action.detail}</p></div>
                <button className="secondary-button" type="button" disabled={!supported || Boolean(busy)} onClick={() => runCommand(action.command)}>
                  <Play size={15} /> {running ? 'Running…' : supported ? 'Run' : 'Unavailable'}
                </button>
              </article>
            );
          })}
        </div>
        {lastResult ? (
          <div className={`alert ${lastResult.ok ? 'success' : 'danger'}`}>
            <strong>{lastResult.ok ? 'Action completed' : 'Action needs attention'}</strong>
            <span>{lastResult.command.replaceAll('_', ' ')}</span>
          </div>
        ) : null}
      </section>

      <section className="panel full-span">
        <div className="section-header"><div><span>Connection setup</span><h2>Tailscale bridge</h2></div></div>
        <p className="muted">This should normally stay configured. You only need this section if the Mac bridge address or token changes.</p>
        <div className="ada-control-connection">
          <label className="field wide"><span>Private HTTPS URL</span><input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://your-mac.your-tailnet.ts.net" /></label>
          <label className="field wide"><span>Control token</span><input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Stored only on this device" /></label>
          <button className="primary-button" type="button" onClick={saveConnection}>Save & connect</button>
        </div>
      </section>
    </div>
  );
}
