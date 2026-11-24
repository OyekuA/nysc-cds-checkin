import React, { useState } from 'react';
import { devSignIn, startGoogleSignIn } from '../lib/auth';
import { extractErrorMessage } from '../lib/format';

interface SignInBoxProps {
  title: string;
  description: string;
  nextPath?: string;
  googleConfigured: boolean;
  devAuthEnabled: boolean;
  defaultDevEmail?: string;
  error: string | null;
  notice?: string | null;
  onDevLoggedIn: () => Promise<void>;
}

export const SignInBox: React.FC<SignInBoxProps> = ({
  title,
  description,
  nextPath,
  googleConfigured,
  devAuthEnabled,
  defaultDevEmail = 'ada@gmail.com',
  error,
  notice,
  onDevLoggedIn,
}) => {
  const [busy, setBusy] = useState(false);
  const [devEmail, setDevEmail] = useState(defaultDevEmail);
  const [localError, setLocalError] = useState<string | null>(null);

  const displayError = localError || error;

  const handleGoogle = () => {
    if (busy) return;
    setLocalError(null);
    setBusy(true);
    startGoogleSignIn(nextPath);
  };

  const handleDevSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setLocalError(null);
    setBusy(true);
    try {
      await devSignIn(devEmail);
      await onDevLoggedIn();
    } catch (err) {
      setLocalError(extractErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="signin-box">
      <div className="signin-box__head">
        <h2>{title}</h2>
        <p className="muted">{description}</p>
      </div>

      {notice && <p className="notice-line">{notice}</p>}

      {displayError && (
        <div className="banner banner--error" role="alert">
          {displayError}
        </div>
      )}

      {googleConfigured && (
        <button
          type="button"
          className="btn btn--primary btn--full"
          onClick={handleGoogle}
          disabled={busy}
        >
          {busy ? 'Redirecting to Google...' : 'Continue with Google'}
        </button>
      )}

      {devAuthEnabled && (
        <form className="dev-login" onSubmit={handleDevSubmit}>
          <label className="field">
            <span>Local test sign-in</span>
            <input
              type="email"
              value={devEmail}
              onChange={(e) => setDevEmail(e.target.value)}
              placeholder="you@gmail.com"
              required
            />
          </label>
          <button type="submit" className="btn btn--secondary btn--full" disabled={busy}>
            Sign in locally
          </button>
        </form>
      )}
    </div>
  );
};
