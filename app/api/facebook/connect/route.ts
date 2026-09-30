import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireEnv } from '@/lib/env';
import { canManageWorkspace } from '@/lib/workspace-access';
import { facebookAccess, FACEBOOK_COOKIE, encodeFacebookSession, facebookCookieOptions } from '@/lib/facebook/auth';
import { FACEBOOK_PERMISSIONS, facebookCallback, facebookVersion } from '@/lib/facebook/config';

export async function GET(request: Request) {
  const access = await facebookAccess(request);
  if (access.error) return access.error;
  if (!canManageWorkspace(access.context.role)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  try {
    requireEnv('FACEBOOK_PAGE_APP_SECRET');
    const nonce = randomBytes(32).toString('hex');
    const query = new URLSearchParams({ client_id: requireEnv('FACEBOOK_PAGE_APP_ID'), redirect_uri: facebookCallback(),
      response_type: 'code', scope: FACEBOOK_PERMISSIONS.join(','), state: nonce });
    const response = NextResponse.redirect(`https://www.facebook.com/${facebookVersion()}/dialog/oauth?${query}`);
    response.cookies.set(FACEBOOK_COOKIE, encodeFacebookSession({ userId: access.context.userId, workspaceId: access.context.workspaceId, nonce, expiresAt: Date.now() + 600000 }), facebookCookieOptions);
    return response;
  } catch {
    return NextResponse.redirect(new URL('/settings?facebook=misconfigured', request.url));
  }
}
