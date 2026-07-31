import type { CapacitorConfig } from '@capacitor/cli';

const liveRtbOsUrl = 'https://rtbheadquaters.com';

// Remote/hosted mode: the native shell loads the live site directly
// (server.url) instead of bundling a snapshot of dist/ into the app
// package. This matters a lot for RTB OS specifically -- the team
// pushes real fixes to production multiple times a day, and Apple's
// review turnaround (even for minor updates) would otherwise force
// every single one of those through App Review before staff could
// see it. With server.url, only changes to this native shell itself
// (icons, splash screen, native config) ever need a new App Store
// submission -- everything else updates the instant it's deployed,
// exactly like it does in a browser today.
const config: CapacitorConfig = {
  appId: 'com.rtbheadquaters.os',
  appName: 'RTB OS',
  webDir: 'dist',
  server: {
    url: liveRtbOsUrl,
    cleartext: false,
    allowNavigation: ['rtbheadquaters.com', 'www.rtbheadquaters.com'],
  },
  ios: {
    allowsLinkPreview: false,
    contentInset: 'never',
    preferredContentMode: 'mobile',
  },
};

export default config;
