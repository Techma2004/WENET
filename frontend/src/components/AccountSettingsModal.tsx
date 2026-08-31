import { FormEvent, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { enablePushNotifications, pushConfigured } from '../lib/push';
import Avatar from './Avatar';

type Tab = 'profile' | 'privacy' | 'notifications' | 'sessions' | 'data' | 'danger';

interface Device {
  id: string;
  label: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeen: string;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function AccountSettingsModal({ onClose }: { onClose: () => void }) {
  const { user, deleteAccount } = useAuth();
  const { push: toast } = useToast();
  const [tab, setTab] = useState<Tab>('profile');
  const dialogRef = useRef<HTMLDivElement>(null);

  // --- accessibility: trap focus + close on Escape while the modal is open ---
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>('button, input, a')?.focus();

    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, input, a, [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Account settings"
      >
        <div className="modal-header">
          <h2>Account settings</h2>
          <button className="ghost-btn" onClick={onClose} title="Close" aria-label="Close settings">
            ✕
          </button>
        </div>

        <div className="settings-tabs" role="tablist" aria-label="Settings sections">
          {(
            [
              ['profile', 'Profile'],
              ['privacy', 'Privacy'],
              ['notifications', 'Notifications'],
              ['sessions', 'Sessions'],
              ['data', 'Your data'],
              ['danger', 'Danger zone']
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              className={`settings-tab ${tab === key ? 'active' : ''}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="modal-body">
          {tab === 'profile' && (
            <div className="account-summary">
              <Avatar name={user?.displayName || ''} url={user?.avatarUrl} size={56} />
              <div>
                <div className="account-summary-name">{user?.displayName}</div>
                <div className="account-summary-sub">@{user?.username}</div>
                <div className="account-summary-sub">{user?.email}</div>
                <div className={`account-summary-sub ${user?.emailVerified ? 'verified' : 'unverified'}`}>
                  {user?.emailVerified ? '✓ Email verified' : 'Email not verified'}
                </div>
              </div>
            </div>
          )}

          {tab === 'privacy' && <PrivacyTab />}
          {tab === 'notifications' && <NotificationsTab toast={toast} />}
          {tab === 'sessions' && <SessionsTab toast={toast} />}
          {tab === 'data' && <DataTab toast={toast} />}
          {tab === 'danger' && <DangerTab deleteAccount={deleteAccount} username={user?.username} />}
        </div>
      </div>
    </div>
  );
}

function PrivacyTab() {
  const { user } = useAuth();
  const [showLastSeen, setShowLastSeen] = useState(user?.showLastSeen ?? true);
  const [showOnlineStatus, setShowOnlineStatus] = useState(user?.showOnlineStatus ?? true);
  const [readReceiptsEnabled, setReadReceiptsEnabled] = useState(user?.readReceiptsEnabled ?? true);
  const [saving, setSaving] = useState(false);

  async function save(patch: Record<string, boolean>) {
    setSaving(true);
    try {
      await api.patch('/api/auth/privacy', patch);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settings-section">
      <p className="settings-section-intro">Control what other people can see about your activity.</p>

      <label className="toggle-row">
        <div>
          <div className="toggle-row-title">Show last seen</div>
          <div className="toggle-row-sub">Others can see when you were last active</div>
        </div>
        <input
          type="checkbox"
          checked={showLastSeen}
          disabled={saving}
          onChange={(e) => {
            setShowLastSeen(e.target.checked);
            save({ showLastSeen: e.target.checked });
          }}
        />
      </label>

      <label className="toggle-row">
        <div>
          <div className="toggle-row-title">Show online status</div>
          <div className="toggle-row-sub">Others can see when you're currently online</div>
        </div>
        <input
          type="checkbox"
          checked={showOnlineStatus}
          disabled={saving}
          onChange={(e) => {
            setShowOnlineStatus(e.target.checked);
            save({ showOnlineStatus: e.target.checked });
          }}
        />
      </label>

      <label className="toggle-row">
        <div>
          <div className="toggle-row-title">Send read receipts</div>
          <div className="toggle-row-sub">Others see the double-check when you've read their message</div>
        </div>
        <input
          type="checkbox"
          checked={readReceiptsEnabled}
          disabled={saving}
          onChange={(e) => {
            setReadReceiptsEnabled(e.target.checked);
            save({ readReceiptsEnabled: e.target.checked });
          }}
        />
      </label>
    </div>
  );
}

function NotificationsTab({ toast }: { toast: (msg: string, kind?: 'error' | 'success' | 'info') => void }) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'granted' | 'denied' | 'unsupported' | 'error'>('idle');

  async function handleEnable() {
    setStatus('loading');
    const result = await enablePushNotifications();
    setStatus(result);
    if (result === 'granted') toast('Push notifications enabled on this device.', 'success');
    if (result === 'denied') toast('Notification permission was denied in your browser.', 'error');
    if (result === 'error') toast('Could not enable push notifications. Try again.', 'error');
  }

  if (!pushConfigured) {
    return (
      <div className="settings-section">
        <p className="settings-section-intro">
          Push notifications aren't configured for this deployment yet. An admin needs to add Firebase credentials
          (see <code>VITE_FIREBASE_*</code> in <code>.env.example</code>) to enable this.
        </p>
      </div>
    );
  }

  return (
    <div className="settings-section">
      <p className="settings-section-intro">
        Get notified when a new message arrives while WENET isn't open in this browser.
      </p>
      <button className="primary-btn" style={{ maxWidth: 260 }} onClick={handleEnable} disabled={status === 'loading' || status === 'granted'}>
        {status === 'loading' && <span className="btn-spinner" aria-hidden="true" />}
        {status === 'granted' && '✓ Enabled on this device'}
        {status !== 'loading' && status !== 'granted' && 'Enable push notifications'}
      </button>
    </div>
  );
}

function SessionsTab({ toast }: { toast: (msg: string, kind?: 'error' | 'success' | 'info') => void }) {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState(false);

  async function load() {
    setError(false);
    try {
      const res = await api.get<Device[]>('/api/devices');
      setDevices(res.data);
    } catch {
      setError(true);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function revoke(id: string) {
    try {
      await api.delete(`/api/devices/${id}`);
      setDevices((d) => d?.filter((dev) => dev.id !== id) ?? null);
      toast('Device removed.', 'success');
    } catch {
      toast('Could not remove that device.', 'error');
    }
  }

  return (
    <div className="settings-section">
      <p className="settings-section-intro">
        Devices registered to receive push notifications. Removing one stops notifications there — it doesn't log
        that device out (WENET doesn't track logged-in sessions beyond this).
      </p>
      {error && (
        <div className="empty-inline">
          Couldn't load your devices.{' '}
          <button className="link-btn" onClick={load}>
            Try again
          </button>
        </div>
      )}
      {!error && devices === null && <div className="skeleton skeleton-line" style={{ width: '100%', height: 40 }} />}
      {devices?.length === 0 && <div className="empty-inline">No devices registered for push notifications yet.</div>}
      {devices?.map((d) => (
        <div key={d.id} className="device-row">
          <div>
            <div className="toggle-row-title">{d.label || 'Unknown device'}</div>
            <div className="toggle-row-sub">Active {timeAgo(d.lastSeen)}</div>
          </div>
          <button className="ghost-btn ghost-btn-sm" onClick={() => revoke(d.id)}>
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}

function DataTab({ toast }: { toast: (msg: string, kind?: 'error' | 'success' | 'info') => void }) {
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      const res = await api.get('/api/auth/export');
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'wenet-data-export.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast('Could not export your data right now.', 'error');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="settings-section">
      <p className="settings-section-intro">
        Download a copy of what WENET's server holds about your account: your profile, contacts, group memberships,
        registered devices, and your sent messages. Message content is end-to-end encrypted ciphertext — the server
        can't read it either, so the export can't include plaintext of past conversations.
      </p>
      <button className="primary-btn" style={{ maxWidth: 220 }} onClick={handleExport} disabled={exporting}>
        {exporting ? <span className="btn-spinner" aria-hidden="true" /> : 'Download my data'}
      </button>
    </div>
  );
}

function DangerTab({ deleteAccount, username }: { deleteAccount: (password: string) => Promise<void>; username?: string }) {
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState('');
  const [typedUsername, setTypedUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (typedUsername !== username) {
      setError(`Type your username (${username}) exactly to confirm`);
      return;
    }
    setDeleting(true);
    try {
      await deleteAccount(password);
    } catch (err: any) {
      setError(err.message);
      setDeleting(false);
    }
  }

  return (
    <div className="danger-zone">
      <h3>Delete account</h3>
      <p>
        This permanently deletes your profile, contacts, group memberships, and blocks. Messages you've sent stay in
        place for the people you talked to, but your name and content on them are removed. This can't be undone.
      </p>

      {!confirming ? (
        <button className="danger-btn" onClick={() => setConfirming(true)}>
          Delete my account
        </button>
      ) : (
        <form onSubmit={handleDelete} className="danger-confirm-form">
          <label>
            Type <strong>{username}</strong> to confirm
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
  );
}
