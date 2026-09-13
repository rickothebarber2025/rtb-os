export const INTEGRATION_PROVIDERS = [
  {
    id: 'square',
    name: 'Square',
    category: 'Business systems',
    authType: 'system',
    defaultStatus: 'connected',
    description: 'Live RTB sales, attendance and Beauty appointment data using the existing production connection.',
    capabilities: ['Sales', 'Attendance', 'Appointments', 'Customers'],
    recommended: true,
  },
  {
    id: 'booksy',
    name: 'Booksy',
    category: 'Business systems',
    authType: 'system',
    defaultStatus: 'connected',
    description: 'RTB Lounge booking data imported through the existing Booksy Gmail sync.',
    capabilities: ['Bookings', 'Clients', 'Staff schedules'],
    recommended: true,
  },
  {
    id: 'google',
    name: 'Google',
    category: 'Business systems',
    authType: 'oauth',
    defaultStatus: 'setup_ready',
    description: 'Owner sign-in can upgrade once to approved Workspace access so RTB OS can use Gmail, Calendar, Drive, Contacts and Sheets without recreating keys for every project.',
    capabilities: ['Gmail', 'Calendar', 'Drive', 'Contacts', 'Sheets', 'Sign-in'],
    recommended: true,
  },
  {
    id: 'github',
    name: 'GitHub',
    category: 'Development systems',
    authType: 'oauth',
    defaultStatus: 'setup_ready',
    description: 'One managed GitHub OAuth connection for RTB OS and A.R.V.I.S. so repositories, issues, pull requests and project context can feed the main brain without per-project personal access tokens.',
    capabilities: ['Repositories', 'Issues', 'Pull requests', 'Project context'],
    recommended: true,
  },
  {
    id: 'supabase',
    name: 'RTB Database',
    category: 'Core system',
    authType: 'system',
    defaultStatus: 'connected',
    description: 'RTB OS database, authentication, Edge Functions, storage, realtime and automation infrastructure.',
    capabilities: ['Database', 'Auth', 'Functions', 'Storage', 'Realtime'],
    recommended: true,
  },
];

export const INTEGRATION_CATEGORIES = ['All', ...new Set(INTEGRATION_PROVIDERS.map((item) => item.category))];

export function getIntegrationProvider(providerId) {
  return INTEGRATION_PROVIDERS.find((item) => item.id === providerId) || null;
}
