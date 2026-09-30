import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ instagram: vi.fn(), facebook: vi.fn(), create: vi.fn() }));
vi.mock('@/lib/queue/process-webhook', () => ({ processInstagramWebhook: mocks.instagram }));
vi.mock('@/lib/facebook/queue', () => ({ processFacebookWebhook: mocks.facebook }));
vi.mock('@/lib/db/client', () => ({ prisma: { operationalEvent: { create: mocks.create } } }));
import { GET, POST } from '@/app/api/webhook/route';
beforeEach(() => {
  vi.resetAllMocks(); mocks.create.mockResolvedValue({});
  vi.stubEnv('OPENREPLY_ENV', 'staging'); vi.stubEnv('FACEBOOK_AUTOMATION_ENABLED', 'true');
  vi.stubEnv('INSTAGRAM_APP_SECRET', 'ig'); vi.stubEnv('FACEBOOK_APP_SECRET', 'legacy'); vi.stubEnv('FACEBOOK_PAGE_APP_SECRET', 'fb');
  vi.stubEnv('WEBHOOK_VERIFY_TOKEN', 'legacy-verify'); vi.stubEnv('FACEBOOK_PAGE_WEBHOOK_VERIFY_TOKEN', 'fb-verify');
});
afterEach(() => vi.unstubAllEnvs());
function req(object: unknown, secret: string) {
  const body = JSON.stringify(object);
  return new NextRequest('https://staging.test/api/webhook', { method: 'POST', body, headers: { 'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}` } });
}
it('Instagram enters only the existing Instagram processor', async () => {
  const payload = { object: 'instagram', entry: [] }; expect((await POST(req(payload, 'ig'))).status).toBe(200);
  expect(mocks.instagram).toHaveBeenCalledExactlyOnceWith({ payload, provider: 'META' }); expect(mocks.facebook).not.toHaveBeenCalled();
});
it('Facebook enters only the Facebook processor', async () => {
  const payload = { object: 'page', entry: [] }; expect((await POST(req(payload, 'fb'))).status).toBe(200);
  expect(mocks.facebook).toHaveBeenCalledExactlyOnceWith(payload); expect(mocks.instagram).not.toHaveBeenCalled();
});
it.each([{ object: 'unknown' }, null, []])('unknown payload invokes neither processor', async payload => {
  expect((await POST(req(payload, 'ig'))).status).toBe(200); expect(mocks.instagram).not.toHaveBeenCalled(); expect(mocks.facebook).not.toHaveBeenCalled();
});
it('rejects cross-platform signatures', async () => {
  expect((await POST(req({ object: 'page' }, 'ig'))).status).toBe(401);
  expect((await POST(req({ object: 'instagram' }, 'fb'))).status).toBe(401);
  expect(mocks.instagram).not.toHaveBeenCalled(); expect(mocks.facebook).not.toHaveBeenCalled();
});
it.each(['legacy-verify', 'fb-verify'])('retains GET verification for %s', async token => {
  const result = await GET(new NextRequest(`https://staging.test/api/webhook?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=challenge`));
  expect(result.status).toBe(200); expect(await result.text()).toBe('challenge');
});
it('propagates a Facebook queue failure as 500', async () => {
  mocks.facebook.mockRejectedValue(new Error('queue unavailable')); expect((await POST(req({ object: 'page' }, 'fb'))).status).toBe(500);
});
it('ignores Facebook when disabled without changing Instagram dispatch', async () => {
  vi.stubEnv('FACEBOOK_AUTOMATION_ENABLED', 'false');
  expect((await POST(req({ object: 'page' }, 'fb'))).status).toBe(200); expect(mocks.facebook).not.toHaveBeenCalled();
  await POST(req({ object: 'instagram' }, 'ig')); expect(mocks.instagram).toHaveBeenCalledOnce();
});
