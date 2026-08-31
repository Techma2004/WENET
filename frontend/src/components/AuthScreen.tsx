import { FormEvent, useState } from 'react';
import { useAuth } from '../lib/auth';

type Mode = 'login' | 'register' | 'forgot';

function PasswordStrengthHint({ password }: { password: string }) {
  if (!password) return null;
  const strong = password.length >= 8;
  return (
    <div className={`field-hint ${strong ? 'field-hint-ok' : 'field-hint-warn'}`}>
      {strong ? '✓ Meets the 8-character minimum' : 'At least 8 characters'}
    </div>
  );
}

export default function AuthScreen() {
  const { register, login, requestPasswordReset, loading, error, clearError } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotMessage, setForgotMessage] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  function switchMode(next: Mode) {
    setMode(next);
    setLocalError(null);
    setForgotMessage(null);
    clearError();
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (mode === 'forgot') {
      try {
        const message = await requestPasswordReset(forgotEmail.trim().toLowerCase());
        setForgotMessage(message);
      } catch (err: any) {
        setLocalError(err.message);
      }
      return;
    }

    if (mode === 'register') {
      if (password !== confirmPassword) {
        setLocalError("Passwords don't match");
        return;
      }
      if (!acceptedTerms) {
        setLocalError('You must accept the Terms and Privacy Policy to continue');
        return;
      }
      try {
        await register({ username, displayName, email: email.trim().toLowerCase(), phone, password, acceptedTerms });
      } catch {
        /* error already set in the store */
      }
    } else {
      try {
        await login({ username, password });
      } catch {
        /* error already set in the store */
      }
    }
  };

  const shownError = localError || error;

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="brand">
          <div className="brand-mark">W</div>
          <div>
            <h1>WENET</h1>
            <p>Messages stay encrypted between you and the person you're talking to.</p>
          </div>
        </div>

        {mode !== 'forgot' && (
          <div className="auth-tabs">
            <button className={mode === 'login' ? 'active' : ''} onClick={() => switchMode('login')} type="button">
              Log in
            </button>
            <button className={mode === 'register' ? 'active' : ''} onClick={() => switchMode('register')} type="button">
              Create account
            </button>
          </div>
        )}

        {mode === 'forgot' ? (
          <form onSubmit={submit} className="auth-form">
            <p className="auth-intro">Enter the email on your account and we'll send a reset link.</p>
            <label>
              Email address
              <input
                type="email"
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </label>

            {shownError && (
              <div className="auth-error" role="alert">
                {shownError}
              </div>
            )}
            {forgotMessage && (
              <div className="auth-success" role="status">
                {forgotMessage}
              </div>
            )}

            <button type="submit" className="primary-btn" disabled={loading}>
              {loading ? <span className="btn-spinner" aria-hidden="true" /> : 'Send reset link'}
            </button>
            <button type="button" className="link-btn" onClick={() => switchMode('login')}>
              Back to log in
            </button>
          </form>
        ) : (
          <form onSubmit={submit} className="auth-form">
            <label>
              Username <span className="required-mark">*</span>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                placeholder="jane_doe"
                autoComplete="username"
                required
              />
            </label>

            {mode === 'register' && (
              <>
                <label>
                  Display name <span className="required-mark">*</span>
                  <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Jane Doe" required />
                </label>
                <label>
                  Email address <span className="required-mark">*</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    required
                  />
                </label>
                <label>
                  Phone number <span className="required-mark">*</span>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+234 700 000 0000"
                    autoComplete="tel"
                    required
                  />
                </label>
              </>
            )}

            <label>
              Password <span className="required-mark">*</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                minLength={8}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                required
              />
            </label>
            {mode === 'register' && <PasswordStrengthHint password={password} />}

            {mode === 'register' && (
              <label>
                Confirm password <span className="required-mark">*</span>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  minLength={8}
                  autoComplete="new-password"
                  required
                />
              </label>
            )}

            {mode === 'login' && (
              <button type="button" className="link-btn link-btn-inline" onClick={() => switchMode('forgot')}>
                Forgot password?
              </button>
            )}

            {mode === 'register' && (
              <label className="checkbox-label">
                <input type="checkbox" checked={acceptedTerms} onChange={(e) => setAcceptedTerms(e.target.checked)} required />
                <span>
                  I agree to the <a href="/terms" target="_blank" rel="noreferrer">Terms of Service</a> and{' '}
                  <a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>
                  <span className="required-mark"> *</span>
                </span>
              </label>
            )}

            {shownError && (
              <div className="auth-error" role="alert">
                {shownError}
              </div>
            )}

            <button type="submit" className="primary-btn" disabled={loading}>
              {loading ? <span className="btn-spinner" aria-hidden="true" /> : mode === 'register' ? 'Create account' : 'Log in'}
            </button>
          </form>
        )}

        {mode === 'register' && (
          <p className="auth-footnote">
            Your encryption key is generated on this device and never leaves it. Logging in on a new device or browser
            won't show your older message history unless you carry that key over.
          </p>
        )}
      </div>
    </div>
  );
}
