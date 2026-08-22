import admin from 'firebase-admin';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
let initialized = false;

function initFCM() {
  if (initialized) return;
  try {
    const raw = process.env.FCM_SERVICE_ACCOUNT_JSON;
    if (!raw) {
      console.log('[FCM] No service account configured, push disabled');
      return;
    }
    const creds = JSON.parse(raw);
    admin.initializeApp({ credential: admin.credential.cert(creds) });
    initialized = true;
    console.log('[FCM] Initialized');
  } catch (e) {
    console.error('[FCM] init failed', e);
  }
}

export async function sendFCM(userId: string, message: { id: string; encryptedPayload?: string }) {
  initFCM();
  if (!admin.apps.length) return;

  const devices = await prisma.device.findMany({ where: { userId } });
  const tokens = devices
    .map((d: { fcmToken: string | null }) => d.fcmToken)
    .filter((t: string | null): t is string => !!t);
  if (!tokens.length) return;

  try {
    await admin.messaging().sendEachForMulticast({
      tokens,
      notification: {
        title: 'New message',
        body: 'You have a new message on WENET'
      }
    });
  } catch (e) {
    console.error('[FCM] push failed', e);
  }
}
