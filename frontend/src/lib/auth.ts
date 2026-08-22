import { create } from 'zustand';
import { api } from './api';
import { generateKeyPair, loadPrivateKey, savePrivateKey } from './crypto';
import type { User } from './types';

interface AuthState {
  user: User | null;
  token: string | null;
  privateJwk: JsonWebKey | null;
  loading: boolean;
  error: string | null;
  register: (input: { username: string; displayName: string; phone: string; password: string }) => Promise<void>;
  login: (input: { username: string; password: string }) => Promise<void>;
  logout: () => void;
  restore: () => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  token: localStorage.getItem('wenet_token'),
  privateJwk: null,
  loading: false,
  error: null,

  register: async ({ username, displayName, phone, password }) => {
    set({ loading: true, error: null });
    try {
      const { publicKeyB64, privateJwk } = await generateKeyPair();
      const res = await api.post('/api/auth/register', {
        username,
        displayName,
        phone,
        password,
        publicKey: publicKeyB64
      });
      localStorage.setItem('wenet_token', res.data.token);
      savePrivateKey(res.data.user.id, privateJwk);
      set({ user: res.data.user, token: res.data.token, privateJwk, loading: false });
    } catch (e: any) {
      set({ error: e.response?.data?.error || 'Registration failed', loading: false });
      throw e;
    }
  },

  login: async ({ username, password }) => {
    set({ loading: true, error: null });
    try {
      const res = await api.post('/api/auth/login', { username, password });
      const privateJwk = loadPrivateKey(res.data.user.id);
      if (!privateJwk) {
        // Private key only ever lived in this browser. Without it we can't
        // decrypt past messages, but the account itself still works.
        set({
          error: 'This browser has no saved encryption key for this account. New messages can still be sent, but old ones may not decrypt here.',
          loading: false
        });
      }
      localStorage.setItem('wenet_token', res.data.token);
      set({ user: res.data.user, token: res.data.token, privateJwk, loading: false });
    } catch (e: any) {
      set({ error: e.response?.data?.error || 'Login failed', loading: false });
      throw e;
    }
  },

  logout: () => {
    localStorage.removeItem('wenet_token');
    set({ user: null, token: null, privateJwk: null });
  },

  restore: async () => {
    const token = localStorage.getItem('wenet_token');
    if (!token) return;
    set({ loading: true });
    try {
      const res = await api.get('/api/auth/me');
      const privateJwk = loadPrivateKey(res.data.id);
      set({ user: res.data, token, privateJwk, loading: false });
    } catch {
      localStorage.removeItem('wenet_token');
      set({ user: null, token: null, loading: false });
    }
  }
}));
