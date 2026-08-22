import { create } from 'zustand';
import { api } from './api';
import { useAuth } from './auth';
import {
  decryptText,
  decryptWithGroupKey,
  encryptText,
  encryptWithGroupKey,
  generateGroupKey,
  loadGroupKey,
  saveGroupKey,
  wrapGroupKeyForMember
} from './crypto';
import type { Conversation, Group, Message, User } from './types';

type ActiveChat = { type: 'dm'; peer: User } | { type: 'group'; group: Group } | null;

interface ChatState {
  conversations: Conversation[];
  groups: Group[];
  contacts: User[];
  messagesByRoom: Record<string, Message[]>;
  pendingGroupMessages: Record<string, Message[]>; // received before we had the key yet
  groupKeys: Map<string, CryptoKey>;
  activeChat: ActiveChat;
  typingUserIds: Set<string>;

  loadConversations: () => Promise<void>;
  loadGroups: () => Promise<void>;
  loadContacts: () => Promise<void>;
  addContact: (user: User) => Promise<void>;
  removeContact: (userId: string) => Promise<void>;
  openConversation: (peer: User) => Promise<void>;
  openGroup: (group: Group) => Promise<void>;
  closeChat: () => void;

  createGroup: (params: {
    name: string;
    members: User[];
    myUserId: string;
    myPrivateJwk: JsonWebKey;
    emit: (event: string, data: any) => void;
  }) => Promise<Group>;

  getGroupKey: (groupId: string) => Promise<CryptoKey | null>;
  setGroupKey: (groupId: string, key: CryptoKey) => Promise<void>;

  decryptAndStoreDM: (roomId: string, msg: Message, peer: User, myPrivateJwk: JsonWebKey) => Promise<void>;
  decryptAndStoreGroup: (groupId: string, msg: Message) => Promise<void>;

  upsertConversationFromMessage: (roomId: string, msg: Message, peer: User) => void;

  sendDirectMessage: (params: {
    peer: User;
    myUserId: string;
    myPrivateJwk: JsonWebKey;
    text: string;
    emit: (event: string, data: any, cb?: (r: any) => void) => void;
  }) => Promise<void>;

  sendGroupMessage: (params: {
    group: Group;
    myUserId: string;
    text: string;
    emit: (event: string, data: any, cb?: (r: any) => void) => void;
  }) => Promise<void>;

  setTyping: (userId: string, isTyping: boolean) => void;
}

export function roomIdFor(a: string, b: string) {
  return [a, b].sort().join('_');
}

export const useChat = create<ChatState>((set, get) => ({
  conversations: [],
  groups: [],
  contacts: [],
  messagesByRoom: {},
  pendingGroupMessages: {},
  groupKeys: new Map(),
  activeChat: null,
  typingUserIds: new Set(),

  loadConversations: async () => {
    const res = await api.get<Conversation[]>('/api/messages/conversations');
    set({ conversations: res.data });
  },

  loadGroups: async () => {
    const res = await api.get<Group[]>('/api/groups');
    set({ groups: res.data });
  },

  loadContacts: async () => {
    const res = await api.get<User[]>('/api/contacts');
    set({ contacts: res.data });
  },

  addContact: async (user: User) => {
    await api.post('/api/contacts', { contactId: user.id });
    set((state) => (state.contacts.some((c) => c.id === user.id) ? state : { contacts: [user, ...state.contacts] }));
  },

  removeContact: async (userId: string) => {
    await api.delete(`/api/contacts/${userId}`);
    set((state) => ({ contacts: state.contacts.filter((c) => c.id !== userId) }));
  },

  openConversation: async (peer: User) => {
    set({ activeChat: { type: 'dm', peer } });
    const { user, privateJwk } = useAuth.getState();
    if (!user || !privateJwk) return;

    const roomId = roomIdFor(user.id, peer.id);
    if (get().messagesByRoom[roomId]?.length) return;

    const res = await api.get<Message[]>('/api/messages', { params: { roomId } });
    const decrypted = await Promise.all(
      res.data.map(async (m) => {
        if (!peer.publicKey) return { ...m, text: '' };
        const text = await decryptText(privateJwk, peer.publicKey, m.encryptedPayload, m.iv);
        return { ...m, text };
      })
    );
    set((state) => ({ messagesByRoom: { ...state.messagesByRoom, [roomId]: decrypted } }));
  },

  openGroup: async (group: Group) => {
    set({ activeChat: { type: 'group', group } });
    const key = await get().getGroupKey(group.id);

    const res = await api.get<Message[]>('/api/messages', { params: { groupId: group.id } });
    if (!key) {
      set((state) => ({ pendingGroupMessages: { ...state.pendingGroupMessages, [group.id]: res.data } }));
      return;
    }

    const decrypted = await Promise.all(
      res.data.map(async (m) => ({ ...m, text: await decryptWithGroupKey(key, m.encryptedPayload, m.iv) }))
    );
    set((state) => ({ messagesByRoom: { ...state.messagesByRoom, [group.id]: decrypted } }));
  },

  closeChat: () => set({ activeChat: null }),

  createGroup: async ({ name, members, myUserId, myPrivateJwk, emit }) => {
    const res = await api.post<Group>('/api/groups', { name, memberIds: members.map((m) => m.id) });
    const group = res.data;

    const key = await generateGroupKey();
    await get().setGroupKey(group.id, key);

    for (const member of members) {
      if (!member.publicKey) continue;
      const { wrappedKey, iv } = await wrapGroupKeyForMember(myPrivateJwk, member.publicKey, key);
      emit('client:share_group_key', { groupId: group.id, toUserId: member.id, wrappedKey, iv });
    }

    set((state) => ({ groups: [group, ...state.groups] }));
    return group;
  },

  getGroupKey: async (groupId: string) => {
    const cached = get().groupKeys.get(groupId);
    if (cached) return cached;
    const stored = await loadGroupKey(groupId);
    if (stored) {
      set((state) => ({ groupKeys: new Map(state.groupKeys).set(groupId, stored) }));
      return stored;
    }
    return null;
  },

  setGroupKey: async (groupId: string, key: CryptoKey) => {
    await saveGroupKey(groupId, key);
    set((state) => ({ groupKeys: new Map(state.groupKeys).set(groupId, key) }));

    const pending = get().pendingGroupMessages[groupId];
    if (pending?.length) {
      const decrypted = await Promise.all(
        pending.map(async (m) => ({ ...m, text: await decryptWithGroupKey(key, m.encryptedPayload, m.iv) }))
      );
      set((state) => ({
        messagesByRoom: { ...state.messagesByRoom, [groupId]: decrypted },
        pendingGroupMessages: { ...state.pendingGroupMessages, [groupId]: [] }
      }));
    }
  },

  decryptAndStoreDM: async (roomId, msg, peer, myPrivateJwk) => {
    let text = '';
    if (peer.publicKey) text = await decryptText(myPrivateJwk, peer.publicKey, msg.encryptedPayload, msg.iv);
    set((state) => {
      const existing = state.messagesByRoom[roomId] || [];
      if (existing.some((m) => m.clientMessageId === msg.clientMessageId)) return state;
      return { messagesByRoom: { ...state.messagesByRoom, [roomId]: [...existing, { ...msg, text }] } };
    });
  },

  decryptAndStoreGroup: async (groupId, msg) => {
    const key = await get().getGroupKey(groupId);
    if (!key) {
      set((state) => ({
        pendingGroupMessages: { ...state.pendingGroupMessages, [groupId]: [...(state.pendingGroupMessages[groupId] || []), msg] }
      }));
      return;
    }
    const text = await decryptWithGroupKey(key, msg.encryptedPayload, msg.iv);
    set((state) => {
      const existing = state.messagesByRoom[groupId] || [];
      if (existing.some((m) => m.clientMessageId === msg.clientMessageId)) return state;
      return { messagesByRoom: { ...state.messagesByRoom, [groupId]: [...existing, { ...msg, text }] } };
    });
  },

  upsertConversationFromMessage: (roomId, msg, peer) => {
    set((state) => {
      const others = state.conversations.filter((c) => c.roomId !== roomId);
      return { conversations: [{ roomId, user: peer, lastMessage: msg }, ...others] };
    });
  },

  sendDirectMessage: async ({ peer, myUserId, myPrivateJwk, text, emit }) => {
    if (!peer.publicKey) throw new Error('Recipient has no public key yet');
    const roomId = roomIdFor(myUserId, peer.id);
    const { encryptedPayload, iv } = await encryptText(myPrivateJwk, peer.publicKey, text);
    const clientMessageId = crypto.randomUUID();

    const optimistic: Message = {
      id: clientMessageId,
      clientMessageId,
      roomId,
      senderId: myUserId,
      recipientId: peer.id,
      groupId: null,
      encryptedPayload,
      iv,
      isEdited: false,
      isDeleted: false,
      createdAt: new Date().toISOString(),
      text
    };

    set((state) => ({
      messagesByRoom: { ...state.messagesByRoom, [roomId]: [...(state.messagesByRoom[roomId] || []), optimistic] }
    }));
    get().upsertConversationFromMessage(roomId, optimistic, peer);

    emit('client:send_message', { clientMessageId, recipientId: peer.id, encryptedPayload, iv }, (ack: { ok: boolean; id?: string }) => {
      if (!ack?.ok) return;
      set((state) => ({
        messagesByRoom: {
          ...state.messagesByRoom,
          [roomId]: (state.messagesByRoom[roomId] || []).map((m) =>
            m.clientMessageId === clientMessageId && ack.id ? { ...m, id: ack.id } : m
          )
        }
      }));
    });
  },

  sendGroupMessage: async ({ group, myUserId, text, emit }) => {
    const key = await get().getGroupKey(group.id);
    if (!key) throw new Error('No group key yet - waiting for another member to share it');

    const { encryptedPayload, iv } = await encryptWithGroupKey(key, text);
    const clientMessageId = crypto.randomUUID();

    const optimistic: Message = {
      id: clientMessageId,
      clientMessageId,
      roomId: group.id,
      senderId: myUserId,
      recipientId: null,
      groupId: group.id,
      encryptedPayload,
      iv,
      isEdited: false,
      isDeleted: false,
      createdAt: new Date().toISOString(),
      text
    };

    set((state) => ({
      messagesByRoom: { ...state.messagesByRoom, [group.id]: [...(state.messagesByRoom[group.id] || []), optimistic] }
    }));

    emit('client:send_message', { clientMessageId, groupId: group.id, encryptedPayload, iv }, (ack: { ok: boolean; id?: string }) => {
      if (!ack?.ok) return;
      set((state) => ({
        messagesByRoom: {
          ...state.messagesByRoom,
          [group.id]: (state.messagesByRoom[group.id] || []).map((m) =>
            m.clientMessageId === clientMessageId && ack.id ? { ...m, id: ack.id } : m
          )
        }
      }));
    });
  },

  setTyping: (userId, isTyping) => {
    set((state) => {
      const next = new Set(state.typingUserIds);
      if (isTyping) next.add(userId);
      else next.delete(userId);
      return { typingUserIds: next };
    });
  }
}));
