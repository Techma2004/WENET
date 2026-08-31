import { FormEvent, useState } from 'react';
import { useAuth } from '../lib/auth';
import Avatar from './Avatar';

export default function AccountSettingsModal({ onClose }: { onClose: () => void }) {
  const { user, deleteAccount } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState('');
  const [typedUsername, setTypedUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (typedUsername !== user?.username) {
      setError(`Type your username (${user?.username}) exactly to confirm`);
      return;
    }
    setDeleting(true);
    try {
      await deleteAccount(password);
      // deleteAccount clears the session; App will fall back to AuthScreen.
    } catch (err: any) {
      setError(err.message);
      setDeleting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Account settings">
        <div className="modal-header">
          <h2>Account settings</h2>
          <button className="ghost-btn" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="account-summary">
            <Avatar name={user?.displayName || ''} url={user?.avatarUrl} size={56} />
            <div>
              <div className="account-summary-name">{user?.displayName}</div>
              <div className="account-summary-sub">@{user?.username}</div>
              <div className="account-summary-sub">{user?.email}</div>
            </div>
          </div>

          <div className="danger-zone">
            <h3>Delete account</h3>
            <p>
              This permanently deletes your profile, contacts, group memberships, and blocks. Messages you've sent
              stay in place for the people you talked to, but your name and content on them are removed. This
              can't be undone.
            </p>

            {!confirming ? (
              <button className="danger-btn" onClick={() => setConfirming(true)}>
                Delete my account
              </button>
            ) : (
              <form onSubmit={handleDelete} className="danger-confirm-form">
                <label>
                  Type <strong>{user?.username}</strong> to confirm
                  <input value={typedUsername} onChange={(e) => setTypedUsername(e.target.value)} autoFocus />
                </label>
                <label>
                  Enter your password
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                </label>
                {error && (
                  <div className="auth-error" role="alert">
                    {error}
                  </div>
                )}
                <div className="danger-confirm-actions">
                  <button type="button" className="ghost-btn" onClick={() => setConfirming(false)} disabled={deleting}>
                    Cancel
                  </button>
                  <button type="submit" className="danger-btn" disabled={deleting}>
                    {deleting ? <span className="btn-spinner" aria-hidden="true" /> : 'Permanently delete'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
