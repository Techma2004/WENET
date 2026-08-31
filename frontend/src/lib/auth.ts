import { create } from 'zustand';
import { api } from './api';
import { generateKeyPair, loadPrivateKey, savePrivateKey } from './crypto';
import type { User } from './types';

function errorMessage(e: any, fallback: string) {
  return e?.response?.data?.error || fallback;
}

interface AuthState {
  user: User | null;
  token: string | null;
  privateJwk: JsonWebKey | null;
  loading: boolean;
  error: string | null;
  register: (input: {
    username: string;
    displayName: string;
    email: string;
    phone: string;
    password: string;
    acceptedTerms: boolean;
  }) => Promise<void>;
  login: (input: { username: string; password: string }) => Promise<void>;
  logout: () => void;
  restore: () => Promise<void>;
  clearError: () => void;
  resendVerification: () => Promise<{ ok: boolean; alreadyVerified?: boolean }>;
  requestPasswordReset: (email: string) => Promise<string>;
  resetPassword: (token: string, newPassword: string) => Promise<void>;
  deleteAccount: (password: string) => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  token: localStorage.getItem('wenet_token'),
  privateJwk: null,
  loading: false,
  error: null,

  clearError: () => set({ error: null }),

  register: async ({ username, displayName, email, phone, password, acceptedTerms }) => {
    set({ loading: true, error: null });
    try {
      const { publicKeyB64, privateJwk } = await generateKeyPair();
      const res = await api.post('/api/auth/register', {
        username,
        displayName,
        email,
        phone,
        password,
        acceptedTerms,
        publicKey: publicKeyB64
      });
      localStorage.setItem('wenet_token', res.data.token);
      savePrivateKey(res.data.user.id, privateJwk);
      set({ user: res.data.user, token: res.data.token, privateJwk, loading: false });
    } catch (e: any) {
      set({ error: errorMessage(e, 'Registration failed'), loading: false });
      throw e;
    }
  },

  login: async ({ username, password }) => {
    set({ loading: true, error: null });
    try {
      const res = await api.post('/api/auth/login', { username, password });
      const privateJwk = loadPrivateKey(res.data.user.id);
      localStorage.setItem('wenet_token', res.data.token);
      if (!privateJwk) {
        // Private key only ever lived in this browser. Without it we can't
        // decrypt past messages, but the account itself still works.
        set({
          user: res.data.user,
          token: res.data.token,
          privateJwk: null,
          error:
            'This browser has no saved encryption key for this account. New messages can still be sent, but old ones may not decrypt here.',
          loading: false
        });
        return;
      }
      set({ user: res.data.user, token: res.data.token, privateJwk, loading: false });
    } catch (e: any) {
      set({ error: errorMessage(e, 'Login failed'), loading: false });
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
  },

  resendVerification: async () => {
    const res = await api.post('/api/auth/resend-verification');
    return res.data;
  },

  requestPasswordReset: async (email: string) => {
    try {
      const res = await api.post('/api/auth/forgot-password', { email });
      return res.data.message as string;
    } catch (e: any) {
      throw new Error(errorMessage(e, 'Something went wrong. Try again.'));
    }
  },

  resetPassword: async (token: string, newPassword: string) => {
    try {
      await api.post('/api/auth/reset-password', { token, newPassword });
    } catch (e: any) {
      throw new Error(errorMessage(e, 'Reset failed'));
    }
  },

  deleteAccount: async (password: string) => {
    try {
      await api.delete('/api/auth/account', { data: { password } });
      localStorage.removeItem('wenet_token');
      set({ user: null, token: null, privateJwk: null });
    } catch (e: any) {
      throw new Error(errorMessage(e, 'Account deletion failed'));
    }
  }
}));
