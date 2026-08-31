import { useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import Avatar from './Avatar';

export default function OnboardingScreen({ onDone }: { onDone: () => void }) {
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [finishing, setFinishing] = useState(false);

  async function finish() {
    setFinishing(true);
    try {
      await api.post('/api/auth/onboarded');
    } finally {
      onDone();
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card onboarding-card">
        {step === 0 && (
          <>
            <div className="brand">
              <div className="brand-mark">W</div>
              <div>
                <h1>Welcome, {user?.displayName?.split(' ')[0]}</h1>
                <p>A quick look before you dive in.</p>
              </div>
            </div>
            <div className="onboarding-body">
              <Avatar name={user?.displayName || ''} url={user?.avatarUrl} size={72} />
              <ul className="onboarding-points">
                <li>Messages are end-to-end encrypted between you and whoever you're talking to.</li>
                <li>Your encryption key lives only on this device — logging in elsewhere starts a fresh key.</li>
                <li>Search a username to start a chat, or create a group from the sidebar.</li>
              </ul>
            </div>
            <button className="primary-btn" onClick={() => setStep(1)}>
              Continue
            </button>
          </>
        )}
        {step === 1 && (
          <>
            <div className="brand">
              <div className="brand-mark">W</div>
              <div>
                <h1>You're set up</h1>
                <p>You can change your privacy and notification settings anytime from your avatar in the sidebar.</p>
              </div>
            </div>
            <button className="primary-btn" onClick={finish} disabled={finishing}>
              {finishing ? <span className="btn-spinner" aria-hidden="true" /> : 'Start messaging'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
