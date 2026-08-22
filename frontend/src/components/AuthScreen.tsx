import { FormEvent, useState } from 'react';
import { useAuth } from '../lib/auth';

export default function AuthScreen() {
  const { register, login, loading, error } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'register') {
      await register({ username, displayName, phone, password });
    } else {
      await login({ username, password });
    }
  };

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

        <div className="auth-tabs">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')} type="button">
            Log in
          </button>
          <button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')} type="button">
            Create account
          </button>
        </div>

        <form onSubmit={submit} className="auth-form">
          <label>
            Username
            <input value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} placeholder="jane_doe" required />
          </label>

          {mode === 'register' && (
            <>
              <label>
                Display name
                <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Jane Doe" required />
              </label>
              <label>
                Phone number
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+234 700 000 0000" required />
              </label>
            </>
          )}

          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" minLength={6} required />
          </label>

          {error && <div className="auth-error">{error}</div>}

          <button type="submit" className="primary-btn" disabled={loading}>
            {loading ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Log in'}
          </button>
        </form>

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
