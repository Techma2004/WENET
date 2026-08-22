import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { PrismaClient } from '@prisma/client';
import cron from 'node-cron';

import { verifyJWT } from './utils/jwt';
import { sendFCM } from './utils/fcm';
import { generalLimiter, authLimiter } from './middleware/rateLimiter';

import authRoutes from './routes/auth';
import mediaRoutes from './routes/media';
import messageRoutes from './routes/messages';
import groupRoutes from './routes/groups';
import statusRoutes from './routes/status';
import contactRoutes from './routes/contacts';

interface AuthedRequest extends Request {
  userId?: string;
}

const prisma = new PrismaClient();
const app = express();
app.set('trust proxy', 1); // Render sits behind a proxy - needed for express-rate-limit to see real client IPs

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
  await prisma.user.update({ where: { id: uid }, data: { isOnline: true } });
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

  socket.broadcast.emit('server:presence', { userId: uid, isOnline: true });

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

      cb?.({ ok: true, id: msg.id });
    } catch (e: any) {
      cb?.({ ok: false, error: e.message });
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
    await prisma.user.update({ where: { id: uid }, data: { isOnline: false, lastSeen: new Date() } });
    socket.broadcast.emit('server:presence', { userId: uid, isOnline: false, lastSeen: new Date() });
  });
});

// nightly cleanup: delivered messages older than 7 days, expired statuses
cron.schedule('0 3 * * *', async () => {
  const r = await prisma.message.deleteMany({ where: { deliveredAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } });
  await prisma.status.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  console.log(`[CRON] cleanup done, removed ${r.count} messages`);
});

const PORT = process.env.PORT || 10000;
httpServer.listen(PORT, () => console.log(`WENET listening on ${PORT}`));

// --- stability: don't let one bad request/promise take the whole process down ---
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));

async function shutdown(signal: string) {
  console.log(`[${signal}] shutting down gracefully`);
  httpServer.close(() => console.log('http server closed'));
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
