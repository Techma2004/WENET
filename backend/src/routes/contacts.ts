import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const router = Router();

interface AuthedRequest extends Request {
  userId?: string;
}

const contactSelect = {
  id: true,
  contactId: true,
  contact: {
    select: { id: true, username: true, displayName: true, avatarUrl: true, bio: true, isOnline: true, lastSeen: true, publicKey: true }
  }
} as const;

// List saved contacts, most recently added first.
router.get('/', async (req: AuthedRequest, res: Response) => {
  const contacts = await prisma.contact.findMany({
    where: { ownerId: req.userId },
    orderBy: { createdAt: 'desc' },
    include: { contact: { select: { id: true, username: true, displayName: true, avatarUrl: true, bio: true, isOnline: true, lastSeen: true, publicKey: true } } }
  });
  res.json(contacts.map((c: { contact: unknown }) => c.contact));
});

// Save someone as a contact by their user id - the normal web flow: find
// them via username/phone search, then add.
router.post('/', async (req: AuthedRequest, res: Response) => {
  const { contactId } = req.body as { contactId?: string };
  if (!contactId) return res.status(400).json({ error: 'contactId is required' });
  if (contactId === req.userId) return res.status(400).json({ error: "You can't add yourself" });

  const target = await prisma.user.findUnique({ where: { id: contactId } });
  if (!target) return res.status(404).json({ error: 'User not found' });

  await prisma.contact.upsert({
    where: { ownerId_contactId: { ownerId: req.userId!, contactId } },
    update: {},
    create: { ownerId: req.userId!, contactId }
  });
  res.json({ id: target.id, username: target.username, displayName: target.displayName, avatarUrl: target.avatarUrl });
});

router.delete('/:contactId', async (req: AuthedRequest, res: Response) => {
  await prisma.contact.deleteMany({ where: { ownerId: req.userId, contactId: req.params.contactId } });
  res.json({ ok: true });
});

// Mobile-only: bulk-match a device's phone contacts against WENET users by
// hash, and auto-save any matches. Not used by the web client (browsers
// don't have access to a phone's contact list), kept for the Android app.
router.post('/sync', async (req: AuthedRequest, res: Response) => {
  const { hashes } = req.body as { hashes: string[] };
  if (!Array.isArray(hashes) || !hashes.length) return res.json([]);

  const matched = await prisma.user.findMany({
    where: { phoneHash: { in: hashes }, NOT: { id: req.userId } },
    select: { id: true, username: true, displayName: true, avatarUrl: true }
  });

  for (const u of matched) {
    await prisma.contact.upsert({
      where: { ownerId_contactId: { ownerId: req.userId!, contactId: u.id } },
      update: {},
      create: { ownerId: req.userId!, contactId: u.id }
    });
  }
  res.json(matched);
});

router.post('/block', async (req: AuthedRequest, res: Response) => {
  const { blockedId } = req.body as { blockedId?: string };
  if (!blockedId) return res.status(400).json({ error: 'blockedId is required' });

  const b = await prisma.block.upsert({
    where: { blockerId_blockedId: { blockerId: req.userId!, blockedId } },
    update: {},
    create: { blockerId: req.userId!, blockedId }
  });
  res.json(b);
});

router.delete('/block/:id', async (req: AuthedRequest, res: Response) => {
  await prisma.block.deleteMany({ where: { blockerId: req.userId, blockedId: req.params.id } });
  res.json({ ok: true });
});

export default router;
