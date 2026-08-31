import { useEffect, useRef, useState } from 'react';
import { api } from './lib/api';
import { useAuth } from './lib/auth';
import { useChat } from './lib/chatStore';
import { useToast } from './lib/toast';
import { connectSocket, disconnectSocket } from './lib/socket';
import { unwrapGroupKey, wrapGroupKeyForMember } from './lib/crypto';
import { identify, resetAnalyticsIdentity, track } from './lib/analytics';
import AuthScreen from './components/AuthScreen';
import Sidebar from './components/Sidebar';
import ChatWindow from './components/ChatWindow';
import VerifyEmailScreen from './components/VerifyEmailScreen';
import ResetPasswordScreen from './components/ResetPasswordScreen';
import VerifyBanner from './components/VerifyBanner';
import OnboardingScreen from './components/OnboardingScreen';
import type { Message, User } from './lib/types';

type ConnState = 'connecting' | 'online' | 'offline';

// Small local cache so we don't refetch the same user profile repeatedly
// while messages / key requests stream in.
const peerCache = new Map<string, User>();
async function resolvePeer(userId: string): Promise<User | null> {
  if (peerCache.has(userId)) return peerCache.get(userId)!;
  try {
    const res = await api.get<User>(`/api/auth/user/${userId}`);
    peerCache.set(userId, res.data);
    return res.data;
  } catch {
    return null;
  }
}

export default function App() {
  const { user, token, privateJwk, restore } = useAuth();
  const {
    activeChat,
    closeChat,
    decryptAndStoreDM,
    decryptAndStoreGroup,
    upsertConversationFromMessage,
    setTyping,
    loadConversations,
    loadGroups,
    loadContacts,
    getGroupKey,
    setGroupKey
  } = useChat();
  const [restoring, setRestoring] = useState(true);
  const [connState, setConnState] = useState<ConnState>('connecting');
  const [browserOffline, setBrowserOffline] = useState(!navigator.onLine);
  const socketRef = useRef<ReturnType<typeof connectSocket> | null>(null);
  const wasOffline = useRef(false);
  const { push: toast } = useToast();

  useEffect(() => {
    restore().finally(() => setRestoring(false));
  }, []);

  // Network state: the browser's own online/offline events catch total
  // connectivity loss instantly (no need to wait for a socket timeout),
  // while the socket's connect/disconnect events catch the "technically
  // has wifi but can't reach our server" case.
  useEffect(() => {
    const goOnline = () => setBrowserOffline(false);
    const goOffline = () => setBrowserOffline(true);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  useEffect(() => {
    if (user) identify(user.id);
    else resetAnalyticsIdentity();
  }, [user?.id]);

  useEffect(() => {
    if (!token || !user) return;
    const socket = connectSocket(token);
    socketRef.current = socket;
    setConnState('connecting');

    socket.on('connect', () => {
      setConnState('online');
      if (wasOffline.current) {
        toast('Back online.', 'success');
        wasOffline.current = false;
      }
    });
    socket.on('disconnect', () => {
      setConnState('offline');
      wasOffline.current = true;
    });
    socket.on('connect_error', () => {
      setConnState('offline');
      wasOffline.current = true;
    });

    socket.on('flush_messages', async (msgs: Message[]) => {
      if (!privateJwk) return;
      for (const m of msgs) {
        const peerId = m.senderId === user.id ? m.recipientId! : m.senderId;
        const peer = await resolvePeer(peerId);
        if (peer) await decryptAndStoreDM(m.roomId, m, peer, privateJwk);
      }
      loadConversations();
    });

    socket.on('server:new_message', async (m: Message) => {
      if (!privateJwk) return;
      if (m.groupId) {
        await decryptAndStoreGroup(m.groupId, m);
        return;
      }
      const peerId = m.senderId === user.id ? m.recipientId! : m.senderId;
      const peer = await resolvePeer(peerId);
      if (peer) {
        await decryptAndStoreDM(m.roomId, m, peer, privateJwk);
        upsertConversationFromMessage(m.roomId, m, peer);
      }
    });

    socket.on('server:typing', ({ userId, isTyping }: { userId: string; isTyping: boolean }) => {
      setTyping(userId, isTyping);
    });

    // Someone in a group we're in is missing the key (new device, etc). If
    // we already hold it, hand them a copy wrapped just for them.
    socket.on('server:group_key_requested', async ({ groupId, requesterId }: { groupId: string; requesterId: string }) => {
      if (!privateJwk || requesterId === user.id) return;
      const key = await getGroupKey(groupId);
      if (!key) return;
      const requester = await resolvePeer(requesterId);
      if (!requester?.publicKey) return;
      const { wrappedKey, iv } = await wrapGroupKeyForMember(privateJwk, requester.publicKey, key);
      socket.emit('client:share_group_key', { groupId, toUserId: requesterId, wrappedKey, iv });
    });

    // Someone answered our key request (or shared it with us at group creation time).
    socket.on(
      'server:group_key',
      async ({ groupId, fromUserId, wrappedKey, iv }: { groupId: string; fromUserId: string; wrappedKey: string; iv: string }) => {
        if (!privateJwk) return;
        const existing = await getGroupKey(groupId);
        if (existing) return;
        const sender = await resolvePeer(fromUserId);
        if (!sender?.publicKey) return;
        try {
          const key = await unwrapGroupKey(privateJwk, sender.publicKey, wrappedKey, iv);
          await setGroupKey(groupId, key);
        } catch {
          // wrapped for someone else, or corrupted - ignore
        }
      }
    );

    loadConversations();
    loadGroups();
    loadContacts();

    return () => {
      disconnectSocket();
    };
  }, [token, user?.id]);

  if (restoring) {
    return (
      <div className="splash">
        <div className="splash-dot" />
      </div>
    );
  }

  // Standalone landing pages for the links sent by email — no auth needed,
  // and intentionally short-circuit before the login-gate check below.
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  if (path === '/verify-email' && params.get('token')) {
    return <VerifyEmailScreen token={params.get('token')!} />;
  }
  if (path === '/reset-password' && params.get('token')) {
    return <ResetPasswordScreen token={params.get('token')!} />;
  }

  if (!user || !token) {
    return <AuthScreen />;
  }

  if (!user.onboardedAt) {
    return (
      <OnboardingScreen
        onDone={() => {
          track('onboarding_completed');
          useAuth.setState((s) => (s.user ? { user: { ...s.user, onboardedAt: new Date().toISOString() } } : {}));
        }}
      />
    );
  }

  const showOfflineBanner = browserOffline || connState === 'offline';

  return (
    <div className={`app ${activeChat ? 'chat-open' : ''}`}>
      <Sidebar connState={connState} />
      <div className="chat-pane" id="main-content">
        {showOfflineBanner && (
          <div className="network-banner" role="status">
            <span className="status-dot" /> {browserOffline ? "You're offline" : 'Reconnecting…'}
          </div>
        )}
        <VerifyBanner />
        {activeChat ? (
          <ChatWindow onBack={closeChat} />
        ) : (
          <div className="empty-state">
            <div className="empty-state-mark">W</div>
            <p>Pick a conversation, search a username to start one, or create a group.</p>
          </div>
        )}
      </div>
    </div>
  );
}
