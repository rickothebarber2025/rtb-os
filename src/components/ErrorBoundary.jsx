import { Component } from 'react';
import { supabase } from '../lib/supabaseClient';

// Catches any render/lifecycle error anywhere below it in the tree and
// shows a calm, recoverable screen instead of a raw crash. Before this
// existed, any unhandled error (a bad API response, an unexpected data
// shape, a database function conflict) took down the entire app with a
// technical error message -- exactly what happened when a real staff
// member hit a database function conflict and saw a raw Postgres error
// message with no way forward except force-quitting the app.
//
// Also logs the error to app_client_errors so it's actually visible
// afterward, instead of only existing as a screenshot someone has to
// remember to send.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.logError(error, info).catch(() => {
      // Logging the error must never itself throw or block the fallback UI.
    });
  }

  async logError(error, info) {
    if (!supabase) return;

    let userEmail = null;
    try {
      const { data } = await supabase.auth.getUser();
      userEmail = data?.user?.email || null;
    } catch (_err) {
      // If we can't even get the user, still log what we can below.
    }

    await supabase.from('app_client_errors').insert({
      component_stack: info?.componentStack || null,
      message: String(error?.message || error || 'Unknown error'),
      page: typeof window !== 'undefined' ? window.location.href : null,
      stack: error?.stack || null,
      user_email: userEmail,
    });
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="error-boundary-screen">
          <div className="error-boundary-card">
            <h1>Something went wrong</h1>
            <p>
              This page ran into a problem. It's been logged, and reloading usually fixes it.
            </p>
            <button className="primary-button" onClick={this.handleReload} type="button">
              Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
