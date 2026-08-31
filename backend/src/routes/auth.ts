import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { signToken, verifyJWT } from '../utils/jwt';
import { sendVerificationEmail, sendPasswordResetEmail } from '../utils/email';
import { getBlockedUserIds } from '../utils/permissions';

const prisma = new PrismaClient();
const router = Router();

interface AuthedRequest extends Request {
  userId?: string;
}

// This router is mounted before the app-wide auth middleware (so /register
// and /login can be reached without a token). Everything below except
// /register, /login, /verify-email, and /forgot-password needs its own
// auth check, otherwise usernames, public keys and phone-lookup would be
// readable by anyone, logged in or not.
function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const uid = token ? verifyJWT(token) : null;
  if (!uid) return res.status(401).json({ error: 'unauthorized' });
  req.userId = uid;
  next();
}

// All fields here are compulsory by design — this is a messaging platform
// people trust with real contacts, so we don't allow half-filled accounts.
const registerSchema = z.object({
  username: z.string().min(3).max(20).regex(/^[a-z0-9_]+$/, 'Lowercase letters, numbers, and underscores only'),
  displayName: z.string().min(1).max(30),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  phone: z.string().min(7),
  publicKey: z.string(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  bio: z.string().optional(),
  acceptedTerms: z.literal(true, { errorMap: () => ({ message: 'You must accept the Terms and Privacy Policy' }) })
});

const loginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required')
});

const forgotPasswordSchema = z.object({ email: z.string().trim().toLowerCase().email() });
const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8, 'Password must be at least 8 characters')
});
const verifyEmailSchema = z.object({ token: z.string().min(1) });
const deleteAccountSchema = z.object({ password: z.string().min(1, 'Enter your password to confirm') });

function hashPhone(phone: string) {
  return crypto.createHash('sha256').update((process.env.JWT_SECRET || '') + phone).digest('hex');
}

function makeToken() {
  return crypto.randomBytes(32).toString('hex');
}

const publicUserSelect = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  bio: true,
  isOnline: true,
  lastSeen: true,
  publicKey: true
} as const;

router.post('/register', async (req: Request, res: Response) => {
  try {
    const data = registerSchema.parse(req.body);
    const phoneHash = hashPhone(data.phone);

    const exists = await prisma.user.findFirst({
      where: { OR: [{ username: data.username }, { phoneHash }, { email: data.email }] }
    });
    if (exists) return res.status(400).json({ error: 'That username, email, or phone number is already in use' });

    const passwordHash = await bcrypt.hash(data.password, 10);
    const emailVerifyToken = makeToken();
    const emailVerifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const user = await prisma.user.create({
      data: {
        username: data.username,
        displayName: data.displayName,
        email: data.email,
        phoneHash,
        passwordHash,
        publicKey: data.publicKey,
        bio: data.bio,
        emailVerifyToken,
        emailVerifyExpires
      }
    });

    sendVerificationEmail(user.email, emailVerifyToken, user.displayName).catch(() => {});

    const { passwordHash: _omit, emailVerifyToken: _t, ...safeUser } = user;
    res.json({ user: safeUser, token: signToken(user.id) });
  } catch (e: any) {
    res.status(400).json({ error: e.errors?.[0]?.message || e.message || 'Registration failed' });
  }
});

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) return res.status(404).json({ error: 'No account with that username' });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Incorrect password' });

    const { passwordHash: _omit, emailVerifyToken: _t, passwordResetToken: _r, ...safeUser } = user;
    res.json({ user: safeUser, token: signToken(user.id) });
  } catch (e: any) {
    res.status(400).json({ error: e.errors?.[0]?.message || e.message || 'Login failed' });
  }
});

// --- email verification -------------------------------------------------

router.post('/verify-email', async (req: Request, res: Response) => {
  try {
    const { token } = verifyEmailSchema.parse(req.body);
    const user = await prisma.user.findFirst({
      where: { emailVerifyToken: token, emailVerifyExpires: { gt: new Date() } }
    });
    if (!user) return res.status(400).json({ error: 'This verification link is invalid or has expired' });

    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true, emailVerifyToken: null, emailVerifyExpires: null }
    });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e.errors?.[0]?.message || 'Verification failed' });
  }
});

router.post('/resend-verification', requireAuth, async (req: AuthedRequest, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) return res.status(404).json({ error: 'Not found' });
  if (user.emailVerified) return res.json({ ok: true, alreadyVerified: true });

  const emailVerifyToken = makeToken();
  const emailVerifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await prisma.user.update({ where: { id: user.id }, data: { emailVerifyToken, emailVerifyExpires } });
  sendVerificationEmail(user.email, emailVerifyToken, user.displayName).catch(() => {});
  res.json({ ok: true });
});

// --- password reset -------------------------------------------------------

// Always responds the same way whether or not the email exists, so this
// endpoint can't be used to check which emails are registered.
router.post('/forgot-password', async (req: Request, res: Response) => {
  try {
    const { email } = forgotPasswordSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      const passwordResetToken = makeToken();
      const passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000);
      await prisma.user.update({ where: { id: user.id }, data: { passwordResetToken, passwordResetExpires } });
      sendPasswordResetEmail(user.email, passwordResetToken, user.displayName).catch(() => {});
    }
    res.json({ ok: true, message: 'If that email has an account, a reset link is on its way.' });
  } catch (e: any) {
    res.status(400).json({ error: e.errors?.[0]?.message || 'Request failed' });
  }
});

router.post('/reset-password', async (req: Request, res: Response) => {
  try {
    const { token, newPassword } = resetPasswordSchema.parse(req.body);
    const user = await prisma.user.findFirst({
      where: { passwordResetToken: token, passwordResetExpires: { gt: new Date() } }
    });
    if (!user) return res.status(400).json({ error: 'This reset link is invalid or has expired' });

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, passwordResetToken: null, passwordResetExpires: null }
    });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e.errors?.[0]?.message || 'Reset failed' });
  }
});

// --- account deletion -------------------------------------------------------

// Requires re-entering the password so a hijacked, already-open session
// (e.g. an unlocked laptop) can't be used to destroy the account in one
// click. Related rows with an onDelete: Cascade relation (contacts, blocks,
// devices, group memberships, reactions, statuses) go with it. Messages
// aren't relationally tied to User (senderId/recipientId are plain columns,
// intentionally, so a deleted account doesn't blank out the other side of a
// conversation) — instead we scrub this user's own message content so
// nothing readable is left behind, while leaving the conversation's shape
// intact for whoever they talked to.
router.delete('/account', requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    const { password } = deleteAccountSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) return res.status(404).json({ error: 'Not found' });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Incorrect password' });

    await prisma.message.updateMany({
      where: { senderId: user.id },
      data: { isDeleted: true, encryptedPayload: 'This account was deleted', mediaUrl: null, mediaThumbUrl: null }
    });
    await prisma.user.delete({ where: { id: user.id } });

    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e.errors?.[0]?.message || 'Account deletion failed' });
  }
});

// --- search / lookup (blocked users excluded both directions) -------------

router.get('/search', requireAuth, async (req: AuthedRequest, res: Response) => {
  const q = ((req.query.q as string) || '').replace('@', '');
  if (!q) return res.json([]);
  const excluded = await getBlockedUserIds(req.userId!);
  const users = await prisma.user.findMany({
    where: { username: { contains: q, mode: 'insensitive' }, NOT: { id: { in: [req.userId!, ...excluded] } } },
    take: 10,
    select: publicUserSelect
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
  const excluded = await getBlockedUserIds(req.userId!);
  const user = await prisma.user.findFirst({
    where: { phoneHash, NOT: { id: { in: [req.userId!, ...excluded] } } },
    select: publicUserSelect
  });
  if (!user) return res.status(404).json({ error: 'No WENET user with that number' });
  res.json(user);
});

router.get('/me', requireAuth, async (req: AuthedRequest, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) return res.status(404).json({ error: 'Not found' });
  const { passwordHash: _omit, emailVerifyToken: _t, passwordResetToken: _r, ...safeUser } = user;
  res.json(safeUser);
});

// Public-ish profile lookup - used by the client to show a chat header/avatar
// when opening a conversation for the first time (e.g. from search results).
// Still requires auth: only logged-in users can resolve a profile.
router.get('/user/:id', requireAuth, async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: publicUserSelect
  });
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json(user);
});

export default router;
