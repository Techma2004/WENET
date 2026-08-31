// Background push handler. Runs when the WENET tab isn't focused (or isn't
// open at all) — this is what lets a system-level notification appear.
//
// Service workers can't read Vite's import.meta.env, so this config is
// duplicated from your .env here. Firebase's client-side config values
// (unlike API secrets) are meant to be public — they identify your project,
// not authenticate a privileged caller — so hardcoding them in a file
// that ships to the browser is expected practice, not a leak.
//
// Fill in the same values you used for VITE_FIREBASE_* in frontend/.env.
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'REPLACE_WITH_VITE_FIREBASE_API_KEY',
  authDomain: 'REPLACE_WITH_VITE_FIREBASE_AUTH_DOMAIN',
  projectId: 'REPLACE_WITH_VITE_FIREBASE_PROJECT_ID',
  storageBucket: 'REPLACE_WITH_VITE_FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'REPLACE_WITH_VITE_FIREBASE_MESSAGING_SENDER_ID',
  appId: 'REPLACE_WITH_VITE_FIREBASE_APP_ID'
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  self.registration.showNotification(payload.notification?.title || 'WENET', {
    body: payload.notification?.body || 'You have a new message',
    icon: '/icon.png'
  });
});
