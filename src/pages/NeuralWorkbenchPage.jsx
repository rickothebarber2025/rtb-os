import { ExternalLink, MonitorCog } from 'lucide-react';

const DEFAULT_WORKBENCH_URL = 'http://127.0.0.1:3000';

function getWorkbenchUrl() {
  const configured = String(import.meta.env.VITE_NEURAL_WORKBENCH_URL || '').trim();
  return configured || DEFAULT_WORKBENCH_URL;
}

export default function NeuralWorkbenchPage() {
  const workbenchUrl = getWorkbenchUrl();

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Owner control room</p>
            <h1>Neural Workbench</h1>
            <p className="muted">Phase 1 bridge into the local RTB Neural Operations Workbench. RTB OS remains the source of truth while the desktop assistant and workbench are consolidated.</p>
          </div>
          <a className="secondary-button" href={workbenchUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={16} /> Open separately
          </a>
        </div>
      </section>

      <section className="panel full-span" style={{ padding: 0, overflow: 'hidden', minHeight: '72vh' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid var(--border-color, rgba(255,255,255,.08))' }}>
          <MonitorCog size={18} />
          <strong>Local workbench</strong>
          <span className="muted" style={{ marginLeft: 'auto' }}>{workbenchUrl}</span>
        </div>
        <iframe
          title="RTB Neural Workbench"
          src={workbenchUrl}
          style={{ width: '100%', minHeight: '72vh', border: 0, display: 'block', background: '#050505' }}
        />
      </section>
    </div>
  );
}
