import { Component } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

export default class PageErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidUpdate(previousProps) {
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error, info) {
    this.logError(error, info).catch(() => {});
  }

  async logError(error, info) {
    if (!supabase) return;
    let userEmail = null;
    try {
      const { data } = await supabase.auth.getUser();
      userEmail = data?.user?.email || null;
    } catch {
      // Keep recovery independent from logging.
    }

    await supabase.from('app_client_errors').insert({
      component_stack: info?.componentStack || null,
      message: String(error?.message || error || 'Unknown page error'),
      page: typeof window !== 'undefined' ? window.location.href : null,
      stack: error?.stack || null,
      user_email: userEmail,
    });
  }

  handleRetry = () => {
    this.setState({ error: null });
    this.props.onRetry?.();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <section className="panel full-span" role="alert">
        <div className="empty-state">
          <AlertTriangle size={28} />
          <h2>This section hit a problem</h2>
          <p>The rest of RTB OS is still available. Try this section again, or use the navigation to continue working.</p>
          <button className="primary-button" type="button" onClick={this.handleRetry}>
            <RefreshCw size={16} /> Try again
          </button>
        </div>
      </section>
    );
  }
}
