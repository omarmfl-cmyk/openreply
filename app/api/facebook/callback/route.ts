import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { canManageWorkspace } from '@/lib/workspace-access';
import { facebookCallback, FACEBOOK_PERMISSIONS } from '@/lib/facebook/config';
import { exchangeFacebookCode, facebookRequest } from '@/lib/facebook/client';
import { facebookAccess, facebookSession, FACEBOOK_COOKIE, encodeFacebookSession, facebookCookieOptions } from '@/lib/facebook/auth';

export async function GET(request: NextRequest) {
  const access = await facebookAccess(request);
  if (access.error) return access.error;
  const session = await facebookSession(access.context.userId, access.context.workspaceId);
  // Consume the state cookie even on a failed callback.
  (await cookies()).set(FACEBOOK_COOKIE, '', { ...facebookCookieOptions, maxAge: 0 });
  const code = request.nextUrl.searchParams.get('code');
  if (!session || session.token || !canManageWorkspace(access.context.role) || session.nonce !== request.nextUrl.searchParams.get('state') || !code || request.nextUrl.searchParams.has('error')) {
    return NextResponse.redirect(new URL('/settings?facebook=denied', request.url));
  }
  try {
    const token = await exchangeFacebookCode(code, facebookCallback());
    const permissions = await facebookRequest('me/permissions', token);
    const granted = new Set((permissions.data ?? []).filter((p: { status: string }) => p.status === 'granted').map((p: { permission: string }) => p.permission));
    if (FACEBOOK_PERMISSIONS.some(p => !granted.has(p))) throw new Error('Missing Page permissions');
    const response = NextResponse.redirect(new URL('/settings?facebook=select', request.url));
    response.cookies.set(FACEBOOK_COOKIE, encodeFacebookSession({ ...session, token, expiresAt: Date.now() + 600000 }), facebookCookieOptions);
    return response;
  } catch {
    return NextResponse.redirect(new URL('/settings?facebook=failed', request.url));
  }
}
