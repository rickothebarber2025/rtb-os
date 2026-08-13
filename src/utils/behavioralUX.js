export function buildBehavioralCue({ activePage, profile, signals = {} }) {
  const roleTemplate = String(profile?.permissions?.role_template || '').toLowerCase();
  const urgent = Number(signals.urgentActionCount || 0);
  const drafts = Number(signals.draftPayrollCount || 0);
  const unfinished = Number(signals.unfinishedChecklistCount || 0);
  const unread = Number(signals.unreadAnnouncementCount || 0);

  if (roleTemplate === 'operations_cleaning') {
    return {
      principle: 'reciprocity',
      eyebrow: 'Already prepared for you',
      title: unfinished ? `${unfinished} cleaning route${unfinished === 1 ? '' : 's'} already in progress` : 'Your Whole RTB route is ready',
      description: unfinished
        ? 'Your saved progress, location scope and next unfinished task are already loaded. Continue without rebuilding your shift.'
        : 'RTB OS has already matched your role, both businesses and the correct cleaning workflow. Start with one task and everything auto-saves.',
      actionLabel: 'Continue cleaning',
      targetPage: 'staff-hub',
      targetTab: 'daily',
      tone: unfinished ? 'protect' : 'value',
    };
  }

  if (activePage === 'dashboard' && urgent > 0) {
    return {
      principle: 'loss-aversion',
      eyebrow: 'Protect today',
      title: `${urgent} priority item${urgent === 1 ? '' : 's'} can still be resolved`,
      description: 'RTB OS has already sorted the highest-impact items first so you can protect operations before reviewing lower-priority reporting.',
      actionLabel: 'Handle priority items',
      targetPage: 'action-center',
      tone: 'protect',
    };
  }

  if (activePage === 'dashboard' && drafts > 0) {
    return {
      principle: 'endowment',
      eyebrow: 'Your work is preserved',
      title: `${drafts} payroll draft${drafts === 1 ? '' : 's'} waiting where you left off`,
      description: 'The draft work is already saved. Review what is complete instead of starting over, then lock it only when you are satisfied.',
      actionLabel: 'Resume payroll',
      targetPage: 'payroll',
      tone: 'value',
    };
  }

  if (activePage === 'staff-hub' && unfinished > 0) {
    return {
      principle: 'endowment',
      eyebrow: 'Keep what you already earned',
      title: 'Your progress is saved',
      description: 'RTB OS keeps completed checklist work attached to your shift. Continue from the next unfinished task instead of repeating completed work.',
      actionLabel: 'Continue where I left off',
      targetPage: 'staff-hub',
      targetTab: 'daily',
      tone: 'value',
    };
  }

  if (activePage === 'staff-hub' && unread > 0) {
    return {
      principle: 'reciprocity',
      eyebrow: 'Quick update first',
      title: `${unread} update${unread === 1 ? '' : 's'} summarized for you`,
      description: 'Check the new information first so the rest of your shift decisions use the latest shop context.',
      actionLabel: 'Review updates',
      targetPage: 'staff-hub',
      targetTab: 'home',
      tone: 'value',
    };
  }

  if (activePage === 'payroll' && drafts > 0) {
    return {
      principle: 'contrast',
      eyebrow: 'Recommended path',
      title: 'Review the existing draft before creating another run',
      description: 'Continuing the saved draft preserves verified entries and reduces duplicate work. A new run remains available when the current draft is resolved.',
      actionLabel: '',
      targetPage: 'payroll',
      tone: 'value',
    };
  }

  return null;
}

export function getBehavioralPrincipleLabel(principle) {
  return {
    reciprocity: 'Value first',
    endowment: 'Saved progress',
    'loss-aversion': 'Protect progress',
    contrast: 'Recommended path',
    commitment: 'Small next step',
  }[principle] || 'Smart guidance';
}
