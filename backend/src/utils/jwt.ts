import jwt from 'jsonwebtoken';

export const signToken = (userId: string) =>
  jwt.sign({ userId }, process.env.JWT_SECRET!, { expiresIn: '30d' });

export const verifyJWT = (token: string): string | null => {
  try {
    const d = jwt.verify(token, process.env.JWT_SECRET!) as any;
    return d.userId;
  } catch {
    return null;
  }
};
