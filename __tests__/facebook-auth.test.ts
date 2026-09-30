import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
const mocks = vi.hoisted(() => ({
  context: vi.fn(), cookie: { get: vi.fn(), set: vi.fn() }, pages: vi.fn(), request: vi.fn(), exchange: vi.fn(),
  db: { facebookPage: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() }, instagramAccount: { deleteMany: vi.fn() } },
}));
vi.mock('next/headers', () => ({ cookies: async () => mocks.cookie }));
vi.mock('@/lib/workspace-access', () => ({ getCurrentWorkspaceContext: mocks.context, canManageWorkspace: (role: string) => ['OWNER', 'ADMIN'].includes(role) }));
vi.mock('@/lib/db/client', () => ({ prisma: mocks.db }));
vi.mock('@/lib/facebook/client', () => ({ listManagedPages: mocks.pages, facebookRequest: mocks.request, exchangeFacebookCode: mocks.exchange }));
import { encryptToken, decryptToken } from '@/lib/meta/oauth';
import { encodeFacebookSession, facebookSession, FACEBOOK_COOKIE } from '@/lib/facebook/auth';
import { FACEBOOK_PERMISSIONS } from '@/lib/facebook/config';
import { GET as connect } from '@/app/api/facebook/connect/route';
import { GET as callback } from '@/app/api/facebook/callback/route';
import { GET, POST, DELETE } from '@/app/api/facebook/pages/route';
import { POST as disconnectInstagram } from '@/app/api/instagram/disconnect/route';

function request(method = 'GET', body?: object, origin = 'https://staging.test') {
  return new NextRequest('https://staging.test/api/facebook/pages', { method, headers: { origin, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
}
function session(patch = {}) {
  return encodeFacebookSession({ userId: 'user', workspaceId: 'workspace', nonce: 'nonce', token: 'user-token', expiresAt: Date.now() + 600000, ...patch });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('OPENREPLY_ENV', 'staging'); vi.stubEnv('FACEBOOK_AUTOMATION_ENABLED', 'true'); vi.stubEnv('ENCRYPTION_KEY', 'ab'.repeat(32));
  vi.stubEnv('NEXTAUTH_URL', 'https://staging.test'); vi.stubEnv('FACEBOOK_PAGE_APP_ID', '123'); vi.stubEnv('FACEBOOK_PAGE_APP_SECRET', 'secret');
  mocks.context.mockResolvedValue({ userId: 'user', workspaceId: 'workspace', role: 'OWNER' });
  mocks.cookie.get.mockReturnValue({ value: session() });
  mocks.db.facebookPage.findMany.mockResolvedValue([{ id: 'page', name: 'Test Page' }]); mocks.db.facebookPage.findUnique.mockResolvedValue(null);
  mocks.pages.mockResolvedValue([{ id: '100', name: 'Test Page', access_token: 'page-token', tasks: ['MODERATE', 'MESSAGING'] }]);
  mocks.exchange.mockResolvedValue('user-token');
  mocks.request.mockImplementation(async (path: string) => path === 'me/permissions'
    ? { data: FACEBOOK_PERMISSIONS.map(permission => ({ permission, status: 'granted' })) }
    : path.startsWith('debug_token') ? { data: { is_valid: true, app_id: '123', expires_at: 2000000000 } } : { success: true });
});
afterEach(() => vi.unstubAllEnvs());

it('OAuth state is encrypted and bound to the user, workspace and expiry', async () => {
  expect(await facebookSession('user', 'workspace')).toMatchObject({ nonce: 'nonce' });
  expect(await facebookSession('other-user', 'workspace')).toBeNull(); expect(await facebookSession('user', 'other-workspace')).toBeNull();
  mocks.cookie.get.mockReturnValue({ value: session({ expiresAt: 1 }) }); expect(await facebookSession('user', 'workspace')).toBeNull();
  mocks.cookie.get.mockReturnValue({ value: 'tampered' }); expect(await facebookSession('user', 'workspace')).toBeNull();
});
it('connect uses separate credentials, verified permissions, callback and HttpOnly state', async () => {
  const result = await connect(request()); const url = new URL(result.headers.get('location')!);
  expect(url.origin).toBe('https://www.facebook.com'); expect(url.searchParams.get('client_id')).toBe('123');
  expect(url.searchParams.get('redirect_uri')).toBe('https://staging.test/api/facebook/callback');
  expect(url.searchParams.get('scope')?.split(',')).toEqual(FACEBOOK_PERMISSIONS);
  expect(url.searchParams.get('scope')?.split(',')).toContain('business_management');
  if (!(result instanceof NextResponse)) throw new Error('Expected OAuth redirect');
  const cookie = result.cookies.get(FACEBOOK_COOKIE)!;
  expect(cookie.httpOnly).toBe(true); expect(cookie.path).toBe('/api/facebook');
  expect(JSON.parse(decryptToken(cookie.value))).toMatchObject({ userId: 'user', workspaceId: 'workspace', nonce: url.searchParams.get('state') });
});
it('rejects callback state mismatch before token exchange', async () => {
  mocks.cookie.get.mockReturnValue({ value: session({ token: undefined }) });
  const result = await callback(new NextRequest('https://staging.test/api/facebook/callback?state=wrong&code=code'));
  expect(result.headers.get('location')).toContain('facebook=denied'); expect(mocks.exchange).not.toHaveBeenCalled();
  expect(mocks.cookie.set).toHaveBeenCalledWith(FACEBOOK_COOKIE, '', expect.objectContaining({ path: '/api/facebook', maxAge: 0 }));
});
it('valid callback stores only an encrypted temporary token and redirects to Page selection', async () => {
  mocks.cookie.get.mockReturnValue({ value: session({ token: undefined }) });
  const result = await callback(new NextRequest('https://staging.test/api/facebook/callback?state=nonce&code=code'));
  expect(result.headers.get('location')).toContain('facebook=select');
  if (!(result instanceof NextResponse)) throw new Error('Expected OAuth redirect');
  expect(JSON.parse(decryptToken(result.cookies.get(FACEBOOK_COOKIE)!.value))).toMatchObject({ token: 'user-token' });
  expect(mocks.db.facebookPage.create).not.toHaveBeenCalled();
});
it('declined permissions cannot produce a usable Page selection session', async () => {
  mocks.cookie.get.mockReturnValue({ value: session({ token: undefined }) }); mocks.request.mockResolvedValue({ data: [] });
  const result = await callback(new NextRequest('https://staging.test/api/facebook/callback?state=nonce&code=code'));
  expect(result.headers.get('location')).toContain('facebook=failed');
});
it('lists authorized Pages without leaking Page tokens', async () => {
  const result = await GET(request()); const text = await result.text();
  expect(text).toContain('Test Page'); expect(text).not.toContain('page-token'); expect(text).not.toContain('user-token');
  expect(mocks.db.facebookPage.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { workspaceId: 'workspace', disconnectedAt: null } }));
});
it('stores selected Page encrypted and subscribes only to feed', async () => {
  expect((await POST(request('POST', { pageId: '100' }))).status).toBe(200);
  const saved = mocks.db.facebookPage.create.mock.calls[0][0].data;
  expect(saved.accessToken).not.toBe('page-token'); expect(decryptToken(saved.accessToken)).toBe('page-token');
  expect(saved.workspaceId).toBe('workspace'); expect(saved.tokenExpiresAt).toEqual(new Date(2000000000000));
  expect(mocks.request).toHaveBeenCalledWith('100/subscribed_apps', 'page-token', { subscribed_fields: ['feed'] });
});
it('blocks connecting a Page belonging to another workspace before subscribing', async () => {
  mocks.db.facebookPage.findUnique.mockResolvedValue({ workspaceId: 'other' });
  expect((await POST(request('POST', { pageId: '100' }))).status).toBe(409); expect(mocks.request).not.toHaveBeenCalled();
});
it('does not trust arbitrary client supplied Page IDs or tokens', async () => {
  expect((await POST(request('POST', { pageId: '999', accessToken: encryptToken('attacker-token') }))).status).toBe(403);
  expect(mocks.db.facebookPage.create).not.toHaveBeenCalled();
});
it.each(['POST', 'DELETE'])('requires administrator and same origin for %s', async method => {
  const action = method === 'POST' ? POST : DELETE;
  expect((await action(request(method, { id: 'page', pageId: '100' }, 'https://attacker.test'))).status).toBe(403);
  mocks.context.mockResolvedValue({ userId: 'user', workspaceId: 'workspace', role: 'MEMBER' });
  expect((await action(request(method, { id: 'page', pageId: '100' }))).status).toBe(403);
});
it('Facebook disconnect clears only the selected workspace Page token', async () => {
  expect((await DELETE(request('DELETE', { id: 'page' }))).status).toBe(200);
  expect(mocks.db.facebookPage.updateMany).toHaveBeenCalledWith({ where: { id: 'page', workspaceId: 'workspace' }, data: { accessToken: '', disconnectedAt: expect.any(Date), webhookSubscribed: false } });
  expect(mocks.db.instagramAccount.deleteMany).not.toHaveBeenCalled();
});
it('Instagram disconnect leaves Facebook storage untouched', async () => {
  expect((await disconnectInstagram(request('POST', { instagramAccountId: 'ig' }))).status).toBe(200);
  expect(mocks.db.instagramAccount.deleteMany).toHaveBeenCalledWith({ where: { workspaceId: 'workspace', id: 'ig' } });
  expect(mocks.db.facebookPage.updateMany).not.toHaveBeenCalled();
});
it('disabled staging feature accesses no database or OAuth session', async () => {
  vi.stubEnv('OPENREPLY_ENV', 'production'); expect(await (await GET(request())).json()).toMatchObject({ enabled: false });
  expect((await POST(request('POST', { pageId: '100' }))).status).toBe(404);
  expect(mocks.context).not.toHaveBeenCalled(); expect(mocks.pages).not.toHaveBeenCalled();
});
