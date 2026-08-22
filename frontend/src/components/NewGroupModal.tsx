import { useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useChat } from '../lib/chatStore';
import type { User } from '../lib/types';
import Avatar from './Avatar';

export default function NewGroupModal({ onClose, socket }: { onClose: () => void; socket: Socket }) {
  const { user, privateJwk } = useAuth();
  const { createGroup, openGroup } = useChat();
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<User[]>([]);
  const [selected, setSelected] = useState<User[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      const res = await api.get<User[]>('/api/auth/search', { params: { q: query } });
      setResults(res.data.filter((u) => u.id !== user?.id && !selected.some((s) => s.id === u.id)));
    }, 250);
    return () => clearTimeout(handle);
  }, [query, selected, user?.id]);

  const toggle = (u: User) => {
    setSelected((prev) => (prev.some((s) => s.id === u.id) ? prev.filter((s) => s.id !== u.id) : [...prev, u]));
    setQuery('');
  };

  const submit = async () => {
    if (!name.trim() || !selected.length || !user || !privateJwk) return;
    setBusy(true);
    setError('');
    try {
      const group = await createGroup({
        name: name.trim(),
        members: selected,
        myUserId: user.id,
        myPrivateJwk: privateJwk,
        emit: (event, data) => socket.emit(event, data)
      });
      await openGroup(group);
      onClose();
    } catch (e: any) {
      setError(e.response?.data?.error || 'Could not create group');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>New group</h2>

        <label className="modal-label">
          Group name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Weekend plans" autoFocus />
        </label>

        {selected.length > 0 && (
          <div className="chip-row">
            {selected.map((u) => (
              <button key={u.id} className="chip" onClick={() => toggle(u)}>
                {u.displayName} ✕
              </button>
            ))}
          </div>
        )}

        <label className="modal-label">
          Add members
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by username" />
        </label>

        {results.length > 0 && (
          <div className="modal-results">
            {results.map((u) => (
              <button key={u.id} className="conversation-row" onClick={() => toggle(u)}>
                <Avatar name={u.displayName} url={u.avatarUrl} size={36} />
                <div className="conversation-row-text">
                  <div className="conversation-row-name">{u.displayName}</div>
                  <div className="conversation-row-preview">@{u.username}</div>
                </div>
              </button>
            ))}
          </div>
        )}

        {error && <div className="auth-error">{error}</div>}

        <div className="modal-actions">
          <button className="ghost-btn text-btn" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="primary-btn" onClick={submit} disabled={busy || !name.trim() || !selected.length}>
            {busy ? 'Creating…' : `Create${selected.length ? ` (${selected.length})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
