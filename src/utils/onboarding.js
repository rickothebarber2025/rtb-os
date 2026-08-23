export const ONBOARDING_STAGE_IDS = [
  'personal_setup',
  'rtb_standards',
  'operational_training',
  'knowledge_checks',
  'practical_certification',
  'final_acknowledgement',
];

export const ONBOARDING_STAGES = [
  {
    id: 'personal_setup',
    label: 'Personal setup',
    items: ['Contact and emergency information', 'Position, start date and availability', 'Contract and required documents'],
  },
  {
    id: 'rtb_standards',
    label: 'RTB standards',
    items: ['Client experience and professionalism', 'Dress code and workstation appearance', 'Attendance, lateness and calendar blocking', 'Cleaning, opening and closing standards', 'Cash, tips, commission and payment procedures', 'Social media and content expectations', 'Harassment, confidentiality and workplace conduct'],
  },
  {
    id: 'operational_training',
    label: 'How to operate',
    items: ['Booksy appointments', 'Client check-in and checkout', 'Square procedures', 'Cancellations, no-shows and refunds', 'Walk-ins, rebooking and client notes', 'Damage, shortage and incident reporting'],
  },
  {
    id: 'knowledge_checks',
    label: 'Knowledge checks',
    items: ['Pass every quiz section', 'Review failed sections before retrying'],
  },
  {
    id: 'practical_certification',
    label: 'Practical shop certification',
    items: ['Shop tour', 'Mock booking', 'Mock checkout', 'Opening and closing demonstration', 'Cleaning inspection', 'Manager approval'],
  },
  {
    id: 'final_acknowledgement',
    label: 'Final acknowledgments',
    items: ['Electronic signature for each policy', 'Completion timestamps', 'Certificate after manager approval'],
  },
];

export const ONBOARDING_QUIZ_SECTIONS = [
  { id: 'rtb_standards', label: 'RTB standards', passingScore: 80 },
  { id: 'operational_training', label: 'How to operate', passingScore: 80 },
  { id: 'cash_payments', label: 'Cash, tips and payments', passingScore: 80 },
  { id: 'conduct_confidentiality', label: 'Conduct and confidentiality', passingScore: 80 },
];

export const PROBATION_REVIEW_DAYS = [7, 30, 60, 90];

export function isOnboardingRestrictedProfile(profile) {
  return String(profile?.permissions?.role_template || profile?.role_template || '').trim() === 'onboarding_restricted';
}

export function getStageProgressMap(stageProgress = []) {
  return new Map((stageProgress || []).map((stage) => [stage.stage_id, stage]));
}

export function getPassedQuizSections(quizAttempts = []) {
  return new Set((quizAttempts || []).filter((attempt) => attempt.passed).map((attempt) => attempt.section_id));
}

export function getSignedPolicyKeys(signatures = []) {
  return new Set((signatures || []).map((signature) => `${signature.policy_id}:${signature.policy_version}`));
}

export function getRequiredOnboardingPolicies(policyDocuments = []) {
  return (policyDocuments || []).filter((policy) => policy.active !== false && policy.requires_acknowledgement !== false);
}

export function buildOnboardingChecklist({ policyDocuments = [], quizAttempts = [], signatures = [], stageProgress = [] } = {}) {
  const progressMap = getStageProgressMap(stageProgress);
  const passedSections = getPassedQuizSections(quizAttempts);
  const signedKeys = getSignedPolicyKeys(signatures);
  const requiredPolicies = getRequiredOnboardingPolicies(policyDocuments);

  const stages = ONBOARDING_STAGES.map((stage) => {
    const progress = progressMap.get(stage.id);
    return {
      ...stage,
      completed: progress?.status === 'completed',
      completedAt: progress?.completed_at || null,
      progress,
    };
  });

  const quizSections = ONBOARDING_QUIZ_SECTIONS.map((section) => ({
    ...section,
    passed: passedSections.has(section.id),
  }));

  const policies = requiredPolicies.map((policy) => ({
    ...policy,
    signed: signedKeys.has(`${policy.id}:${policy.version}`),
  }));

  const readyForSubmission =
    stages.every((stage) => stage.completed) &&
    quizSections.every((section) => section.passed) &&
    policies.every((policy) => policy.signed);

  return {
    policies,
    quizSections,
    readyForSubmission,
    signedPolicyCount: policies.filter((policy) => policy.signed).length,
    stages,
  };
}

export function probationReviewDueLabel(review, today = new Date()) {
  const date = new Date(`${review?.scheduled_date || ''}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 'Not scheduled';
  const diffDays = Math.ceil((date.getTime() - new Date(today.toISOString().slice(0, 10)).getTime()) / 86400000);
  if (review.status === 'completed') return 'Completed';
  if (diffDays < 0) return `${Math.abs(diffDays)} day${Math.abs(diffDays) === 1 ? '' : 's'} overdue`;
  if (diffDays === 0) return 'Due today';
  return `Due in ${diffDays} day${diffDays === 1 ? '' : 's'}`;
}
