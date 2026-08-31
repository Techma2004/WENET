import { useState } from 'react';
import { useAuth } from '../lib/auth';

export default function VerifyBanner() {
  const { user, resendVerification } = useAuth();
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (!user || user.emailVerified || dismissed) return null;

  async function handleResend() {
    setSending(true);
    try {
      await resendVerification();
      setSent(true);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="verify-banner" role="status">
      <span>
        {sent ? 'Verification email sent — check your inbox.' : `Verify ${user.email} to secure your account.`}
      </span>
      <div className="verify-banner-actions">
        {!sent && (
          <button className="link-btn" onClick={handleResend} disabled={sending}>
            {sending ? 'Sending…' : 'Resend email'}
          </button>
        )}
        <button className="ghost-btn ghost-btn-sm" onClick={() => setDismissed(true)} title="Dismiss">
          ✕
        </button>
      </div>
    </div>
  );
}
