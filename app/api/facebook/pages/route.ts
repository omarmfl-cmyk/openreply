import { cookies } from 'next/headers';
import { z } from 'zod';
import { prisma } from '@/lib/db/client';
import { requireEnv } from '@/lib/env';
import { encryptToken } from '@/lib/meta/oauth';
import { facebookAccess, facebookSession, FACEBOOK_COOKIE, facebookCookieOptions } from '@/lib/facebook/auth';
import { facebookEnabled } from '@/lib/facebook/config';
import { facebookRequest, listManagedPages } from '@/lib/facebook/client';

export async function GET(request: Request) {
  if (!facebookEnabled()) return Response.json({ success: true, enabled: false, data: [], available: [] });
  const access = await facebookAccess(request);
  if (access.error) return access.error;
  const session = await facebookSession(access.context.userId, access.context.workspaceId);
  try {
    const [pages, available] = await Promise.all([
      prisma.facebookPage.findMany({ where: { workspaceId: access.context.workspaceId, disconnectedAt: null },
        select: { id: true, pageId: true, name: true, tokenExpiresAt: true, webhookSubscribed: true } }),
      session?.token ? listManagedPages(session.token) : Promise.resolve([]),
    ]);
    return Response.json({ success: true, enabled: true, data: pages, available: available.map(({ id, name }) => ({ id, name })) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ error: 'Unable to load Facebook Pages. Reconnect and try again.' }, { status: 502 }); }
}

export async function POST(request: Request) {
  const access = await facebookAccess(request, true);
  if (access.error) return access.error;
  const parsed = z.object({ pageId: z.string().regex(/^\d+$/) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Choose a Page' }, { status: 400 });
  const { workspaceId, userId } = access.context;
  const session = await facebookSession(userId, workspaceId);
  if (!session?.token) return Response.json({ error: 'Facebook authorization expired. Connect again.' }, { status: 401 });
  try {
    const page = (await listManagedPages(session.token)).find(p => p.id === parsed.data.pageId);
    if (!page) return Response.json({ error: 'Page is not authorized' }, { status: 403 });
    const existing = await prisma.facebookPage.findUnique({ where: { pageId: page.id } });
    if (existing && existing.workspaceId !== workspaceId) return Response.json({ error: 'Page belongs to another workspace' }, { status: 409 });
    const debug = await facebookRequest(`debug_token?${new URLSearchParams({ input_token: page.access_token })}`,
      `${requireEnv('FACEBOOK_PAGE_APP_ID')}|${requireEnv('FACEBOOK_PAGE_APP_SECRET')}`);
    if (!debug.data?.is_valid || String(debug.data.app_id) !== requireEnv('FACEBOOK_PAGE_APP_ID')) throw new Error('Invalid Page token');
    const expiries = [debug.data.expires_at, debug.data.data_access_expires_at].filter((n): n is number => typeof n === 'number' && n > 0);
    const tokenExpiresAt = expiries.length ? new Date(Math.min(...expiries) * 1000) : null;
    const subscription = await facebookRequest(`${page.id}/subscribed_apps`, page.access_token, { subscribed_fields: ['feed'] });
    if (!subscription.success) throw new Error('Page subscription failed');
    const data = { name: page.name, accessToken: encryptToken(page.access_token), tokenExpiresAt,
      webhookSubscribed: true, disconnectedAt: null, connectedAt: new Date() };
    if (existing) {
      await prisma.facebookPage.update({ where: { id: existing.id, workspaceId }, data });
    } else {
      await prisma.facebookPage.create({ data: { ...data, workspaceId, pageId: page.id } });
    }
    (await cookies()).set(FACEBOOK_COOKIE, '', { ...facebookCookieOptions, maxAge: 0 });
    return Response.json({ success: true });
  } catch { return Response.json({ error: 'Facebook connection failed. Check Page permissions and reconnect.' }, { status: 502 }); }
}

export async function DELETE(request: Request) {
  const access = await facebookAccess(request, true);
  if (access.error) return access.error;
  const parsed = z.object({ id: z.string().min(1) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Page ID required' }, { status: 400 });
  // Keep delivery tombstones across reconnection; erase only this Page's token.
  await prisma.facebookPage.updateMany({ where: { id: parsed.data.id, workspaceId: access.context.workspaceId },
    data: { accessToken: '', disconnectedAt: new Date(), webhookSubscribed: false } });
  return Response.json({ success: true });
}
