import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, CheckCircle2, ExternalLink, Play, RefreshCw, Server, Wifi, XCircle } from 'lucide-react';
import { isOwnerProfile } from '../lib/permissions.js';

const ENDPOINT_KEY = 'rtb-ada-control-endpoint';
const TOKEN_KEY = 'rtb-ada-control-token';
const WORKBENCH_URL_KEY = 'rtb-neural-workbench-url';
const DEFAULT_ENDPOINT = 'http://127.0.0.1:8791';
const DEFAULT_WORKBENCH_URL = 'http://127.0.0.1:3000';

function normalizeUrl(value, fallback) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return fallback;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `http://${raw}`;
}

function StatusPill({ ok, children }) {
  return (
    <span className={`ada-control-pill ${ok ? 'is-ok' : 'is-bad'}`}>
      {ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
      {children}
    </span>
  );
}

export default function AdaControlPage({
  accessProfile,
  businessUnit,
  businessUnits,
  masterDashboard,
  monthlyPerformanceSummary,
  payrollRuns,
  performanceSummary,
  squareStatus,
  staff,
  staffActivityReviewSummary,
  staffPortalSummary,
  warnings,
}) {
  const owner = isOwnerProfile(accessProfile);
  const workbenchFrameRef = useRef(null);
  const [endpoint, setEndpoint] = useState(() => normalizeUrl(window.localStorage.getItem(ENDPOINT_KEY), DEFAULT_ENDPOINT));
  const [token, setToken] = useState(() => window.localStorage.getItem(TOKEN_KEY) || '');
  const [workbenchUrl, setWorkbenchUrl] = useState(() => normalizeUrl(window.localStorage.getItem(WORKBENCH_URL_KEY), DEFAULT_WORKBENCH_URL));
  const [health, setHealth] = useState(null);
  const [status, setStatus] = useState(null);
  const [capabilities, setCapabilities] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [lastResult, setLastResult] = useState(null);

  const baseUrl = useMemo(() => normalizeUrl(endpoint, DEFAULT_ENDPOINT), [endpoint]);
  const workbenchOrigin = useMemo(() => {
    try { return new URL(workbenchUrl).origin; } catch { return '*'; }
  }, [workbenchUrl]);

  const rtbSnapshot = useMemo(() => ({
    type: 'RTB_OS_SNAPSHOT',
    version: 1,
    generatedAt: new Date().toISOString(),
    source: 'RTB_OS_SUPABASE',
    payload: {
      businessUnit: businessUnit || null,
      businessUnits: Array.isArray(businessUnits) ? businessUnits : [],
      masterDashboard: masterDashboard || null,
      monthlyPerformanceSummary: monthlyPerformanceSummary || null,
      payrollRuns: Array.isArray(payrollRuns) ? payrollRuns : [],
      performanceSummary: performanceSummary || null,
      squareStatus: squareStatus || null,
      staff: Array.isArray(staff) ? staff : [],
      staffActivityReviewSummary: staffActivityReviewSummary || null,
      staffPortalSummary: staffPortalSummary || null,
      warnings: Array.isArray(warnings) ? warnings : [],
    },
  }), [businessUnit, businessUnits, masterDashboard, monthlyPerformanceSummary, payrollRuns, performanceSummary, squareStatus, staff, staffActivityReviewSummary, staffPortalSummary, warnings]);

  const request = useCallback(async (path, options = {}) => {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `A.R.V.I.S. request failed (${response.status}).`);
    return payload;
  }, [baseUrl, token]);

  const refresh = useCallback(async () => {
    if (!owner) return;
    setBusy('refresh');
    setError('');
    try {
      const [healthPayload, statusPayload, capabilityPayload] = await Promise.all([
        request('/api/health'),
        request('/api/control/status'),
        request('/api/control/capabilities'),
      ]);
      setHealth(healthPayload);
      setStatus(statusPayload);
      setCapabilities(Array.isArray(capabilityPayload.capabilities) ? capabilityPayload.capabilities : []);
    } catch (err) {
      setHealth(null);
      setStatus(null);
      setCapabilities([]);
      setError(err?.message || 'Could not reach A.R.V.I.S. control bridge.');
    } finally {
      setBusy('');
    }
  }, [owner, request]);

  useEffect(() => { refresh(); }, [refresh]);

  const sendSnapshotToWorkbench = useCallback(() => {
    const frame = workbenchFrameRef.current;
    if (!frame?.contentWindow) return;
    frame.contentWindow.postMessage(rtbSnapshot, workbenchOrigin);
  }, [rtbSnapshot, workbenchOrigin]);

  useEffect(() => { sendSnapshotToWorkbench(); }, [sendSnapshotToWorkbench]);
  useEffect(() => {
    const listener = (event) => {
      if (workbenchOrigin !== '*' && event.origin !== workbenchOrigin) return;
      if (event.data?.type === 'RTB_WORKBENCH_READY') sendSnapshotToWorkbench();
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [sendSnapshotToWorkbench, workbenchOrigin]);

  function saveConnection() {
    const normalized = normalizeUrl(endpoint, DEFAULT_ENDPOINT);
    window.localStorage.setItem(ENDPOINT_KEY, normalized);
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
    setEndpoint(normalized);
    setTimeout(refresh, 0);
  }

  function saveWorkbench() {
    const normalized = normalizeUrl(workbenchUrl, DEFAULT_WORKBENCH_URL);
    window.localStorage.setItem(WORKBENCH_URL_KEY, normalized);
    setWorkbenchUrl(normalized);
  }

  async function runCommand(command, extra = {}) {
    if (!capabilities.includes(command)) {
      setError(`Capability not available: ${command}`);
      return;
    }
    setBusy(command);
    setError('');
    try {
      const result = await request('/api/control/commands', {
        method: 'POST',
        body: JSON.stringify({ command, ...extra }),
      });
      setLastResult(result);
      await refresh();
    } catch (err) {
      setError(err?.message || 'Command failed.');
    } finally {
      setBusy('');
    }
  }

  if (!owner) {
    return <section className="panel full-span"><div className="alert danger">A.R.V.I.S. controls are owner-only.</div></section>;
  }

  const actions = [
    ['run_diagnostics', 'Run diagnostics', 'Check Mac health, sync, Tailscale and Neural Workbench.'],
    ['ada_sync_run', 'Sync now', 'Pull the latest actionable Ada items into RTB OS.'],
    ['ada_sync_restart', 'Restart sync', 'Restart the background Ada sync service.'],
    ['messages_archive_check', 'Check staff-message feed', 'Verify the local message archive is reachable.'],
    ['tailscale_status', 'Check private connection', 'Verify the Mac is online on Tailscale.'],
    ['system_status', 'Check Mac health', 'Refresh storage and memory usage.'],
    ['neural_workbench_status', 'Check Workbench', 'Verify the Neural Workbench health endpoint.'],
    ['neural_workbench_start', 'Start Workbench', 'Start Neural Workbench if it is offline.'],
  ];

  const workbenchOnline = Boolean(status?.neural_workbench?.running);

  return (
    <div className="ada-control-page">
      <section className="panel full-span ada-control-hero">
        <div>
          <span className="eyebrow">Owner command center</span>
          <h1>A.R.V.I.S. Control</h1>
          <p>Control the Mac bridge, RTB sync services and Neural Workbench from one owner-only screen.</p>
        </div>
        <StatusPill ok={Boolean(health?.ok)}>{health?.ok ? 'Bridge online' : 'Bridge offline'}</StatusPill>
      </section>

      {error ? <section className="panel full-span"><div className="alert danger">{error}</div></section> : null}

      <section className="panel full-span">
        <div className="section-header">
          <div><span>Connection</span><h2>Local control bridge</h2></div>
          <button className="secondary-button" type="button" onClick={refresh} disabled={Boolean(busy)}><RefreshCw size={15} /> Refresh</button>
        </div>
        <div className="ada-control-connection">
          <label className="field wide"><span>Endpoint</span><input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder={DEFAULT_ENDPOINT} /></label>
          <label className="field wide"><span>Bearer token</span><input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="A.R.V.I.S. control token" /></label>
          <button className="primary-button" type="button" onClick={saveConnection}>Save & connect</button>
        </div>
      </section>

      <section className="panel full-span">
        <div className="section-header"><div><span>Actions</span><h2>Backend controls</h2></div><StatusPill ok={capabilities.length > 0}>{capabilities.length} capabilities</StatusPill></div>
        <div className="settings-card-grid">
          {actions.map(([command, label, detail]) => (
            <button key={command} type="button" className="settings-card" disabled={Boolean(busy) || !capabilities.includes(command)} onClick={() => runCommand(command)}>
              <div className="settings-card-icon"><Activity size={18} /></div>
              <div><strong>{label}</strong><p>{detail}</p></div>
              <Play size={16} />
            </button>
          ))}
        </div>
      </section>

      <section className="panel full-span">
        <div className="section-header">
          <div><span>Neural operations</span><h2>Workbench bridge</h2></div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <StatusPill ok={workbenchOnline}>{workbenchOnline ? 'Workbench online' : 'Workbench offline'}</StatusPill>
            <a className="ghost-button" href={workbenchUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Open separately</a>
          </div>
        </div>
        <div className="ada-control-connection">
          <label className="field wide"><span>Workbench URL</span><input value={workbenchUrl} onChange={(event) => setWorkbenchUrl(event.target.value)} placeholder={DEFAULT_WORKBENCH_URL} /></label>
          <button className="secondary-button" type="button" onClick={saveWorkbench}>Save workbench</button>
        </div>
        <div style={{ marginTop: 16, minHeight: 560, border: '1px solid var(--border-color, rgba(255,255,255,.08))', borderRadius: 16, overflow: 'hidden' }}>
          <iframe ref={workbenchFrameRef} title="Neural Workbench" src={workbenchUrl} onLoad={sendSnapshotToWorkbench} style={{ width: '100%', minHeight: 560, border: 0, display: 'block', background: '#020617' }} />
        </div>
      </section>

      <section className="panel full-span">
        <div className="section-header"><div><span>Status</span><h2>Control plane</h2></div><Server size={18} /></div>
        <div className="settings-card-grid">
          <div className="settings-card"><Wifi size={18} /><div><strong>Tailscale</strong><p>{status?.tailscale?.online ? 'Online' : 'Offline or unknown'}</p></div></div>
          <div className="settings-card"><Activity size={18} /><div><strong>Ada sync</strong><p>{status?.ada_sync?.loaded ? 'Loaded' : 'Not loaded'}</p></div></div>
          <div className="settings-card"><Server size={18} /><div><strong>Workbench</strong><p>{workbenchOnline ? 'Running' : 'Offline'}</p></div></div>
        </div>
        {lastResult ? <pre style={{ marginTop: 16, whiteSpace: 'pre-wrap', overflow: 'auto' }}>{JSON.stringify(lastResult, null, 2)}</pre> : null}
      </section>
    </div>
  );
}
