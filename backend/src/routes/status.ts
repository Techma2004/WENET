import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const router = Router();

interface AuthedRequest extends Request {
  userId?: string;
}

router.post('/', async (req: AuthedRequest, res: Response) => {
  const { mediaUrl, mediaType, caption } = req.body;
  const status = await prisma.status.create({
    data: {
      userId: req.userId!,
      mediaUrl,
      mediaType,
      caption,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
    }
  });
  res.json(status);
});

router.get('/', async (req: AuthedRequest, res: Response) => {
  // get contacts' statuses (plus your own)
  const contacts = await prisma.contact.findMany({ where: { ownerId: req.userId } });
  const ids = [req.userId!, ...contacts.map((c: { contactId: string }) => c.contactId)];
  const statuses = await prisma.status.findMany({
    where: { userId: { in: ids }, expiresAt: { gt: new Date() } },
    include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true } } },
    orderBy: { createdAt: 'desc' }
  });
  res.json(statuses);
});

export default router;
