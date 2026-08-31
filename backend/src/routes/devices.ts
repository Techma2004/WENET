import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const router = Router();

interface AuthedRequest extends Request {
  userId?: string;
}

// "Sessions" here are really push-notification device registrations, since
// auth itself is a stateless 30-day JWT with no server-side session table.
// Revoking one stops push delivery to that device; it does NOT invalidate
// whatever JWT is already sitting in that device's browser storage — a
// genuine limitation of the current auth design, called out here rather
// than implied away. A real fix would move to short-lived access tokens +
// a revocable refresh-token table.
router.post('/register', async (req: AuthedRequest, res: Response) => {
  const { fcmToken, label, userAgent } = req.body as { fcmToken?: string; label?: string; userAgent?: string };
  if (!fcmToken) return res.status(400).json({ error: 'fcmToken is required' });

  const existing = await prisma.device.findFirst({ where: { userId: req.userId!, fcmToken } });
  if (existing) {
    const device = await prisma.device.update({
      where: { id: existing.id },
      data: { label, userAgent, lastSeen: new Date() }
    });
    return res.json(device);
  }
  const device = await prisma.device.create({
    data: { userId: req.userId!, fcmToken, label, userAgent }
  });
  res.json(device);
});

router.get('/', async (req: AuthedRequest, res: Response) => {
  const devices = await prisma.device.findMany({
    where: { userId: req.userId },
    orderBy: { lastSeen: 'desc' },
    select: { id: true, label: true, userAgent: true, createdAt: true, lastSeen: true }
  });
  res.json(devices);
});

router.delete('/:id', async (req: AuthedRequest, res: Response) => {
  const device = await prisma.device.findUnique({ where: { id: req.params.id } });
  if (!device || device.userId !== req.userId) return res.status(404).json({ error: 'Not found' });
  await prisma.device.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

export default router;
