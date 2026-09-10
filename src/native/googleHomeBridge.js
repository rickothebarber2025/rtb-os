import { Capacitor, registerPlugin } from '@capacitor/core';

const GoogleHomeBridge = registerPlugin('GoogleHomeBridge');

export async function getGoogleHomeBridgeStatus() {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') {
    return {
      native: false,
      sdkAvailable: false,
      clientIDConfigured: false,
      teamIDConfigured: false,
      cloudProjectConfigured: false,
      ready: false,
      reason: 'Use the RTB OS iPhone app to connect Google Home.',
    };
  }

  try {
    return await GoogleHomeBridge.status();
  } catch (error) {
    return {
      native: true,
      sdkAvailable: false,
      clientIDConfigured: false,
      teamIDConfigured: false,
      cloudProjectConfigured: false,
      ready: false,
      reason: error?.message || 'Google Home bridge is not available in this build.',
    };
  }
}

export async function connectGoogleHome() {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') {
    throw new Error('Open RTB OS on your iPhone to authorize Google Home.');
  }
  return GoogleHomeBridge.connect();
}

export async function disconnectGoogleHome() {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') {
    throw new Error('Open RTB OS on your iPhone to disconnect Google Home.');
  }
  return GoogleHomeBridge.disconnect();
}
