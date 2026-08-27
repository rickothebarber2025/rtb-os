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
    description: 'Connect the owner Google account so RTB OS can read approved Gmail payment confirmations and use Calendar, Drive and other enabled Google services.',
    capabilities: ['Gmail payment evidence', 'Calendar', 'Drive', 'Sign-in'],
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
