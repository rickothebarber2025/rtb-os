import { ArrowRight, Gift, ShieldCheck, Sparkles } from 'lucide-react';
import { buildBehavioralCue, getBehavioralPrincipleLabel } from '../utils/behavioralUX.js';

const ICONS = {
  reciprocity: Gift,
  endowment: Sparkles,
  'loss-aversion': ShieldCheck,
  contrast: ArrowRight,
  commitment: ArrowRight,
};

export default function BehavioralMomentumBar({
  activePage,
  profile,
  setActivePage,
  setStaffHubTab,
  signals,
}) {
  const cue = buildBehavioralCue({ activePage, profile, signals });
  if (!cue) return null;

  const Icon = ICONS[cue.principle] || Sparkles;

  function handleAction() {
    if (cue.targetTab && typeof setStaffHubTab === 'function') setStaffHubTab(cue.targetTab);
    if (cue.targetPage && typeof setActivePage === 'function') setActivePage(cue.targetPage);
  }

  return (
    <section
      aria-label="Recommended next action"
      className={`behavioral-momentum behavioral-momentum--${cue.tone || 'value'}`}
    >
      <div className="behavioral-momentum__icon" aria-hidden="true">
        <Icon size={18} />
      </div>
      <div className="behavioral-momentum__copy">
        <div className="behavioral-momentum__meta">
          <span>{cue.eyebrow}</span>
          <small>{getBehavioralPrincipleLabel(cue.principle)}</small>
        </div>
        <strong>{cue.title}</strong>
        <p>{cue.description}</p>
      </div>
      {cue.actionLabel ? (
        <button className="behavioral-momentum__action" type="button" onClick={handleAction}>
          {cue.actionLabel}
          <ArrowRight aria-hidden="true" size={15} />
        </button>
      ) : null}
    </section>
  );
}
