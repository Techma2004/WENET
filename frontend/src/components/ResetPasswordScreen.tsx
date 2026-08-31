import { FormEvent, useState } from 'react';
import { useAuth } from '../lib/auth';

export default function ResetPasswordScreen({ token }: { token: string }) {
  const { resetPassword } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }
    setStatus('loading');
    try {
      await resetPassword(token, password);
      setStatus('done');
    } catch (err: any) {
      setStatus('error');
      setError(err.message);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="brand">
          <div className="brand-mark">W</div>
          <div>
            <h1>WENET</h1>
            <p>Choose a new password</p>
          </div>
        </div>

        {status === 'done' ? (
          <div className="auth-form">
            <div className="auth-success" role="status">
              Your password has been reset. You can log in with it now.
            </div>
            <a href="/" className="primary-btn" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
              Go to log in
            </a>
          </div>
        ) : (
          <form onSubmit={submit} className="auth-form">
            <label>
              New password
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
            </label>
            <label>
              Confirm new password
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={8}
                required
              />
            </label>
            {error && (
              <div className="auth-error" role="alert">
                {error}
              </div>
            )}
            <button type="submit" className="primary-btn" disabled={status === 'loading'}>
              {status === 'loading' ? <span className="btn-spinner" aria-hidden="true" /> : 'Reset password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
