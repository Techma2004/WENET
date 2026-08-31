import axios from 'axios';
import { useToast } from './toast';

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:10000';

export const api = axios.create({ baseURL: API_URL });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('wenet_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Centralized error surfacing: individual screens still handle validation
// errors inline (wrong password, taken username, etc.) by reading
// err.response.data.error themselves - this interceptor only steps in for
// the two cases no screen should have to handle one-by-one: total network
// loss, and unexpected server failures.
api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (!error.response) {
      useToast.getState().push("You're offline — check your connection.", 'error');
    } else if (error.response.status === 401) {
      // Session expired or invalid — clear it so the app falls back to the
      // login screen instead of silently failing every subsequent request.
      localStorage.removeItem('wenet_token');
    } else if (error.response.status >= 500) {
      useToast.getState().push('Something went wrong on our end. Please try again.', 'error');
    }
    return Promise.reject(error);
  }
);
