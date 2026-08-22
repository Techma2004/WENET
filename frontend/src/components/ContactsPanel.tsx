import { FormEvent, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useChat } from '../lib/chatStore';
import type { User } from '../lib/types';
import Avatar from './Avatar';

export default function ContactsPanel() {
  const { user } = useAuth();
  const { contacts, addContact, removeContact, openConversation } = useChat();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<User[]>([]);
  const [phone, setPhone] = useState('');
  const [phoneResult, setPhoneResult] = useState<User | null>(null);
  const [phoneError, setPhoneError] = useState('');
  const [phoneBusy, setPhoneBusy] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      const res = await api.get<User[]>('/api/auth/search', { params: { q: query } });
      setResults(res.data.filter((u) => u.id !== user?.id));
    }, 250);
    return () => clearTimeout(handle);
  }, [query, user?.id]);

  const lookupPhone = async (e: FormEvent) => {
    e.preventDefault();
    if (!phone.trim()) return;
    setPhoneBusy(true);
    setPhoneError('');
    setPhoneResult(null);
    try {
      const res = await api.post<User>('/api/auth/lookup-phone', { phone: phone.trim() });
      setPhoneResult(res.data);
    } catch (err: any) {
      setPhoneError(err.response?.data?.error || 'No one found with that number');
    } finally {
      setPhoneBusy(false);
    }
  };

  const isSaved = (id: string) => contacts.some((c) => c.id === id);

  return (
    <div className="contacts-panel">
      <div className="contacts-section">
        <div className="contacts-section-title">Find by username</div>
        <input
          className="contacts-input"
          placeholder="Search by username"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {results.map((u) => (
          <ContactRow
            key={u.id}
            user={u}
            saved={isSaved(u.id)}
            onMessage={() => openConversation(u)}
            onAdd={() => addContact(u)}
            onRemove={() => removeContact(u.id)}
          />
        ))}
      </div>

      <div className="contacts-section">
        <div className="contacts-section-title">Find by phone number</div>
        <form className="contacts-phone-form" onSubmit={lookupPhone}>
          <input
            className="contacts-input"
            placeholder="+234 700 000 0000"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <button type="submit" className="primary-btn" disabled={phoneBusy || !phone.trim()}>
            {phoneBusy ? '…' : 'Find'}
          </button>
        </form>
        {phoneError && <div className="contacts-phone-error">{phoneError}</div>}
        {phoneResult && (
          <ContactRow
            user={phoneResult}
            saved={isSaved(phoneResult.id)}
            onMessage={() => openConversation(phoneResult)}
            onAdd={() => addContact(phoneResult)}
            onRemove={() => removeContact(phoneResult.id)}
          />
        )}
        <p className="contacts-phone-hint">
          Only works for someone who registered with that exact number — WENET never stores or shares plain phone
          numbers, so there's no way to browse by number, only to confirm an exact match.
        </p>
      </div>

      <div className="contacts-section">
        <div className="contacts-section-title">Your contacts</div>
        {contacts.length ? (
          contacts.map((u) => (
            <ContactRow key={u.id} user={u} saved onMessage={() => openConversation(u)} onRemove={() => removeContact(u.id)} />
          ))
        ) : (
          <div className="sidebar-empty">
            No saved contacts yet. Search above and tap "Add" to save someone you message often.
          </div>
        )}
      </div>
    </div>
  );
}

function ContactRow({
  user,
  saved,
  onMessage,
  onAdd,
  onRemove
}: {
  user: User;
  saved: boolean;
  onMessage: () => void;
  onAdd?: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="contact-row">
      <button className="contact-row-main" onClick={onMessage}>
        <Avatar name={user.displayName} url={user.avatarUrl} online={user.isOnline} size={38} />
        <div className="conversation-row-text">
          <div className="conversation-row-name">{user.displayName}</div>
          <div className="conversation-row-preview">@{user.username}</div>
        </div>
      </button>
      {saved ? (
        <button className="ghost-btn small-btn" onClick={onRemove} title="Remove contact">
          Remove
        </button>
      ) : (
        <button className="ghost-btn small-btn accent-text" onClick={onAdd} title="Save contact">
          Add
        </button>
      )}
    </div>
  );
}
