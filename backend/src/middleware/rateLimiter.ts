import rateLimit from 'express-rate-limit';

export const authLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, message: 'Too many attempts, try later' });
export const generalLimiter = rateLimit({ windowMs: 60 * 1000, max: 100 });
