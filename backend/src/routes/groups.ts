import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { getGroupRole } from '../utils/permissions';

const prisma = new PrismaClient();
const router = Router();

interface AuthedRequest extends Request {
  userId?: string;
}

const memberInclude = {
  members: {
    include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true, isOnline: true, publicKey: true } } }
  }
} as const;

router.post('/', async (req: AuthedRequest, res: Response) => {
  const { name, description, memberIds } = req.body as { name?: string; description?: string; memberIds?: string[] };
  const userId = req.userId!;

  if (!name?.trim()) return res.status(400).json({ error: 'Group name is required' });
  const ids = Array.isArray(memberIds) ? [...new Set(memberIds)].filter((id) => id !== userId) : [];

  const group = await prisma.group.create({
    data: {
      name: name.trim(),
      description,
      createdBy: userId,
      members: {
        create: [{ userId, role: 'ADMIN' }, ...ids.map((id: string) => ({ userId: id, role: 'MEMBER' }))]
      }
    },
    include: memberInclude
  });
  res.json(group);
});

router.get('/:id', async (req: AuthedRequest, res: Response) => {
  const group = await prisma.group.findFirst({
    where: { id: req.params.id, members: { some: { userId: req.userId } } },
    include: memberInclude
  });
  if (!group) return res.status(404).json({ error: 'Not found' });
  res.json(group);
});

router.get('/', async (req: AuthedRequest, res: Response) => {
  const groups = await prisma.group.findMany({
    where: { members: { some: { userId: req.userId } } },
    include: { ...memberInclude, _count: { select: { members: true } } }
  });
  res.json(groups);
});

// Edit group info (name/description/avatar) — admins only.
router.put('/:id', async (req: AuthedRequest, res: Response) => {
  const role = await getGroupRole(req.params.id, req.userId!);
  if (role !== 'ADMIN') return res.status(403).json({ error: 'Only group admins can edit group info' });

  const { name, description, avatarUrl } = req.body as { name?: string; description?: string; avatarUrl?: string };
  const group = await prisma.group.update({
    where: { id: req.params.id },
    data: {
      ...(name?.trim() ? { name: name.trim() } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(avatarUrl !== undefined ? { avatarUrl } : {})
    },
    include: memberInclude
  });
  res.json(group);
});

// Join a group via its invite link only — joining by raw group id (without
// knowing the invite code) is intentionally not supported, otherwise anyone
// who learns/guesses a group's id could join private groups uninvited.
router.post('/join/:inviteLink', async (req: AuthedRequest, res: Response) => {
  const userId = req.userId!;
  const group = await prisma.group.findUnique({ where: { inviteLink: req.params.inviteLink } });
  if (!group) return res.status(404).json({ error: 'Invalid or expired invite link' });

  const member = await prisma.groupMember.upsert({
    where: { groupId_userId: { groupId: group.id, userId } },
    update: {},
    create: { groupId: group.id, userId }
  });
  res.json({ member, group: { id: group.id, name: group.name } });
});

router.post('/:id/leave', async (req: AuthedRequest, res: Response) => {
  await prisma.groupMember.delete({ where: { groupId_userId: { groupId: req.params.id, userId: req.userId! } } });
  res.json({ ok: true });
});

// Remove a member — admins only, and admins can't remove themselves this way
// (use /leave for that), so a group is never left ownerless by accident.
router.post('/:id/members/:userId/remove', async (req: AuthedRequest, res: Response) => {
  const groupId = req.params.id;
  const targetId = req.params.userId;
  const requesterRole = await getGroupRole(groupId, req.userId!);
  if (requesterRole !== 'ADMIN') return res.status(403).json({ error: 'Only group admins can remove members' });
  if (targetId === req.userId) return res.status(400).json({ error: "Use 'leave' to remove yourself" });

  await prisma.groupMember.delete({ where: { groupId_userId: { groupId, userId: targetId } } });
  res.json({ ok: true });
});

// Promote/demote a member — admins only. Blocks demoting the last remaining
// admin, so every group always has at least one person who can moderate it.
router.post('/:id/members/:userId/role', async (req: AuthedRequest, res: Response) => {
  const groupId = req.params.id;
  const targetId = req.params.userId;
  const { role } = req.body as { role?: 'ADMIN' | 'MEMBER' };

  if (role !== 'ADMIN' && role !== 'MEMBER') return res.status(400).json({ error: "role must be 'ADMIN' or 'MEMBER'" });

  const requesterRole = await getGroupRole(groupId, req.userId!);
  if (requesterRole !== 'ADMIN') return res.status(403).json({ error: 'Only group admins can change roles' });

  if (role === 'MEMBER') {
    const adminCount = await prisma.groupMember.count({ where: { groupId, role: 'ADMIN' } });
    const target = await prisma.groupMember.findUnique({ where: { groupId_userId: { groupId, userId: targetId } } });
    if (adminCount <= 1 && target?.role === 'ADMIN') {
      return res.status(400).json({ error: 'A group needs at least one admin' });
    }
  }

  const member = await prisma.groupMember.update({
    where: { groupId_userId: { groupId, userId: targetId } },
    data: { role }
  });
  res.json(member);
});

export default router;
