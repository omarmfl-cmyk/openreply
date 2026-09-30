import { prisma } from '@/lib/db/client';
import { facebookAccess } from '@/lib/facebook/auth';
import { facebookCampaignSchema } from '@/lib/facebook/campaigns';
import { z } from 'zod';

export async function GET(request: Request) {
  const access = await facebookAccess(request);
  if (access.error) return access.error;
  const data = await prisma.facebookCampaign.findMany({ where: { workspaceId: access.context.workspaceId },
    include: { facebookPage: { select: { name: true } } }, orderBy: { createdAt: 'desc' } });
  return Response.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } });
}

async function save(request: Request, update: boolean) {
  const access = await facebookAccess(request, true);
  if (access.error) return access.error;
  const body = await request.json().catch(() => null);
  const parsed = facebookCampaignSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const linkage = z.object({ replaceAutomationId: z.string().min(1).optional(), automationId: z.string().min(1).nullable().optional() }).safeParse(body);
  if (!linkage.success) return Response.json({ error: 'Invalid Instagram campaign' }, { status: 400 });
  const workspaceId = access.context.workspaceId;
  const page = await prisma.facebookPage.findFirst({ where: { id: parsed.data.facebookPageId, workspaceId, disconnectedAt: null } });
  if (!page) return Response.json({ error: 'Connect a Facebook Page in this workspace first' }, { status: 400 });
  if (parsed.data.postId && !parsed.data.postId.startsWith(`${page.pageId}_`)) return Response.json({ error: 'Post must belong to the selected Page' }, { status: 400 });
  const id = new URL(request.url).searchParams.get('id');
  if (update && (!id || !await prisma.facebookCampaign.findFirst({ where: { id, workspaceId } }))) return Response.json({ error: 'Campaign not found' }, { status: 404 });
  const data = { ...parsed.data, postId: parsed.data.matchAnyPost ? null : parsed.data.postId };
  for (const automationId of [linkage.data.replaceAutomationId, linkage.data.automationId]) {
    if (automationId && !await prisma.automation.findFirst({ where: { id: automationId, workspaceId } })) return Response.json({ error: 'Instagram campaign not found in this workspace' }, { status: 404 });
  }
  if (linkage.data.automationId) {
    const linked = await prisma.facebookCampaign.findUnique({ where: { automationId: linkage.data.automationId } });
    if (linked && linked.id !== id) return Response.json({ error: 'That Instagram campaign already has a Facebook companion' }, { status: 409 });
  }
  const campaign = await prisma.$transaction(async tx => {
    if (linkage.data.replaceAutomationId) {
      await tx.automation.update({ where: { id: linkage.data.replaceAutomationId, workspaceId }, data: { isActive: false } });
    }
    const settings = { ...data, ...(linkage.data.automationId !== undefined ? { automationId: linkage.data.automationId } : {}),
      ...(linkage.data.replaceAutomationId ? { automationId: null } : {}) };
    return update
      ? tx.facebookCampaign.update({ where: { id: id!, workspaceId }, data: settings })
      : tx.facebookCampaign.create({ data: { ...settings, workspaceId } });
  });
  return Response.json({ success: true, data: campaign }, { status: update ? 200 : 201 });
}

export const POST = (request: Request) => save(request, false);
export const PATCH = (request: Request) => save(request, true);
