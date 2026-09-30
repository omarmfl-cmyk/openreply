import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  db: { workspace: { findUnique: vi.fn() }, instagramAccount: { findFirst: vi.fn() },
    automation: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
    facebookPage: { findFirst: vi.fn() }, facebookCampaign: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn() },
}));
vi.mock('@/lib/db/client', () => ({ prisma: mocks.db }));
vi.mock('@/lib/auth', () => ({ getCurrentWorkspaceId: async () => 'workspace' }));
vi.mock('@/lib/workspace-access', () => ({ getCurrentWorkspaceContext: mocks.context, canManageWorkspace: (r: string) => r === 'OWNER' }));
import { POST, PATCH, DELETE } from '@/app/api/automations/route';
import { POST as createFacebook, PATCH as updateFacebook } from '@/app/api/facebook/campaigns/route';

const fb = { name: 'Facebook offer', facebookPageId: 'page', keywords: ['link'], privateReplyMessage: 'Hi', isActive: true };
const ig = { name: 'Instagram offer', instagramAccountId: 'ig', matchAnyPost: true, keywords: ['link'], dmMessage: 'Hello' };
function request(method: string, body: object, url = 'https://staging.test/api/automations?id=ig-campaign') {
  return new NextRequest(url, { method, headers: { origin: 'https://staging.test', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('OPENREPLY_ENV', 'staging'); vi.stubEnv('FACEBOOK_AUTOMATION_ENABLED', 'true');
  mocks.context.mockResolvedValue({ workspaceId: 'workspace', role: 'OWNER', userId: 'user' });
  mocks.db.workspace.findUnique.mockResolvedValue({ id: 'workspace' });
  mocks.db.instagramAccount.findFirst.mockResolvedValue({ id: 'ig' });
  mocks.db.facebookPage.findFirst.mockResolvedValue({ id: 'page', pageId: '100', workspaceId: 'workspace' });
  mocks.db.automation.findFirst.mockResolvedValue({ id: 'ig-campaign' });
  mocks.db.automation.create.mockResolvedValue({ id: 'ig-campaign', trackedLinks: [] });
  mocks.db.automation.update.mockResolvedValue({ id: 'ig-campaign' });
  mocks.db.facebookCampaign.findFirst.mockResolvedValue({ id: 'fb-campaign' });
  mocks.db.facebookCampaign.findUnique.mockResolvedValue(null);
  mocks.db.facebookCampaign.create.mockResolvedValue({ id: 'fb-campaign' });
  mocks.db.facebookCampaign.update.mockResolvedValue({ id: 'fb-campaign' });
  mocks.db.$transaction.mockImplementation(async fn => fn(mocks.db));
});
afterEach(() => vi.unstubAllEnvs());

it('legacy Instagram creation requires no Facebook fields or queries', async () => {
  expect((await POST(request('POST', ig))).status).toBe(201);
  expect(mocks.db.facebookPage.findFirst).not.toHaveBeenCalled();
  expect(mocks.db.automation.create.mock.calls[0][0].data).not.toHaveProperty('facebookCampaign');
  expect(mocks.db.automation.create.mock.calls[0][0].data.instagramAccountId).toBe('ig');
});
it('Both creation uses one atomic nested write and keeps Instagram IDs', async () => {
  expect((await POST(request('POST', { ...ig, facebook: fb }))).status).toBe(201);
  expect(mocks.db.automation.create.mock.calls[0][0].data).toMatchObject({ instagramAccountId: 'ig', facebookCampaign: { create: { ...fb, workspaceId: 'workspace' } } });
});
it('rejects an unowned Facebook Page before writing either campaign', async () => {
  mocks.db.facebookPage.findFirst.mockResolvedValue(null);
  expect((await POST(request('POST', { ...ig, facebook: fb }))).status).toBe(400);
  expect(mocks.db.automation.create).not.toHaveBeenCalled();
});
it('Both editing saves the companion inside the existing transaction', async () => {
  expect((await PATCH(request('PATCH', { name: 'Updated', facebook: fb }))).status).toBe(200);
  expect(mocks.db.$transaction).toHaveBeenCalledOnce();
  expect(mocks.db.facebookCampaign.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { automationId: 'ig-campaign' }, create: expect.objectContaining({ workspaceId: 'workspace', automationId: 'ig-campaign' }) }));
});
it('switching Both to Instagram pauses and detaches the Facebook companion', async () => {
  expect((await PATCH(request('PATCH', { facebook: null }))).status).toBe(200);
  expect(mocks.db.facebookCampaign.updateMany).toHaveBeenCalledWith({ where: { automationId: 'ig-campaign', workspaceId: 'workspace' }, data: { automationId: null, isActive: false } });
});
it('stopping Both stops both campaigns', async () => {
  await PATCH(request('PATCH', { isActive: false }));
  expect(mocks.db.automation.update).toHaveBeenCalledWith(expect.objectContaining({ data: { isActive: false } }));
  expect(mocks.db.facebookCampaign.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { isActive: false } }));
});
it('deleting a Both campaign pauses the retained Facebook history', async () => {
  expect((await DELETE(request('DELETE', {}))).status).toBe(200);
  expect(mocks.db.$transaction).toHaveBeenCalledOnce(); expect(mocks.db.facebookCampaign.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { isActive: false } }));
});
it('Facebook-only creation never requires or writes Instagram', async () => {
  expect((await createFacebook(request('POST', fb, 'https://staging.test/api/facebook/campaigns'))).status).toBe(201);
  expect(mocks.db.instagramAccount.findFirst).not.toHaveBeenCalled(); expect(mocks.db.automation.create).not.toHaveBeenCalled();
});
it('rejects posts on another Page', async () => {
  expect((await createFacebook(request('POST', { ...fb, matchAnyPost: false, postId: '999_400' }))).status).toBe(400);
  expect(mocks.db.facebookCampaign.create).not.toHaveBeenCalled();
});
it('switching to Facebook-only pauses Instagram in the same transaction', async () => {
  expect((await updateFacebook(request('PATCH', { ...fb, replaceAutomationId: 'ig-campaign' }, 'https://staging.test/api/facebook/campaigns?id=fb-campaign'))).status).toBe(200);
  expect(mocks.db.automation.update).toHaveBeenCalledWith({ where: { id: 'ig-campaign', workspaceId: 'workspace' }, data: { isActive: false } });
  expect(mocks.db.facebookCampaign.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ automationId: null }) }));
});
it('cannot attach an Instagram campaign from another workspace', async () => {
  mocks.db.automation.findFirst.mockResolvedValue(null);
  expect((await createFacebook(request('POST', { ...fb, automationId: 'foreign' }))).status).toBe(404);
  expect(mocks.db.facebookCampaign.create).not.toHaveBeenCalled();
});
it('disabled Facebook leaves legacy Instagram editing independent', async () => {
  vi.stubEnv('FACEBOOK_AUTOMATION_ENABLED', 'false');
  expect((await PATCH(request('PATCH', { isActive: false }))).status).toBe(200); expect(mocks.db.facebookCampaign.updateMany).not.toHaveBeenCalled();
  expect((await POST(request('POST', { ...ig, facebook: fb }))).status).toBe(403);
});
