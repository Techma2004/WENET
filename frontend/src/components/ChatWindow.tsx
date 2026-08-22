import { FormEvent, useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth';
import { useChat } from '../lib/chatStore';
import { getSocket } from '../lib/socket';
import Avatar from './Avatar';

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function ChatWindow({ onBack }: { onBack: () => void }) {
  const { user, privateJwk } = useAuth();
  const { activeChat, messagesByRoom, sendDirectMessage, sendGroupMessage, typingUserIds, getGroupKey } = useChat();
  const [text, setText] = useState('');
  const [hasGroupKey, setHasGroupKey] = useState(true);
  const [sendError, setSendError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const roomId = activeChat ? (activeChat.type === 'dm' ? [user?.id, activeChat.peer.id].sort().join('_') : activeChat.group.id) : '';
  const messages = messagesByRoom[roomId] || [];
  const peerTyping = activeChat?.type === 'dm' ? typingUserIds.has(activeChat.peer.id) : false;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, peerTyping]);

  useEffect(() => {
    if (activeChat?.type !== 'group') {
      setHasGroupKey(true);
      return;
    }
    let cancelled = false;
    getGroupKey(activeChat.group.id).then((key) => {
      if (cancelled) return;
      setHasGroupKey(!!key);
      if (!key) getSocket()?.emit('client:request_group_key', { groupId: activeChat.group.id });
    });
    return () => {
      cancelled = true;
    };
  }, [activeChat?.type === 'group' ? activeChat.group.id : null]);

  const emitTyping = (isTyping: boolean) => {
    if (activeChat?.type !== 'dm') return;
    getSocket()?.emit('client:typing', { roomId, isTyping });
  };

  const onChangeText = (value: string) => {
    setText(value);
    emitTyping(true);
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => emitTyping(false), 1200);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || !user || !activeChat) return;
    const socket = getSocket();
    if (!socket) return;
    const value = text;
    setText('');
    setSendError('');
    emitTyping(false);

    try {
      if (activeChat.type === 'dm') {
        if (!privateJwk) return;
        await sendDirectMessage({
          peer: activeChat.peer,
          myUserId: user.id,
          myPrivateJwk: privateJwk,
          text: value,
          emit: (event, data, cb) => socket.emit(event, data, cb)
        });
      } else {
        await sendGroupMessage({
          group: activeChat.group,
          myUserId: user.id,
          text: value,
          emit: (event, data, cb) => socket.emit(event, data, cb)
        });
      }
    } catch (err: any) {
      setSendError(err.message || 'Could not send message');
      setText(value);
    }
  };

  if (!activeChat) return null;

  const headerName = activeChat.type === 'dm' ? activeChat.peer.displayName : activeChat.group.name;
  const headerAvatarUrl = activeChat.type === 'dm' ? activeChat.peer.avatarUrl : activeChat.group.avatarUrl;
  const headerOnline = activeChat.type === 'dm' ? activeChat.peer.isOnline : undefined;
  const headerStatus =
    activeChat.type === 'dm'
      ? peerTyping
        ? 'typing…'
        : activeChat.peer.isOnline
        ? 'online'
        : 'offline'
      : `${activeChat.group.members.length} members`;

  return (
    <div className="chat-window">
      <div className="chat-header">
        <button className="ghost-btn back-btn" onClick={onBack} aria-label="Back to conversations">
          ←
        </button>
        <Avatar name={headerName} url={headerAvatarUrl} online={headerOnline} />
        <div>
          <div className="chat-header-name">{headerName}</div>
          <div className="chat-header-status">{headerStatus}</div>
        </div>
      </div>

      <div className="message-list">
        {activeChat.type === 'dm' && !privateJwk && (
          <div className="message-list-warning">
            No local encryption key found for your account — messages sent from here can't be decrypted by this browser.
          </div>
        )}
        {activeChat.type === 'group' && !hasGroupKey && (
          <div className="message-list-warning">
            Waiting for another online group member to share the encryption key. You can still type — it'll send once the
            key arrives.
          </div>
        )}
        {messages.map((m) => (
          <div key={m.clientMessageId} className={`bubble-row ${m.senderId === user?.id ? 'mine' : 'theirs'}`}>
            <div className="bubble">
              {activeChat.type === 'group' && m.senderId !== user?.id && (
                <span className="bubble-sender">{activeChat.group.members.find((mm) => mm.userId === m.senderId)?.user.displayName || 'Member'}</span>
              )}
              <span>{m.text || '[unable to decrypt]'}</span>
              <span className="bubble-time">{formatTime(m.createdAt)}</span>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {sendError && <div className="composer-error">{sendError}</div>}

      <form className="composer" onSubmit={submit}>
        <input value={text} onChange={(e) => onChangeText(e.target.value)} placeholder="Type a message" autoFocus />
        <button type="submit" className="primary-btn send-btn" disabled={!text.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
