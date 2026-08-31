import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export default function VerifyEmailScreen({ token }: { token: string }) {
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .post('/api/auth/verify-email', { token })
      .then(() => !cancelled && setStatus('done'))
      .catch((e) => {
        if (cancelled) return;
        setError(e.response?.data?.error || 'Verification failed');
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="brand">
          <div className="brand-mark">W</div>
          <div>
            <h1>WENET</h1>
          </div>
        </div>

        <div className="auth-form">
          {status === 'loading' && <div className="auth-intro">Verifying your email…</div>}
          {status === 'done' && (
            <div className="auth-success" role="status">
              Your email is verified. You're all set.
            </div>
          )}
          {status === 'error' && (
            <div className="auth-error" role="alert">
              {error}
            </div>
          )}
          <a href="/" className="primary-btn" style={{ display: 'block', textAlign: 'center', textDecoration: 'none', marginTop: 16 }}>
            Go to WENET
          </a>
        </div>
      </div>
    </div>
  );
}
