import axios from 'axios';

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:10000';

export const api = axios.create({ baseURL: API_URL });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('wenet_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
