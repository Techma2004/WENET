export interface User {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  emailVerified?: boolean;
  avatarUrl?: string | null;
  bio?: string | null;
  isOnline?: boolean;
  lastSeen?: string;
  publicKey?: string;
}

export interface Message {
  id: string;
  clientMessageId: string;
  roomId: string;
  senderId: string;
  recipientId: string | null;
  groupId: string | null;
  encryptedPayload: string;
  iv: string;
  mediaUrl?: string | null;
  mediaType?: string | null;
  isEdited: boolean;
  isDeleted: boolean;
  createdAt: string;
  deliveredAt?: string | null;
  // populated client-side after decryption, never sent over the wire
  text?: string;
}

export interface Conversation {
  roomId: string;
  user: User;
  lastMessage: Message;
}

export interface GroupMember {
  id: string;
  userId: string;
  role: string;
  user: User;
}

export interface Group {
  id: string;
  name: string;
  description?: string | null;
  avatarUrl?: string | null;
  createdBy: string;
  members: GroupMember[];
  _count?: { members: number };
}
