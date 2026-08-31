import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// True if either user has blocked the other, in either direction.
// Used to stop message delivery and to hide blocked users from search
// results, contact lookups, and contact-add.
export async function isBlockedEitherWay(a: string, b: string): Promise<boolean> {
  const block = await prisma.block.findFirst({
    where: {
      OR: [
        { blockerId: a, blockedId: b },
        { blockerId: b, blockedId: a }
      ]
    }
  });
  return !!block;
}

// All user ids that either blocked `userId` or were blocked by `userId`,
// for excluding them wholesale from search/lookup results.
export async function getBlockedUserIds(userId: string): Promise<string[]> {
  const blocks = await prisma.block.findMany({
    where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
    select: { blockerId: true, blockedId: true }
  });
  const ids = new Set<string>();
  for (const b of blocks) {
    ids.add(b.blockerId === userId ? b.blockedId : b.blockerId);
  }
  return [...ids];
}

export async function getGroupRole(groupId: string, userId: string): Promise<string | null> {
  const member = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } }
  });
  return member?.role ?? null;
}

export async function isGroupMember(groupId: string, userId: string): Promise<boolean> {
  return (await getGroupRole(groupId, userId)) !== null;
}
