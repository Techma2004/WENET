import { Router, Request, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();
const router = Router();

interface AuthedRequest extends Request {
  userId?: string;
}

// REST fallback for pending (undelivered) messages - useful as a backup to the
// socket 'flush_messages' event on reconnect over an unstable network.
router.get('/pending', async (req: AuthedRequest, res: Response) => {
  const userId = req.userId;
  const { roomId } = req.query;
  const msgs = await prisma.message.findMany({
    where: { recipientId: userId, deliveredAt: null, ...(roomId ? { roomId: roomId as string } : {}) },
    orderBy: { createdAt: 'asc' },
    take: 100
  });
  res.json(msgs);
});

// One row per 1:1 conversation the user is in, newest message first.
// The web/mobile client uses this to render the chat list (WhatsApp-style)
// without having to fetch full message history for every contact up front.
router.get('/conversations', async (req: AuthedRequest, res: Response) => {
  const uid = req.userId!;
  const msgs = await prisma.message.findMany({
    where: { OR: [{ senderId: uid }, { recipientId: uid }], groupId: null },
    orderBy: { createdAt: 'desc' }
  });

  const latestByRoom = new Map<string, (typeof msgs)[number]>();
  for (const m of msgs) {
    if (!latestByRoom.has(m.roomId)) latestByRoom.set(m.roomId, m);
  }

  const roomIds = [...latestByRoom.keys()];
  const otherIds = roomIds
    .map((rid) => rid.split('_').find((id) => id !== uid))
    .filter((id): id is string => !!id);

  const users = await prisma.user.findMany({
    where: { id: { in: otherIds } },
    select: { id: true, username: true, displayName: true, avatarUrl: true, isOnline: true, lastSeen: true, publicKey: true }
  });
  const userById = new Map(users.map((u: { id: string }) => [u.id, u]));

  const conversations = roomIds
    .map((rid) => {
      const otherId = rid.split('_').find((id) => id !== uid);
      const user = otherId ? userById.get(otherId) : undefined;
      if (!user) return null;
      return { roomId: rid, user, lastMessage: latestByRoom.get(rid) };
    })
    .filter(Boolean);

  res.json(conversations);
});

router.get('/', async (req: Request, res: Response) => {
  const { roomId, groupId, limit = '50', cursor } = req.query;
  const where: Prisma.MessageWhereInput = { isDeleted: false };
  if (roomId) where.roomId = roomId as string;
  if (groupId) where.groupId = groupId as string;

  const msgs = await prisma.message.findMany({
    where,
    take: parseInt(limit as string, 10),
    orderBy: { createdAt: 'desc' },
    ...(cursor ? { cursor: { id: cursor as string }, skip: 1 } : {}),
    include: { readBy: true, reactions: true }
  });
  res.json(msgs.reverse());
});

router.delete('/:id', async (req: AuthedRequest, res: Response) => {
  const existing = await prisma.message.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.senderId !== req.userId) return res.status(403).json({ error: 'not allowed' });

  const msg = await prisma.message.update({
    where: { id: req.params.id },
    data: { isDeleted: true, encryptedPayload: 'This message was deleted' }
  });
  res.json(msg);
});

router.put('/:id', async (req: AuthedRequest, res: Response) => {
  const { encryptedPayload } = req.body;
  const existing = await prisma.message.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.senderId !== req.userId) return res.status(403).json({ error: 'not allowed' });

  const msg = await prisma.message.update({
    where: { id: req.params.id },
    data: { encryptedPayload, isEdited: true }
  });
  res.json(msg);
});

export default router;
