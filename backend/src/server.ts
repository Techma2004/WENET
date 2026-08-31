import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { PrismaClient } from '@prisma/client';
import cron from 'node-cron';

import { verifyJWT } from './utils/jwt';
import { sendFCM } from './utils/fcm';
import { isBlockedEitherWay, isGroupMember } from './utils/permissions';
import { generalLimiter, authLimiter } from './middleware/rateLimiter';
import { initSentry, captureException } from './utils/observability';
import { track, shutdownAnalytics } from './utils/analytics';

import authRoutes from './routes/auth';
import mediaRoutes from './routes/media';
import messageRoutes from './routes/messages';
import groupRoutes from './routes/groups';
import statusRoutes from './routes/status';
import contactRoutes from './routes/contacts';
import deviceRoutes from './routes/devices';

interface AuthedRequest extends Request {
  userId?: string;
}

initSentry();

const prisma = new PrismaClient();
const app = express();
app.set('trust proxy', 1); // Render sits behind a proxy - needed for express-rate-limit to see real client IPs

// Security headers (HSTS, no-sniff, frame-deny, etc.) — cheap to add,
// meaningfully reduces the attack surface for a service that handles
// auth tokens and (encrypted) personal messages.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

const allowedOrigins = (process.env.CORS_ORIGIN || '*')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: allowedOrigins.includes('*') ? true : allowedOrigins
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(generalLimiter);

app.get('/', (req: Request, res: Response) => res.send('WENET API alive'));
app.get('/health', async (req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', uptime: process.uptime() });
  } catch {
    res.status(500).json({ status: 'down' });
  }
});

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/media', mediaRoutes);

// JWT auth middleware for everything else
app.use((req: AuthedRequest, res: Response, next: NextFunction) => {
  if (req.path.startsWith('/api/auth') || req.path.startsWith('/api/media') || req.path === '/health' || req.path === '/') {
    return next();
  }
  const token = req.headers.authorization?.replace('Bearer ', '');
  const uid = token ? verifyJWT(token) : null;
  if (!uid) return res.status(401).json({ error: 'unauthorized' });
  req.userId = uid;
  next();
});

app.use('/api/messages', messageRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/status', statusRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/devices', deviceRoutes);

// Catch-all error handler: anything thrown or rejected inside a route that
// wasn't already caught locally lands here instead of hanging the request
// or leaking a stack trace to the client.
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  captureException(err, { path: req.path, method: req.method });
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Something went wrong on our end. Please try again.' });
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  transports: ['websocket'],
  pingInterval: 25000,
  pingTimeout: 20000,
  maxHttpBufferSize: 2e6,
  cors: {
    origin: allowedOrigins.includes('*') ? true : allowedOrigins
  }
});

io.use((socket: any, next) => {
  const token = socket.handshake.auth?.token;
  const uid = verifyJWT(token);
  if (!uid) return next(new Error('unauthorized'));
  socket.userId = uid;
  next();
});

io.on('connection', async (socket: any) => {
  const uid: string = socket.userId;
  const self = await prisma.user.update({ where: { id: uid }, data: { isOnline: true } });
  socket.join(`user:${uid}`);

  // join all of this user's groups
  const groups = await prisma.groupMember.findMany({ where: { userId: uid } });
  groups.forEach((g: { groupId: string }) => socket.join(`group:${g.groupId}`));

  // flush pending 1:1 messages
  const pending = await prisma.message.findMany({
    where: { recipientId: uid, deliveredAt: null },
    take: 100,
    orderBy: { createdAt: 'asc' }
  });
  if (pending.length) socket.emit('flush_messages', pending);

  // Respect the "show online status" privacy toggle: if it's off, other
  // users simply never learn this user came online in the first place.
  if (self.showOnlineStatus) {
    socket.broadcast.emit('server:presence', { userId: uid, isOnline: true });
  }

  socket.on('join_room', (roomId: string) => socket.join(roomId));

  // --- group encryption key exchange ---
  // A group's symmetric key is generated once by whoever creates it and
  // handed to each member individually, wrapped with that member's public
  // key (so only they can unwrap it). A member who doesn't have the key
  // yet (e.g. joined on a new device) asks the room; any online member
  // who already holds the key answers directly, wrapped for the asker.
  socket.on('client:request_group_key', ({ groupId }: { groupId: string }) => {
    if (!groupId) return;
    socket.to(`group:${groupId}`).emit('server:group_key_requested', { groupId, requesterId: uid });
  });

  socket.on(
    'client:share_group_key',
    ({ groupId, toUserId, wrappedKey, iv }: { groupId: string; toUserId: string; wrappedKey: string; iv: string }) => {
      if (!groupId || !toUserId) return;
      io.to(`user:${toUserId}`).emit('server:group_key', { groupId, fromUserId: uid, wrappedKey, iv });
    }
  );

  socket.on('client:delivery_ack', async ({ messageIds }: { messageIds: string[] }) => {
    if (!Array.isArray(messageIds)) return;
    await prisma.message.updateMany({ where: { id: { in: messageIds }, recipientId: uid }, data: { deliveredAt: new Date() } });
  });

  socket.on('client:read_ack', async ({ messageIds }: { messageIds: string[] }) => {
    // Whether *this* user's read status is shared with others is their own
    // privacy choice — messages are still marked read for badge/unread-count
    // purposes app-side via delivery, but we don't persist or broadcast a
    // read receipt if they've turned that off.
    const reader = await prisma.user.findUnique({ where: { id: uid }, select: { readReceiptsEnabled: true } });
    if (!reader?.readReceiptsEnabled) return;

    for (const mid of messageIds) {
      await prisma.messageRead.upsert({
        where: { messageId_userId: { messageId: mid, userId: uid } },
        update: { readAt: new Date() },
        create: { messageId: mid, userId: uid }
      });
    }
    socket.to(messageIds.map((id: string) => `msg:${id}`)).emit('server:read', { messageIds, userId: uid });
  });

  socket.on('client:send_message', async (data: any, cb: any) => {
    try {
      const { clientMessageId, recipientId, groupId, encryptedPayload, iv, replyToId, mediaUrl, mediaThumbUrl, mediaType } = data;

      const existing = await prisma.message.findUnique({ where: { clientMessageId } });
      if (existing) {
        cb?.({ ok: true, id: existing.id, dup: true });
        return;
      }

      // Permission checks: never silently allow a message into a group
      // you're not in, or across a block relationship either direction —
      // blocking is meant to stop delivery both ways, not just hide it.
      if (groupId) {
        if (!(await isGroupMember(groupId, uid))) {
          cb?.({ ok: false, error: 'not a member of this group' });
          return;
        }
      } else if (recipientId) {
        if (await isBlockedEitherWay(uid, recipientId)) {
          cb?.({ ok: false, error: 'blocked' });
          return;
        }
      } else {
        cb?.({ ok: false, error: 'recipientId or groupId is required' });
        return;
      }

      const roomId = groupId ? groupId : [uid, recipientId].sort().join('_');
      const msg = await prisma.message.create({
        data: {
          clientMessageId,
          roomId,
          senderId: uid,
          recipientId: groupId ? null : recipientId,
          groupId: groupId || null,
          encryptedPayload,
          iv,
          replyToId,
          mediaUrl,
          mediaThumbUrl,
          mediaType
        }
      });

      if (groupId) {
        io.to(`group:${groupId}`).emit('server:new_message', msg);
      } else {
        const recipientRoom = `user:${recipientId}`;
        const isOnline = io.sockets.adapter.rooms.has(recipientRoom);
        if (isOnline) io.to(recipientRoom).emit('server:new_message', msg);
        else sendFCM(recipientId, msg).catch(() => {});
        // echo back to sender's other devices
        io.to(`user:${uid}`).emit('server:new_message', msg);
      }

      track(uid, 'message_sent', { kind: groupId ? 'group' : 'direct', hasMedia: !!mediaUrl });
      cb?.({ ok: true, id: msg.id });
    } catch (e: any) {
      captureException(e, { event: 'client:send_message', userId: uid });
      cb?.({ ok: false, error: 'Message could not be sent. Please try again.' });
    }
  });

  socket.on('client:typing', ({ roomId, groupId, isTyping }: { roomId?: string; groupId?: string; isTyping: boolean }) => {
    if (groupId) socket.to(`group:${groupId}`).emit('server:typing', { userId: uid, groupId, isTyping });
    else if (roomId) socket.to(roomId).emit('server:typing', { userId: uid, roomId, isTyping });
  });

  socket.on('client:reaction', async ({ messageId, emoji }: { messageId: string; emoji: string }) => {
    const r = await prisma.reaction.upsert({
      where: { messageId_userId_emoji: { messageId, userId: uid, emoji } },
      update: {},
      create: { messageId, userId: uid, emoji }
    });
    io.emit('server:reaction', r);
  });

  socket.on('client:delete_reaction', async ({ messageId, emoji }: { messageId: string; emoji: string }) => {
    await prisma.reaction.delete({ where: { messageId_userId_emoji: { messageId, userId: uid, emoji } } });
    io.emit('server:reaction_removed', { messageId, userId: uid, emoji });
  });

  socket.on('disconnect', async () => {
    const updated = await prisma.user.update({ where: { id: uid }, data: { isOnline: false, lastSeen: new Date() } });
    if (updated.showOnlineStatus) {
      socket.broadcast.emit('server:presence', {
        userId: uid,
        isOnline: false,
        lastSeen: updated.showLastSeen ? updated.lastSeen : undefined
      });
    }
  });
});

// nightly cleanup: delivered messages older than 7 days, expired statuses
cron.schedule('0 3 * * *', async () => {
  try {
    const r = await prisma.message.deleteMany({ where: { deliveredAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } });
    await prisma.status.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    console.log(`[CRON] cleanup done, removed ${r.count} messages`);
  } catch (e) {
    captureException(e, { job: 'nightly-cleanup' });
  }
});

const PORT = process.env.PORT || 10000;
httpServer.listen(PORT, () => console.log(`WENET listening on ${PORT}`));

// --- stability: don't let one bad request/promise take the whole process down ---
process.on('unhandledRejection', (err) => captureException(err));
process.on('uncaughtException', (err) => captureException(err));

async function shutdown(signal: string) {
  console.log(`[${signal}] shutting down gracefully`);
  httpServer.close(() => console.log('http server closed'));
  await prisma.$disconnect();
  await shutdownAnalytics();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
