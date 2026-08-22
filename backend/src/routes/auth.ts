import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { signToken, verifyJWT } from '../utils/jwt';

const prisma = new PrismaClient();
const router = Router();

interface AuthedRequest extends Request {
  userId?: string;
}

// This router is mounted before the app-wide auth middleware (so /register
// and /login can be reached without a token). Everything below except
// /register and /login needs its own auth check, otherwise usernames,
// public keys and phone-lookup would be readable by anyone, logged in or
// not.
function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const uid = token ? verifyJWT(token) : null;
  if (!uid) return res.status(401).json({ error: 'unauthorized' });
  req.userId = uid;
  next();
}

const registerSchema = z.object({
  username: z.string().min(3).max(20).regex(/^[a-z0-9_]+$/),
  displayName: z.string().min(1).max(30),
  phone: z.string().min(7),
  publicKey: z.string(),
  password: z.string().min(6),
  bio: z.string().optional()
});

const loginSchema = z.object({
  username: z.string(),
  password: z.string()
});

function hashPhone(phone: string) {
  return crypto.createHash('sha256').update((process.env.JWT_SECRET || '') + phone).digest('hex');
}

router.post('/register', async (req: Request, res: Response) => {
  try {
    const data = registerSchema.parse(req.body);
    const phoneHash = hashPhone(data.phone);

    const exists = await prisma.user.findFirst({ where: { OR: [{ username: data.username }, { phoneHash }] } });
    if (exists) return res.status(400).json({ error: 'User exists' });

    const passwordHash = await bcrypt.hash(data.password, 10);
    const user = await prisma.user.create({
      data: {
        username: data.username,
        displayName: data.displayName,
        phoneHash,
        passwordHash,
        publicKey: data.publicKey,
        bio: data.bio
      }
    });

    const { passwordHash: _omit, ...safeUser } = user;
    res.json({ user: safeUser, token: signToken(user.id) });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) return res.status(404).json({ error: 'Not found' });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const { passwordHash: _omit, ...safeUser } = user;
    res.json({ user: safeUser, token: signToken(user.id) });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/search', requireAuth, async (req: AuthedRequest, res: Response) => {
  const q = ((req.query.q as string) || '').replace('@', '');
  if (!q) return res.json([]);
  const users = await prisma.user.findMany({
    where: { username: { contains: q, mode: 'insensitive' }, NOT: { id: req.userId } },
    take: 10,
    select: { id: true, username: true, displayName: true, avatarUrl: true, bio: true, isOnline: true, lastSeen: true, publicKey: true }
  });
  res.json(users);
});

// Find someone by their exact phone number (the number itself is never
// stored - only a keyed hash of it - so this re-hashes the input the same
// way registration does and compares hashes, rather than doing a lookup
// against plaintext numbers).
router.post('/lookup-phone', requireAuth, async (req: AuthedRequest, res: Response) => {
  const { phone } = req.body as { phone?: string };
  if (!phone) return res.status(400).json({ error: 'phone is required' });

  const phoneHash = hashPhone(phone);
  const user = await prisma.user.findFirst({
    where: { phoneHash, NOT: { id: req.userId } },
    select: { id: true, username: true, displayName: true, avatarUrl: true, bio: true, isOnline: true, lastSeen: true, publicKey: true }
  });
  if (!user) return res.status(404).json({ error: 'No WENET user with that number' });
  res.json(user);
});

router.get('/me', requireAuth, async (req: AuthedRequest, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) return res.status(404).json({ error: 'Not found' });
  const { passwordHash: _omit, ...safeUser } = user;
  res.json(safeUser);
});

// Public-ish profile lookup - used by the client to show a chat header/avatar
// when opening a conversation for the first time (e.g. from search results).
// Still requires auth: only logged-in users can resolve a profile.
router.get('/user/:id', requireAuth, async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: { id: true, username: true, displayName: true, avatarUrl: true, bio: true, isOnline: true, lastSeen: true, publicKey: true }
  });
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json(user);
});

export default router;
