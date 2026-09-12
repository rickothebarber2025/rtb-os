import { useEffect, useState } from 'react';
import { Camera, ExternalLink, Link2, RefreshCw, Unlink } from 'lucide-react';
import { connectGoogleHome, disconnectGoogleHome, getGoogleHomeBridgeStatus } from '../native/googleHomeBridge';
import { recordGoogleHomeSetupTestEvent } from '../services/rtbService';

const IOS_GOOGLE_HOME_ROUTE = 'com.rtbheadquaters.os://operations?section=checklists';

function bridgeLabel(status) {
  if (!status) return 'Checking Google Home...';
  if (status.connected) return 'Google Home authorized';
  if (!status.native) return 'Open the RTB OS iPhone app to connect Google Home';
  if (!status.sdkAvailable) return 'Google Home SDK not installed';
  if (!status.clientIDConfigured || !status.teamIDConfigured || !status.cloudProjectConfigured) {
    return 'Google Home OAuth setup required';
  }
  if (status.ready) return 'Ready to connect Google Home';
  return status.reason || 'Google Home setup incomplete';
}

function bridgeDetail(status) {
  if (!status) return 'Checking this device for the native Google Home setup.';
  if (status.connected) return 'This iPhone has accepted the Google Home authorization.';
  if (!status.native) return 'Google Home requires the installed iPhone app so App Attest and the native SDK are available.';
  if (status.ready) return 'Authorize with rickothebarber@gmail.com when Google asks which account to use.';
  return status.reason || 'Finish the missing Google Home iOS setup before connecting.';
}

export default function GoogleHomeConnectionPanel({ businessUnitId, embedded = false, onSetupEventRecorded }) {
  const [bridgeStatus, setBridgeStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  async function refreshBridgeStatus() {
    const status = await getGoogleHomeBridgeStatus();
    setBridgeStatus(status);
    return status;
  }

  async function handleConnect() {
    setBusy(true);
    setError('');
    setNote('');
    try {
      const result = await connectGoogleHome();
      setBridgeStatus((current) => ({ ...current, ...result, connected: Boolean(result?.connected) }));
      if (businessUnitId) {
        await recordGoogleHomeSetupTestEvent(businessUnitId);
        setNote('Google Home authorization was accepted and a setup test event reached RTB OS.');
        onSetupEventRecorded?.();
      } else {
        setNote('Google Home authorization was accepted. Select one business to send the setup test event.');
      }
    } catch (err) {
      setError(err?.message || 'Unable to authorize Google Home.');
      await refreshBridgeStatus();
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    setError('');
    setNote('');
    try {
      const result = await disconnectGoogleHome();
      setBridgeStatus((current) => ({ ...current, ...result, connected: false }));
      setNote('Google Home was disconnected on this iPhone. Revoke account access in Google if needed.');
    } catch (err) {
      setError(err?.message || 'Unable to disconnect Google Home.');
      await refreshBridgeStatus();
    } finally {
      setBusy(false);
    }
  }

  function openNativeApp() {
    window.location.assign(IOS_GOOGLE_HOME_ROUTE);
  }

  useEffect(() => {
    refreshBridgeStatus();
  }, []);

  const ready = Boolean(bridgeStatus?.native && bridgeStatus?.ready);

  return (
    <section className={`${embedded ? '' : 'panel full-span'} google-home-integration-panel`}>
      <div className="integration-card-header">
        <div className="integration-provider-icon"><Camera size={20} /></div>
        <div>
          <div className="integration-title-row">
            <h3>Google Home opening & closing</h3>
            <span className="integration-recommended">iOS app</span>
          </div>
          <span className="subtle-text">Camera presence verification</span>
        </div>
        <span className={`status-badge ${bridgeStatus?.connected ? 'success' : ready ? 'warning' : 'neutral'}`}>
          {bridgeStatus?.connected ? 'Connected' : ready ? 'Ready' : 'iPhone required'}
        </span>
      </div>

      <div className="shop-presence-connection">
        <div>
          <strong>{bridgeLabel(bridgeStatus)}</strong>
          <small>{bridgeDetail(bridgeStatus)}</small>
        </div>
        {bridgeStatus?.native ? (
          bridgeStatus?.connected ? (
            <button className="ghost-button small" disabled={busy} type="button" onClick={handleDisconnect}>
              <Unlink size={15} />
              {busy ? 'Disconnecting...' : 'Disconnect'}
            </button>
          ) : (
            <button className="secondary-button small" disabled={busy || !ready} type="button" onClick={handleConnect}>
              <Link2 size={15} />
              {busy ? 'Connecting...' : 'Connect Google Home'}
            </button>
          )
        ) : (
          <button className="secondary-button small" type="button" onClick={openNativeApp}>
            <ExternalLink size={15} />
            Open iPhone app
          </button>
        )}
      </div>

      <div className="action-row integration-actions">
        <button className="ghost-button small" disabled={busy} type="button" onClick={refreshBridgeStatus}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {note ? <div className="alert success">{note}</div> : null}
      {error ? <div className="alert warning">{error}</div> : null}
    </section>
  );
}
