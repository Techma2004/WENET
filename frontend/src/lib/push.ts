import { initializeApp, FirebaseApp } from 'firebase/app';
import { getMessaging, getToken, onMessage, isSupported, Messaging } from 'firebase/messaging';
import { api } from './api';
import { useToast } from './toast';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};
const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;

export const pushConfigured = !!(firebaseConfig.apiKey && firebaseConfig.projectId && vapidKey);

let app: FirebaseApp | null = null;
let messaging: Messaging | null = null;

async function ensureInit(): Promise<Messaging | null> {
  if (!pushConfigured) return null;
  if (messaging) return messaging;
  if (!(await isSupported())) return null; // Safari/older browsers, private-mode Firefox, etc.
  app = initializeApp(firebaseConfig);
  messaging = getMessaging(app);
  // Foreground messages (app open + focused) show as an in-app toast rather
  // than a system notification, since the OS won't show one for a page
  // that's already visible.
  onMessage(messaging, (payload) => {
    useToast.getState().push(payload.notification?.body || 'New message on WENET', 'info');
  });
  return messaging;
}

// Returns 'granted' | 'denied' | 'unsupported' | 'error' so the UI can show
// a precise reason rather than a generic failure.
export async function enablePushNotifications(): Promise<'granted' | 'denied' | 'unsupported' | 'error'> {
  try {
    const msg = await ensureInit();
    if (!msg) return 'unsupported';

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return 'denied';

    const token = await getToken(msg, { vapidKey });
    if (!token) return 'error';

    await api.post('/api/devices/register', {
      fcmToken: token,
      label: guessDeviceLabel(),
      userAgent: navigator.userAgent
    });
    return 'granted';
  } catch (err) {
    console.error('[push] failed to enable', err);
    return 'error';
  }
}

function guessDeviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iphone|ipad/i.test(ua)) return 'iPhone/iPad — ' + (navigator as any).platform;
  if (/android/i.test(ua)) return 'Android device';
  if (/mac/i.test(ua)) return 'Mac — browser';
  if (/win/i.test(ua)) return 'Windows — browser';
  return 'Browser';
}
