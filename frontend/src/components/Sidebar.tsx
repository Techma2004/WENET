import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useChat } from '../lib/chatStore';
import { getSocket } from '../lib/socket';
import type { User } from '../lib/types';
import Avatar from './Avatar';
import NewGroupModal from './NewGroupModal';
import ContactsPanel from './ContactsPanel';
import AccountSettingsModal from './AccountSettingsModal';
import { ConversationListSkeleton } from './Skeletons';

const CONN_LABEL: Record<string, string> = {
  connecting: 'Connecting…',
  online: 'Online',
  offline: 'Offline — will retry'
};

export default function Sidebar({ connState }: { connState: 'connecting' | 'online' | 'offline' }) {
  const { user, logout } = useAuth();
  const { conversations, groups, openConversation, openGroup, activeChat, conversationsLoading, groupsLoading } = useChat();
  const [tab, setTab] = useState<'chats' | 'contacts' | 'groups'>('chats');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const res = await api.get<User[]>('/api/auth/search', { params: { q: query } });
        setResults(res.data.filter((u) => u.id !== user?.id));
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [query, user?.id]);

  const socket = getSocket();

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-me">
          <button className="avatar-btn" onClick={() => setShowSettings(true)} title="Account settings">
            <Avatar name={user?.displayName || ''} url={user?.avatarUrl} />
          </button>
          <div>
            <div className="sidebar-me-name">{user?.displayName}</div>
            <div className={`conn-pill conn-${connState}`}>{CONN_LABEL[connState]}</div>
          </div>
        </div>
        <div className="sidebar-header-actions">
          <button className="ghost-btn" onClick={() => setShowNewGroup(true)} title="New group">
            +
          </button>
          <button className="ghost-btn" onClick={logout} title="Log out">
            ⏻
          </button>
        </div>
      </div>

      <div className="sidebar-tabs">
        <button className={tab === 'chats' ? 'active' : ''} onClick={() => setTab('chats')}>
          Chats
        </button>
        <button className={tab === 'contacts' ? 'active' : ''} onClick={() => setTab('contacts')}>
          Contacts
        </button>
        <button className={tab === 'groups' ? 'active' : ''} onClick={() => setTab('groups')}>
          Groups
        </button>
      </div>

      {tab === 'chats' && (
        <div className="sidebar-search">
          <input placeholder="Search by username to start a chat" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      )}

      <div className="sidebar-list">
        {tab === 'contacts' ? (
          <ContactsPanel />
        ) : tab === 'chats' ? (
          query.trim() ? (
            searching ? (
              <ConversationListSkeleton count={3} />
            ) : results.length ? (
              results.map((u) => (
                <button key={u.id} className="conversation-row" onClick={() => openConversation(u)}>
                  <Avatar name={u.displayName} url={u.avatarUrl} online={u.isOnline} />
                  <div className="conversation-row-text">
                    <div className="conversation-row-name">{u.displayName}</div>
                    <div className="conversation-row-preview">@{u.username}</div>
                  </div>
                </button>
              ))
            ) : (
              <div className="sidebar-empty">No users found for "{query}"</div>
            )
          ) : conversationsLoading ? (
            <ConversationListSkeleton />
          ) : conversations.length ? (
            conversations.map((c) => (
              <button
                key={c.roomId}
                className={`conversation-row ${activeChat?.type === 'dm' && activeChat.peer.id === c.user.id ? 'active' : ''}`}
                onClick={() => openConversation(c.user)}
              >
                <Avatar name={c.user.displayName} url={c.user.avatarUrl} online={c.user.isOnline} />
                <div className="conversation-row-text">
                  <div className="conversation-row-name">{c.user.displayName}</div>
                  <div className="conversation-row-preview">{c.lastMessage.text || 'Encrypted message'}</div>
                </div>
              </button>
            ))
          ) : (
            <div className="sidebar-empty">No conversations yet. Search a username above to start one.</div>
          )
        ) : groupsLoading ? (
          <ConversationListSkeleton count={3} />
        ) : groups.length ? (
          groups.map((g) => (
            <button
              key={g.id}
              className={`conversation-row ${activeChat?.type === 'group' && activeChat.group.id === g.id ? 'active' : ''}`}
              onClick={() => openGroup(g)}
            >
              <Avatar name={g.name} url={g.avatarUrl} />
              <div className="conversation-row-text">
                <div className="conversation-row-name">{g.name}</div>
                <div className="conversation-row-preview">{g._count?.members ?? g.members.length} members</div>
              </div>
            </button>
          ))
        ) : (
          <div className="sidebar-empty">No groups yet. Tap + above to start one.</div>
        )}
      </div>

      {showNewGroup && socket && <NewGroupModal onClose={() => setShowNewGroup(false)} socket={socket} />}
      {showSettings && <AccountSettingsModal onClose={() => setShowSettings(false)} />}
    </aside>
  );
}
