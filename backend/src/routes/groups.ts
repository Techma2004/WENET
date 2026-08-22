import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const router = Router();

interface AuthedRequest extends Request {
  userId?: string;
}

router.post('/', async (req: AuthedRequest, res: Response) => {
  const { name, description, memberIds } = req.body as { name: string; description?: string; memberIds: string[] };
  const userId = req.userId!;
  const group = await prisma.group.create({
    data: {
      name,
      description,
      createdBy: userId,
      members: {
        create: [{ userId, role: 'ADMIN' }, ...memberIds.map((id: string) => ({ userId: id, role: 'MEMBER' }))]
      }
    },
    include: {
      members: {
        include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true, isOnline: true, publicKey: true } } }
      }
    }
  });
  res.json(group);
});

router.get('/:id', async (req: AuthedRequest, res: Response) => {
  const group = await prisma.group.findFirst({
    where: { id: req.params.id, members: { some: { userId: req.userId } } },
    include: {
      members: {
        include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true, isOnline: true, publicKey: true } } }
      }
    }
  });
  if (!group) return res.status(404).json({ error: 'Not found' });
  res.json(group);
});

router.get('/', async (req: AuthedRequest, res: Response) => {
  const groups = await prisma.group.findMany({
    where: { members: { some: { userId: req.userId } } },
    include: {
      members: {
        include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true, isOnline: true, publicKey: true } } }
      },
      _count: { select: { members: true } }
    }
  });
  res.json(groups);
});

router.post('/:id/join', async (req: AuthedRequest, res: Response) => {
  const groupId = req.params.id;
  const userId = req.userId!;
  const m = await prisma.groupMember.upsert({
    where: { groupId_userId: { groupId, userId } },
    update: {},
    create: { groupId, userId }
  });
  res.json(m);
});

router.post('/:id/leave', async (req: AuthedRequest, res: Response) => {
  await prisma.groupMember.delete({ where: { groupId_userId: { groupId: req.params.id, userId: req.userId! } } });
  res.json({ ok: true });
});

export default router;
