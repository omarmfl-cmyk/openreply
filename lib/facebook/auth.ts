import { cookies } from 'next/headers';
import { z } from 'zod';
import { encryptToken, decryptToken } from '@/lib/meta/oauth';
import { canManageWorkspace, getCurrentWorkspaceContext } from '@/lib/workspace-access';
import { facebookEnabled } from './config';

export const FACEBOOK_COOKIE = 'openreply-facebook';
const sessionSchema = z.object({
  userId: z.string(), workspaceId: z.string(), nonce: z.string(),
  expiresAt: z.number(), token: z.string().optional(),
});
export type FacebookSession = z.infer<typeof sessionSchema>;

export const facebookCookieOptions = {
  httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const,
  path: '/api/facebook', maxAge: 600,
};

export function encodeFacebookSession(session: FacebookSession) {
  return encryptToken(JSON.stringify(session));
}

export async function facebookSession(userId: string, workspaceId: string) {
  const raw = (await cookies()).get(FACEBOOK_COOKIE)?.value;
  if (!raw) return null;
  try {
    const session = sessionSchema.parse(JSON.parse(decryptToken(raw)));
    if (session.userId !== userId || session.workspaceId !== workspaceId || session.expiresAt < Date.now()) return null;
    return session;
  } catch { return null; }
}

export async function facebookAccess(request: Request, write = false) {
  if (!facebookEnabled()) return { error: Response.json({ error: 'Facebook automation is disabled' }, { status: 404 }) };
  const context = await getCurrentWorkspaceContext();
  if (!context) return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (write && (!canManageWorkspace(context.role) || request.headers.get('origin') !== new URL(request.url).origin)) {
    return { error: Response.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { context };
}
