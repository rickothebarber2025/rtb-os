import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Camera, CheckCircle2, ExternalLink, MonitorCog, Play, RefreshCw, Server, ShieldCheck, Video, Wifi, XCircle } from 'lucide-react';
import { isOwnerProfile } from '../lib/permissions.js';

const ENDPOINT_KEY = 'rtb-ada-control-endpoint';
const TOKEN_KEY = 'rtb-ada-control-token';
const WORKBENCH_URL_KEY = 'rtb-neural-workbench-url';
const VENUE_FEED_URL_KEY = 'rtb-venue-feed-url';
const VENUE_FEED_NAME_KEY = 'rtb-venue-feed-name';
const DEFAULT_WORKBENCH_URL = 'http://127.0.0.1:3000';
const DEFAULT_VENUE_FEED_NAME = 'RTB Venue Camera';

function normalizeEndpoint(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function normalizeWorkbenchUrl(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return DEFAULT_WORKBENCH_URL;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `http://${raw}`;
}

function normalizeVenueFeedUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  return `http://${raw}`;
}

function StatusPill({ ok, children }) {
  return <span className={`ada-control-pill ${ok ? 'is-ok' : 'is-bad'}`}>{ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}{children}</span>;
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
  const [endpoint, setEndpoint] = useState(() => normalizeEndpoint(window.localStorage.getItem(ENDPOINT_KEY) || ''));
  const [token, setToken] = useState(() => window.localStorage.getItem(TOKEN_KEY) || '');
  const [workbenchUrl, setWorkbenchUrl] = useState(() => normalizeWorkbenchUrl(window.localStorage.getItem(WORKBENCH_URL_KEY) || import.meta.env.VITE_NEURAL_WORKBENCH_URL || DEFAULT_WORKBENCH_URL));
  const [venueFeedUrl, setVenueFeedUrl] = useState(() => normalizeVenueFeedUrl(window.localStorage.getItem(VENUE_FEED_URL_KEY) || import.meta.env.VITE_VENUE_FEED_URL || ''));
  const [venueFeedName, setVenueFeedName] = useState(() => window.localStorage.getItem(VENUE_FEED_NAME_KEY) || DEFAULT_VENUE_FEED_NAME);
  const [venueFeedLoaded, setVenueFeedLoaded] = useState(false);
  const [health, setHealth] = useState(null);
  const [status, setStatus] = useState(null);
  const [capabilities, setCapabilities] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [lastResult, setLastResult] = useState(null);

  const baseUrl = useMemo(() => normalizeEndpoint(endpoint), [endpoint]);
  const workbenchOrigin = useMemo(() => {
    try { return new URL(workbenchUrl).origin; } catch { return '*'; }
  }, [workbenchUrl]);
  const venueFeedIsHls = /\.m3u8(?:$|\?)/i.test(venueFeedUrl);

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

  const sendSnapshotToWorkbench = useCallback(() => {
    const frame = workbenchFrameRef.current;
    if (!frame?.contentWindow) return;
    frame.contentWindow.postMessage(rtbSnapshot, workbenchOrigin);
  }, [rtbSnapshot, workbenchOrigin]);

  useEffect(() => {
    sendSnapshotToWorkbench();
  }, [sendSnapshotToWorkbench]);

  useEffect(() => {
    function handleWorkbenchMessage(event) {
      if (workbenchOrigin !== '*' && event.origin !== workbenchOrigin) return;
      if (event.data?.type === 'RTB_WORKBENCH_READY') sendSnapshotToWorkbench();
    }
    window.addEventListener('message', handleWorkbenchMessage);
    return () => window.removeEventListener('message', handleWorkbenchMessage);
  }, [sendSnapshotToWorkbench, workbenchOrigin]);

  const request = useCallback(async (path, options = {}) => {
    if (!baseUrl) throw new Error('Set the Ada Tailscale endpoint first.');
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `A.R.V.I.S. control request failed (${response.status}).`);
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
      setError(err.message || 'Could not reach A.R.V.I.S.');
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

  function saveWorkbenchConnection() {
    const normalized = normalizeWorkbenchUrl(workbenchUrl);
    window.localStorage.setItem(WORKBENCH_URL_KEY, normalized);
    setWorkbenchUrl(normalized);
  }

  function saveVenueFeed() {
    const normalized = normalizeVenueFeedUrl(venueFeedUrl);
    if (normalized) window.localStorage.setItem(VENUE_FEED_URL_KEY, normalized);
    else window.localStorage.removeItem(VENUE_FEED_URL_KEY);
    window.localStorage.setItem(VENUE_FEED_NAME_KEY, venueFeedName.trim() || DEFAULT_VENUE_FEED_NAME);
    setVenueFeedUrl(normalized);
    setVenueFeedName(venueFeedName.trim() || DEFAULT_VENUE_FEED_NAME);
    setVenueFeedLoaded(false);
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
    return <section className="panel full-span"><div className="alert danger">A.R.V.I.S. operational controls are owner-only.</div></section>;
  }

  const workbenchOnline = Boolean(status?.neural_workbench?.running);
  const actions = [
    { command: 'neural_workbench_status', label: 'Check Neural Workbench', detail: 'Verify the local Neural Workbench server and health endpoint.' },
    { command: 'neural_workbench_start', label: 'Start Neural Workbench', detail: 'Start the approved local Neural Workbench project if it is offline.' },
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
          <h1>A.R.V.I.S. Control</h1>
          <p>One control room for the Mac-side Ada bridge, Neural Operations Workbench, and private venue monitoring. RTB OS remains the business source of truth.</p>
        </div>
        <StatusPill ok={Boolean(health?.ok)}>{health?.ok ? 'Mac bridge online' : 'Bridge offline'}</StatusPill>
      </section>

      <section className="panel full-span">
        <div className="section-header">
          <div><span>Venue monitoring</span><h2>Live venue feed</h2></div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <StatusPill ok={venueFeedLoaded}>{venueFeedLoaded ? 'Feed live' : venueFeedUrl ? 'Feed configured' : 'Not configured'}</StatusPill>
            {venueFeedUrl ? <a className="ghost-button" href={venueFeedUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Open feed</a> : null}
          </div>
        </div>
        <div className="ada-control-connection">
          <label className="field"><span>Camera name</span><input value={venueFeedName} onChange={(e) => setVenueFeedName(e.target.value)} placeholder="RTB Lounge camera" /></label>
          <label className="field wide"><span>Private HLS / WebRTC / bridge URL</span><input value={venueFeedUrl} onChange={(e) => setVenueFeedUrl(e.target.value)} placeholder="http://127.0.0.1:8888/..." /></label>
          <button className="primary-button" type="button" onClick={saveVenueFeed}>Save camera</button>
        </div>
        <div className="alert warning" style={{ marginTop: 12 }}><strong>Private feed only.</strong><span>Use a local or Tailscale-protected Wyze bridge URL. Do not paste your Wyze account password or API secret into this field.</span></div>
        <div style={{ marginTop: 16, border: '1px solid var(--border-color, rgba(255,255,255,.08))', borderRadius: 16, overflow: 'hidden', background: '#050505', minHeight: 320 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border-color, rgba(255,255,255,.08))' }}>
            <Camera size={17} />
            <strong>{venueFeedName || DEFAULT_VENUE_FEED_NAME}</strong>
            <span className="muted" style={{ marginLeft: 'auto' }}>{venueFeedUrl ? 'Owner-only live view' : 'Add the camera bridge URL above'}</span>
          </div>
          {venueFeedUrl ? (
            venueFeedIsHls ? (
              <video src={venueFeedUrl} controls autoPlay muted playsInline onLoadedData={() => setVenueFeedLoaded(true)} onError={() => setVenueFeedLoaded(false)} style={{ width: '100%', minHeight: 320, maxHeight: '70vh', display: 'block', background: '#000' }} />
            ) : (
              <iframe title={`${venueFeedName} live feed`} src={venueFeedUrl} allow="autoplay; fullscreen; picture-in-picture" onLoad={() => setVenueFeedLoaded(true)} style={{ width: '100%', minHeight: '60vh', border: 0, display: 'block', background: '#000' }} />
            )
          ) : (
            <div style={{ minHeight: 320, display: 'grid', placeItems: 'center', textAlign: 'center', padding: 24 }}><div><Video size={34} /><p className="muted">Wyze venue feed is ready to connect.</p></div></div>
          )}
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
          <label className="field wide"><span>Workbench URL</span><input value={workbenchUrl} onChange={(e) => setWorkbenchUrl(e.target.value)} placeholder={DEFAULT_WORKBENCH_URL} /></label>
          <button className="primary-button" type="button" onClick={saveWorkbenchConnection}>Save workbench</button>
          <button className="secondary-button" type="button" disabled={!capabilities.includes('neural_workbench_start') || Boolean(busy) || workbenchOnline} onClick={() => runCommand('neural_workbench_start')}>
            <Play size={15} /> {workbenchOnline ? 'Running' : busy === 'neural_workbench_start' ? 'Starting…' : 'Start'}
          </button>
        </div>
        <div className="alert success" style={{ marginTop: 12 }}><strong>RTB OS live bridge enabled.</strong><span>Staff, business, Square, payroll and performance snapshots are pushed into the embedded Workbench without giving it separate Supabase credentials.</span></div>
        <div style={{ marginTop: 16, border: '1px solid var(--border-color, rgba(255,255,255,.08))', borderRadius: 16, overflow: 'hidden', background: '#050505' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border-color, rgba(255,255,255,.08))' }}>
            <MonitorCog size={17} />
            <strong>Neural Workbench</strong>
            <span className="muted" style={{ marginLeft: 'auto' }}>{workbenchUrl}</span>
          </div>
          <iframe ref={workbenchFrameRef} onLoad={sendSnapshotToWorkbench} title="RTB Neural Workbench" src={workbenchUrl} style={{ width: '100%', minHeight: '68vh', border: 0, display: 'block', background: '#050505' }} />
        </div>
      </section>

      <section className="panel full-span">
        <div className="section-header">
          <div><span>Device bridge</span><h2>Tailscale endpoint</h2></div>
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
        <div className="section-header"><div><span>Live status</span><h2>What A.R.V.I.S. can actually control</h2></div></div>
        <div className="ada-control-status-grid">
          <article><Camera size={20} /><strong>Venue camera</strong><span>{venueFeedLoaded ? 'Live' : venueFeedUrl ? 'Configured' : 'Not configured'}</span></article>
          <article><MonitorCog size={20} /><strong>Neural Workbench</strong><span>{workbenchOnline ? 'Running' : status?.neural_workbench?.directory_exists ? 'Ready to start' : 'Project not found'}</span></article>
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
