export const INTEGRATION_PROVIDERS = [
  {
    id: 'square',
    name: 'Square',
    category: 'Business systems',
    authType: 'system',
    description: 'Live RTB sales, attendance and Beauty appointment data using the existing production connection.',
    capabilities: ['Sales', 'Attendance', 'Appointments', 'Customers'],
    recommended: true,
  },
  {
    id: 'booksy',
    name: 'Booksy',
    category: 'Business systems',
    authType: 'system',
    description: 'RTB Lounge booking data imported through the existing Booksy Gmail sync.',
    capabilities: ['Bookings', 'Clients', 'Staff schedules'],
    recommended: true,
  },
  {
    id: 'google',
    name: 'Google',
    category: 'Business systems',
    authType: 'oauth',
    description: 'Owner sign-in plus approved Google services such as Gmail, Calendar and Drive when enabled.',
    capabilities: ['Sign-in', 'Gmail', 'Calendar', 'Drive'],
    recommended: true,
  },
  {
    id: 'textnow',
    name: 'TextNow',
    category: 'Business systems',
    authType: 'manual',
    description: 'Client texting inside RTB OS. Keep disabled until the production inbox sync is verified end to end.',
    capabilities: ['Inbox', 'Conversations', 'SMS'],
    recommended: true,
  },
  {
    id: 'supabase',
    name: 'RTB Database',
    category: 'Core system',
    authType: 'system',
    description: 'RTB OS database, authentication, Edge Functions, storage, realtime and automation infrastructure.',
    capabilities: ['Database', 'Auth', 'Functions', 'Storage', 'Realtime'],
    recommended: true,
  },
];

export const INTEGRATION_CATEGORIES = ['All', ...new Set(INTEGRATION_PROVIDERS.map((item) => item.category))];

export function getIntegrationProvider(providerId) {
  return INTEGRATION_PROVIDERS.find((item) => item.id === providerId) || null;
}
