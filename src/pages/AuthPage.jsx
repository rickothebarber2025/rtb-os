import { useState } from 'react';
import { LockKeyhole, Mail } from 'lucide-react';

export default function AuthPage({
  authError,
  isConfigured,
  sendMagicLink,
  signInWithApple,
  signInWithGoogle,
  signInWithPassword,
  signUp,
}) {
  const [mode, setMode] = useState('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    setMessage('');

    try {
      if (mode === 'magic') {
        await sendMagicLink(email);
        setMessage('Magic link sent. Check your inbox.');
      } else if (mode === 'signup') {
        await signUp({ email, password });
        setMessage('Account created. Confirm your email if required.');
      } else {
        await signInWithPassword({ email, password });
      }
    } catch (err) {
      setError(err.message || 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogleSignIn() {
    setSubmitting(true);
    setError('');
    setMessage('');

    try {
      await signInWithGoogle();
    } catch (err) {
      setError(err.message || 'Google sign-in failed.');
      setSubmitting(false);
    }
  }

  async function handleAppleSignIn() {
    setSubmitting(true);
    setError('');
    setMessage('');

    try {
      await signInWithApple();
    } catch (err) {
      setError(err.message || 'Apple sign-in failed.');
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <div className="auth-brand">
          <div className="brand-mark large image-mark">
            <img src="/assets/rtb-combined-logo.png" alt="" />
          </div>
          <div>
            <span>RTB OS</span>
            <h1>Business command center</h1>
          </div>
        </div>

        <div className="auth-card">
          <div className="auth-card__header">
            <h2>Sign in</h2>
            <p>RTB Lounge and RTB Beauty Lounge operations.</p>
          </div>

          {!isConfigured ? (
            <div className="alert danger">
              Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to your environment.
            </div>
          ) : null}

          {authError ? <div className="alert danger">{authError}</div> : null}

          <div className="segmented-control" aria-label="Authentication mode">
            <button
              className={mode === 'password' ? 'active' : ''}
              type="button"
              onClick={() => setMode('password')}
            >
              Password
            </button>
            <button
              className={mode === 'magic' ? 'active' : ''}
              type="button"
              onClick={() => setMode('magic')}
            >
              Magic link
            </button>
            <button
              className={mode === 'signup' ? 'active' : ''}
              type="button"
              onClick={() => setMode('signup')}
            >
              Create
            </button>
          </div>

          <form className="stack" onSubmit={handleSubmit}>
            <button
              className="apple-button"
              disabled={!isConfigured || submitting}
              type="button"
              onClick={handleAppleSignIn}
            >
              <span className="apple-mark" aria-hidden="true"></span>
              Continue with Apple
            </button>

            <button
              className="google-button"
              disabled={!isConfigured || submitting}
              type="button"
              onClick={handleGoogleSignIn}
            >
              <span className="google-mark" aria-hidden="true">G</span>
              Continue with Google
            </button>

            <div className="auth-divider">
              <span>or</span>
            </div>

            <label className="field">
              <span>Email</span>
              <div className="input-shell">
                <Mail size={17} />
                <input
                  autoComplete="email"
                  disabled={!isConfigured}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@rtblounge.com"
                  required
                  type="email"
                  value={email}
                />
              </div>
            </label>

            {mode !== 'magic' ? (
              <label className="field">
                <span>Password</span>
                <div className="input-shell">
                  <LockKeyhole size={17} />
                  <input
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    disabled={!isConfigured}
                    minLength={6}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Minimum 6 characters"
                    required
                    type="password"
                    value={password}
                  />
                </div>
              </label>
            ) : null}

            {error ? <div className="alert danger">{error}</div> : null}
            {message ? <div className="alert success">{message}</div> : null}

            <button className="primary-button" disabled={!isConfigured || submitting} type="submit">
              {submitting ? 'Working...' : mode === 'magic' ? 'Send magic link' : 'Continue'}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
