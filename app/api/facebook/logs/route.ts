import { prisma } from '@/lib/db/client';
import { facebookAccess } from '@/lib/facebook/auth';

export async function GET(request: Request) {
  const access = await facebookAccess(request);
  if (access.error) return access.error;
  const page = Math.max(1, Math.min(100000, Number(new URL(request.url).searchParams.get('page')) || 1));
  const where = { campaign: { workspaceId: access.context.workspaceId }, facebookPage: { workspaceId: access.context.workspaceId } };
  const [data, total] = await Promise.all([
    prisma.facebookDelivery.findMany({ where, skip: (Math.floor(page) - 1) * 20, take: 20, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { campaign: { select: { name: true } }, facebookPage: { select: { name: true } } } }),
    prisma.facebookDelivery.count({ where }),
  ]);
  return Response.json({ success: true, data, total }, { headers: { 'Cache-Control': 'no-store' } });
}
