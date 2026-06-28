export const OPERATIONS_SETTING_KEY = 'rtb_operating_system';

export const COMMISSION_TIERS = [
  {
    duration: 'First 90 days',
    expectations: [
      'Learn RTB systems and standards',
      'Build clientele',
      'Participate in content',
      'Show punctuality and consistency',
      'Maintain professional behavior',
    ],
    name: 'Probation Tier',
    notes: ['All new staff start here', '90-day evaluation period', 'Path to Standard RTB'],
    split: '50 / 50',
    tone: 'muted',
  },
  {
    duration: 'After successful probation',
    expectations: [
      'Maintain professionalism',
      'Meet minimum performance standards',
      'Retain and rebook clients',
      'Stay active in content and team work',
    ],
    name: 'Standard RTB Tier',
    notes: ['Earned after probation', 'Must keep meeting expectations'],
    split: '60 / 40',
    tone: 'success',
  },
  {
    duration: 'If standards drop',
    expectations: [
      'Temporary adjustment',
      'Improve performance and consistency',
      'Recommit to RTB standards',
    ],
    name: 'Performance Review Tier',
    notes: ['30-day review period', 'Path back to Standard RTB'],
    split: '55 / 45',
    tone: 'warning',
  },
  {
    duration: 'Management approval',
    expectations: [
      'Strong consistent production',
      'Helps grow the RTB brand',
      'Positive team contribution',
      'Minimal management required',
    ],
    name: 'Growth Performer Tier',
    notes: ['By invitation or approval', 'For above-standard contribution'],
    split: '65 / 35',
    tone: 'blue',
  },
  {
    duration: 'Limited spots',
    expectations: [
      'Self-sufficient',
      'Strong client retention',
      'Leadership and mentorship',
      'Major contribution to RTB growth',
    ],
    name: 'Elite RTB Tier',
    notes: ['Top performers only', 'Approved by management'],
    split: '70 / 30',
    tone: 'gold',
  },
  {
    duration: 'Long-term option',
    expectations: [
      'Independent operation under RTB',
      'Manage own clientele and schedule',
      'Maintain RTB standards and reputation',
    ],
    name: 'Booth Rent Tier',
    notes: ['Pay weekly booth rent', 'Keep 100% of services'],
    split: 'Keep 100%',
    tone: 'neutral',
  },
];

export const HIRE_STEPS = [
  { detail: 'Structured interview and score sheet', title: 'Interview' },
  { detail: 'Live or supervised skill test', title: 'Practical assessment' },
  { detail: 'Contract, commission, confidentiality, and social media forms', title: 'Paperwork signed' },
  { detail: 'Profile, passcode, services, commission, and schedule', title: 'Square profile created' },
  { detail: 'Professional presence and RTB tagging', title: 'Social media set up' },
  { detail: 'Menu assigned and Probation 50/50 to start', title: 'Services and commission tier' },
  { detail: 'Employee handbook and operating rules reviewed', title: 'Policies reviewed' },
  { detail: 'Day 1 / Week 1 plan and shadowing', title: 'Onboarding and training' },
  { detail: 'KPI tracking and tier confirmation', title: '30 / 60 / 90 reviews' },
];

export const OPERATION_CHECKLISTS = {
  opening: {
    cadence: 'Every morning',
    title: 'Opening the shop',
    items: [
      'Unlock and disarm; lights on',
      'Stations wiped and set; tools sanitized and laid out',
      'Check the day schedule; note gaps and VIPs',
      'Restock each station',
      'Front desk and reception area tidy; card reader on',
      'Music on at the right level',
      'Confirm scheduled staff are clocked in',
      'Bathroom checked and stocked',
    ],
  },
  closing: {
    cadence: 'Every night',
    title: 'Closing the shop',
    items: [
      'Run daily close report; reconcile cash and card',
      'Stations broken down, wiped, and sanitized',
      'Floors swept; hair disposed; laundry started or bagged',
      'Restock anything low for tomorrow',
      'Confirm tomorrow first appointments',
      'Trash out; back areas tidy',
      'Lights off, arm, and lock up',
      'Note anything that needs attention tomorrow',
    ],
  },
  daily: {
    cadence: 'Throughout the day',
    title: 'Daily cleaning',
    items: [
      'Sanitize tools between every client',
      'Wipe station and chair after each client',
      'Sweep hair after each cut',
      'Reset reception and waiting area hourly',
      'Refill product and disposables as used',
    ],
  },
  weekly: {
    cadence: 'Once per week',
    title: 'Weekly deep clean',
    items: [
      'Deep clean and disinfect stations and chairs',
      'Wash and disinfect reusable tools and combs',
      'Mop floors fully and clean baseboards',
      'Clean mirrors and glass throughout',
      'Full bathroom deep clean',
      'Inventory count and reorder list',
      'Laundry fully done and put away',
      'Check equipment for wear or maintenance needs',
    ],
  },
  payroll: {
    cadence: 'Each pay run',
    title: 'Pay-period checklist',
    items: [
      'Pull commission and sales report for the period',
      'Reconcile custom amount and discounted transactions',
      'Confirm hours and attendance against schedule',
      'Apply the correct tier split per staff member',
      'Flag anyone under the minimum for review',
      'Calculate final pay per person',
      'Process payment and record it',
      'Send each person a simple pay breakdown',
    ],
  },
  quarterly: {
    cadence: 'Every 3 months',
    title: 'Quarterly RTB OS review',
    items: [
      'Re-read each module for anything out of date',
      'Confirm commission tiers and minimums still fit the business',
      'Update service menu and pricing',
      'Refresh hashtags and content standards',
      'Confirm forms still match current policy',
      'Note the review in the change log',
    ],
  },
};

export const OPERATING_RHYTHM = [
  {
    cadence: 'Daily',
    items: [
      'Open with the opening SOP',
      'Clean between every client',
      'Keep the schedule accurate',
      'Close with the closing SOP and daily report',
    ],
  },
  {
    cadence: 'Weekly',
    items: [
      'Weekly deep clean',
      'Inventory count and reorder list',
      'Review the week numbers',
      'Check equipment and maintenance',
    ],
  },
  {
    cadence: 'Monthly',
    items: [
      'Run month-end close',
      'Review menu performance',
      'Check each staff member against minimum expectations',
      'Plan next month content',
    ],
  },
  {
    cadence: 'Quarterly',
    items: [
      'Performance reviews and tier confirmation',
      'Review service menu and pricing',
      'Update RTB OS',
      'Revisit growth plans',
    ],
  },
];

export const SQUARE_SETUP_STEPS = [
  'Create staff profile and passcode',
  'Assign services and schedule',
  'Set starting commission tier',
  'Confirm checkout permissions',
  'Add client notes expectations',
  'Deactivate profile on offboarding',
];

export const FINANCE_CLOSE_STEPS = [
  'Reconcile Square against QuickBooks',
  'Categorize every transaction',
  'Flag custom amounts and unusual discounts',
  'Review revenue per staff member',
  'Separate RTB Lounge and RTB Beauty Lounge totals',
  'Produce the P&L and note anything unusual',
];

export const MARKETING_HASHTAGS = [
  '#Ottawa',
  '#OttawaLife',
  '#OttawaStyle',
  '#OttawaBusiness',
  '#OttawaBarbers',
  '#OttawaEvents',
  '#613Life',
  '#613Barbers',
  '#ByWardMarket',
  '#OttawaTrend',
  '#OttawaDeals',
  '#OttawaLocal',
  '#SupportLocalOttawa',
];

export const TRAINING_SECTIONS = [
  {
    title: 'Shared Week 1',
    rows: [
      ['Day 1', 'Shop tour, team intros, handbook walkthrough, Square basics, shadow a full client cycle'],
      ['Days 2-3', 'Supervised first clients, brand standards, service menu, commission walkthrough'],
      ['Days 4-5', 'Build toward independent service, begin content participation, practice rebooking habits'],
    ],
  },
  {
    title: 'Role paths',
    rows: [
      ['Barber / Stylist', 'Consultation, RTB cut standards, speed, chair turnover, fade and finish checks'],
      ['Nail Tech', 'Full set standards, sanitation, table reset, product handling, before and after content'],
      ['Lash / Brow', 'Application standards, retention, client comfort, consultation, aftercare'],
      ['Braider / Esthetics', 'Service quality bar, realistic timing, sanitation, content, rebooking'],
    ],
  },
  {
    title: 'Ramp checkpoints',
    rows: [
      ['30 days', 'Adjustment, early client feedback, setup accuracy'],
      ['60 days', 'KPI check-in and coaching on soft spots'],
      ['90 days', 'Full review and move from Probation to Standard RTB when earned'],
    ],
  },
];

export const FORM_TEMPLATES = [
  {
    description: 'Tier-based commission terms staff sign on hire.',
    id: 'commission',
    name: 'Commission Agreement',
    sections: [
      ['Team member', ['Name: __________________________', 'Effective date: __________________________']],
      [
        'Tier structure',
        [
          'Probation - staff keeps 50% - first 90 days',
          'Standard - staff keeps 60% - after successful probation',
          'Performance Review - staff keeps 55% - if standards drop',
          'Growth - staff keeps 65% - by management approval',
          'Elite - staff keeps 70% - top performers, limited spots',
          'Booth Rent - weekly rent model',
        ],
      ],
      [
        'Minimum expectation',
        ['The team member is expected to meet RTB performance, professionalism, schedule, content, and client care standards.'],
      ],
      ['Signatures', ['Team member: __________________________', 'RTB representative: __________________________']],
    ],
    tag: 'HR',
  },
  {
    description: 'Core terms of employment or engagement.',
    id: 'contract',
    name: 'Employment Contract',
    sections: [
      ['Basic terms', ['Team member: __________________________', 'Role: __________________________', 'Start date: __________________________']],
      ['Schedule', ['Agreed days and hours: __________________________']],
      ['Compensation', ['Paid on the RTB tier-based commission structure unless otherwise approved in writing.']],
      ['Standards', ['The team member agrees to follow the handbook, SOPs, RTB standards, and client care expectations.']],
      ['Signatures', ['Team member: __________________________', 'RTB representative: __________________________']],
    ],
    tag: 'HR',
  },
  {
    description: 'Consent and standards for posting under the RTB name.',
    id: 'social',
    name: 'Social Media Agreement',
    sections: [
      ['Consent', ['The team member consents to RTB photographing and filming their work for RTB channels.']],
      ['Standards', ['Tag the RTB shop account.', 'Get client consent before posting a client.', 'Keep posts clean, professional, and on brand.']],
      ['Signatures', ['Team member: __________________________', 'RTB representative: __________________________']],
    ],
    tag: 'Marketing',
  },
  {
    description: 'Protects client lists and business information.',
    id: 'confidentiality',
    name: 'Confidentiality Agreement',
    sections: [
      ['Confidential information', ['Client lists, contact information, pricing, supplier details, and RTB processes must stay confidential.']],
      ['Client relationships', ['Client relationships built through RTB systems remain associated with RTB unless separately agreed.']],
      ['Signatures', ['Team member: __________________________', 'RTB representative: __________________________']],
    ],
    tag: 'HR',
  },
  {
    description: 'Interview scoring across five categories.',
    id: 'interview',
    name: 'Interview Score Sheet',
    sections: [
      ['Candidate', ['Name: __________________________', 'Role: __________________________', 'Date: __________________________']],
      ['Scores', ['Technical confidence: ____ / 5', 'Communication: ____ / 5', 'Reliability signals: ____ / 5', 'Brand fit: ____ / 5', 'Business mindset: ____ / 5']],
      ['Decision', ['Average score: __________', 'Decision / notes: __________________________']],
    ],
    tag: 'Hiring',
  },
  {
    description: 'Pre-start and Day 1 setup tracker.',
    id: 'new-hire',
    name: 'New Hire Checklist',
    sections: [
      ['Before Day 1', ['Contracts signed', 'Station assigned', 'Square profile created', 'Added to schedule', 'Social handle set up', 'Kit and supplies confirmed']],
      ['Day 1', ['Shop tour', 'Team intros', 'Handbook walkthrough', 'Square walkthrough', 'Shadowed a full client cycle']],
    ],
    tag: 'Hiring',
  },
  {
    description: 'KPI review used at 30, 60, 90, and quarterly.',
    id: 'performance-review',
    name: 'Performance Review Form',
    sections: [
      ['Review info', ['Team member: __________________________', 'Current tier: __________________________', 'Review date: __________________________']],
      ['KPIs', ['Rebooking rate: __________', 'Occupancy: __________', 'Average ticket: __________', 'Client retention: __________', 'Attendance: __________', 'Monthly revenue: __________']],
      ['Decision', ['Going well: __________________________', 'Needs work: __________________________', 'Tier decision: __________________________']],
    ],
    tag: 'HR',
  },
  {
    description: 'Document any incident the day it happens.',
    id: 'incident',
    name: 'Incident Report',
    sections: [
      ['Incident', ['Date / time: __________________________', 'Location: __________________________', 'People involved: __________________________']],
      ['Details', ['What happened: __________________________', 'Action taken: __________________________', 'Follow-up needed: __________________________']],
      ['Review', ['Reported by: __________________________', 'Owner review: __________________________']],
    ],
    tag: 'HR',
  },
  {
    description: 'Written warning for repeated or serious issues.',
    id: 'warning',
    name: 'Warning Form',
    sections: [
      ['Warning', ['Team member: __________________________', 'Date: __________________________', 'Prior verbal warning date: __________________________']],
      ['Issue', ['Policy or standard breached: __________________________', 'Expectation going forward: __________________________', 'Consequence if repeated: __________________________']],
      ['Signatures', ['Team member: __________________________', 'RTB representative: __________________________']],
    ],
    tag: 'Discipline',
  },
  {
    description: 'Reason, length, and conditions to return.',
    id: 'suspension',
    name: 'Suspension Notice',
    sections: [
      ['Suspension', ['Team member: __________________________', 'Date: __________________________', 'Reason: __________________________']],
      ['Return', ['Length: __________________________', 'Return date: __________________________', 'Conditions to return: __________________________']],
      ['Note', ['Confirm employment law requirements before treating any suspension as unpaid.']],
    ],
    tag: 'Discipline',
  },
  {
    description: 'End of employment record.',
    id: 'termination',
    name: 'Termination Form',
    sections: [
      ['Termination', ['Team member: __________________________', 'Date: __________________________', 'Type: just cause / without cause']],
      ['Details', ['Reason / history: __________________________', 'Final pay issued: __________________________', 'Record of Employment issued: __________________________']],
      ['Note', ['Confirm notice, severance, and final pay requirements with an employment professional.']],
    ],
    tag: 'Discipline',
  },
  {
    description: 'Square, social, physical, and client transition tasks.',
    id: 'exit',
    name: 'Exit Checklist',
    sections: [
      ['Square', ['Profile and passcode deactivated', 'Recurring clients reassigned']],
      ['Social', ['Tagging and bio association removed', 'Existing posts handled per agreement']],
      ['Physical', ['Station cleared and reassigned', 'Keys, equipment, and kit returned']],
      ['Client transition', ['Who absorbs their clients: __________________________', 'Clients notified by RTB']],
    ],
    tag: 'Offboarding',
  },
];

export const DEFAULT_CHANGELOG = [
  {
    date: 'Jun 2026',
    note: 'RTB Operating System added for SOPs, hiring workflows, forms, training, and internal process tracking.',
  },
];

function emptyChecklistState() {
  return Object.fromEntries(
    Object.entries(OPERATION_CHECKLISTS).map(([key, checklist]) => [
      key,
      checklist.items.map(() => false),
    ]),
  );
}

export function createDefaultOperationsState() {
  return {
    changelog: [...DEFAULT_CHANGELOG],
    checklists: emptyChecklistState(),
    hires: [],
  };
}

export function normalizeOperationsState(value) {
  const defaults = createDefaultOperationsState();
  const source = value && typeof value === 'object' ? value : {};
  const sourceChecklists = source.checklists && typeof source.checklists === 'object'
    ? source.checklists
    : {};

  const checklists = Object.fromEntries(
    Object.entries(OPERATION_CHECKLISTS).map(([key, checklist]) => {
      const saved = Array.isArray(sourceChecklists[key]) ? sourceChecklists[key] : [];
      return [key, checklist.items.map((_, index) => Boolean(saved[index]))];
    }),
  );

  return {
    changelog: Array.isArray(source.changelog) ? source.changelog : defaults.changelog,
    checklists,
    hires: Array.isArray(source.hires) ? source.hires : [],
  };
}

export function getChecklistProgress(items, checks = []) {
  const total = items.length;
  const done = checks.filter(Boolean).length;
  return {
    done,
    percent: total ? Math.round((done / total) * 100) : 0,
    total,
  };
}
