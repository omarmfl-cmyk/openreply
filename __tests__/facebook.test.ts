import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import type { FacebookDelivery } from '@/app/generated/prisma/client';

const mocks = vi.hoisted(() => ({
  prisma: { facebookPage: { findUnique: vi.fn() }, facebookCampaign: { findMany: vi.fn() },
    facebookDelivery: { upsert: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    facebookPrivateClaim: { createMany: vi.fn() } },
  send: vi.fn(), decrypt: vi.fn(), publicReply: vi.fn(), privateReply: vi.fn(),
}));
vi.mock('@/lib/db/client', () => ({ prisma: mocks.prisma }));
vi.mock('@vercel/queue', () => ({ send: mocks.send }));
vi.mock('@/lib/meta/oauth', () => ({ decryptToken: mocks.decrypt }));
vi.mock('@/lib/facebook/client', async importOriginal => ({ ...await importOriginal<object>(), sendPublicReply: mocks.publicReply, sendPrivateReply: mocks.privateReply }));
import { parseFacebookComments, verifyFacebookSignature } from '@/lib/facebook/webhook';
import { processFacebookWebhook, processFacebookJob } from '@/lib/facebook/queue';
import { FacebookApiError } from '@/lib/facebook/client';
import { facebookCampaignSchema } from '@/lib/facebook/campaigns';

const connectedAt = new Date(Date.now() - 60000);
const page = { id: 'page-row', pageId: '100', workspaceId: 'workspace', accessToken: 'encrypted', connectedAt, disconnectedAt: null, tokenExpiresAt: null };
const campaign = { id: 'campaign', workspaceId: 'workspace', facebookPageId: page.id, isActive: true, matchAnyWord: false, wholeWordMatch: true,
  keywords: ['link'], publicReplyEnabled: true, privateReplyEnabled: true, publicReplyMessage: 'Check Messenger', privateReplyMessage: 'Here is your link' };
function payload(text = 'LINK please', author = '200') {
  return { object: 'page', entry: [{ id: '100', changes: [{ field: 'feed', value: { item: 'comment', verb: 'add', comment_id: '100_300',
    post_id: '100_400', message: text, from: { id: author, name: 'Ada' }, created_time: Math.floor(Date.now() / 1000) } }] }] };
}
let row: FacebookDelivery;
const job = { deliveryId: 'delivery', workspaceId: 'workspace', connectedAt: connectedAt.toISOString() };
const claims = new Set<string>();
beforeEach(() => {
  vi.resetAllMocks(); claims.clear();
  vi.stubEnv('OPENREPLY_ENV', 'staging'); vi.stubEnv('FACEBOOK_AUTOMATION_ENABLED', 'true');
  vi.stubEnv('FACEBOOK_PAGE_APP_SECRET', 'facebook-secret');
  row = { id: 'delivery', facebookPageId: page.id, campaignId: campaign.id, commentId: '100_300', postId: '100_400', commenterId: '200',
    commenterName: 'Ada', commentText: 'LINK please', commentCreatedAt: new Date(), matchedKeyword: 'link',
    publicStatus: 'PENDING', privateStatus: 'PENDING', publicError: null, privateError: null, publicReplyId: null, privateReplyId: null,
    createdAt: new Date(), updatedAt: new Date() };
  mocks.prisma.facebookPage.findUnique.mockResolvedValue(page);
  mocks.prisma.facebookCampaign.findMany.mockResolvedValue([campaign]);
  mocks.prisma.facebookDelivery.upsert.mockImplementation(async () => ({ ...row }));
  mocks.prisma.facebookDelivery.findFirst.mockImplementation(async ({ where }) => where.campaign.workspaceId === page.workspaceId
    ? { ...row, campaign: { ...campaign }, facebookPage: { ...page } } : null);
  mocks.prisma.facebookDelivery.updateMany.mockImplementation(async ({ where, data }) => {
    if (Object.entries(where).some(([k, v]) => row[k as keyof FacebookDelivery] !== v)) return { count: 0 };
    Object.assign(row, data); return { count: 1 };
  });
  mocks.prisma.facebookDelivery.update.mockImplementation(async ({ data }) => { Object.assign(row, data); return row; });
  mocks.prisma.facebookPrivateClaim.createMany.mockImplementation(async ({ data }) => {
    if (claims.has(data[0].id)) return { count: 0 };
    claims.add(data[0].id); return { count: 1 };
  });
  mocks.send.mockResolvedValue({ messageId: null }); mocks.decrypt.mockReturnValue('page-token');
  mocks.publicReply.mockResolvedValue('public-id'); mocks.privateReply.mockResolvedValue('private-id');
});
afterEach(() => vi.unstubAllEnvs());

describe('Facebook comments', () => {
  it('extracts Page, post, comment, text and author', () => {
    expect(parseFacebookComments(payload())).toEqual([expect.objectContaining({ pageId: '100', postId: '100_400', commentId: '100_300', commenterId: '200', commenterName: 'Ada', commentText: 'LINK please' })]);
  });
  it.each([null, {}, { object: 'instagram', entry: [] }, { object: 'page', entry: [null] }])('safely ignores malformed or other payload %j', input => expect(parseFacebookComments(input)).toEqual([]));
  it('ignores comment edits and non-feed events', () => {
    const p = payload(); p.entry[0].changes[0].value.verb = 'edited'; expect(parseFacebookComments(p)).toEqual([]);
    p.entry[0].changes[0].value.verb = 'add'; p.entry[0].changes[0].field = 'messages'; expect(parseFacebookComments(p)).toEqual([]);
  });
  it('ignores self-comments before touching storage', async () => {
    await processFacebookWebhook(payload('link', '100')); expect(mocks.prisma.facebookPage.findUnique).not.toHaveBeenCalled();
  });
  it('ignores unconnected Pages', async () => {
    mocks.prisma.facebookPage.findUnique.mockResolvedValue(null); await processFacebookWebhook(payload()); expect(mocks.send).not.toHaveBeenCalled();
  });
  it('matches keywords using Instagram semantics and scopes campaigns to the Page workspace', async () => {
    await processFacebookWebhook(payload());
    expect(mocks.prisma.facebookCampaign.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ facebookPageId: page.id, workspaceId: page.workspaceId, isActive: true }) }));
    expect(mocks.prisma.facebookDelivery.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ matchedKeyword: 'link' }) }));
    expect(mocks.send).toHaveBeenCalledWith('facebook-comments', job, expect.objectContaining({ idempotencyKey: expect.stringMatching(/^[a-f0-9]{64}$/) }));
  });
  it('does not enqueue keyword non-matches', async () => {
    await processFacebookWebhook(payload('linking')); expect(mocks.send).not.toHaveBeenCalled();
  });
  it('accepts repeated publishes with null/different IDs and the same key', async () => {
    await processFacebookWebhook(payload()); mocks.send.mockResolvedValue({ messageId: 'another' }); await processFacebookWebhook(payload());
    expect(mocks.send.mock.calls[0]).toEqual(mocks.send.mock.calls[1]);
  });
  it('propagates publisher failures for webhook redelivery', async () => {
    mocks.send.mockRejectedValue(new Error('unavailable')); await expect(processFacebookWebhook(payload())).rejects.toThrow('unavailable');
  });
  it('duplicate webhooks and concurrent queue deliveries do not double-send', async () => {
    await processFacebookWebhook(payload()); await processFacebookWebhook(payload());
    await Promise.all([processFacebookJob(job), processFacebookJob(job)]);
    await processFacebookJob(job); await processFacebookWebhook(payload());
    expect(mocks.publicReply).toHaveBeenCalledTimes(1); expect(mocks.privateReply).toHaveBeenCalledTimes(1);
    expect(row).toMatchObject({ publicStatus: 'SENT', privateStatus: 'SENT', publicReplyId: 'public-id', privateReplyId: 'private-id' });
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });
  it('deduplicates a private reply across different campaigns for the same comment', async () => {
    await processFacebookJob(job); row.privateStatus = 'PENDING'; row.publicStatus = 'SKIPPED'; row.campaignId = 'other-campaign';
    await processFacebookJob(job); expect(mocks.privateReply).toHaveBeenCalledTimes(1); expect(row.privateStatus).toBe('SKIPPED');
  });
  it('public failure does not corrupt successful private reply state', async () => {
    mocks.publicReply.mockRejectedValue(new FacebookApiError(200, undefined)); await processFacebookJob(job);
    expect(row).toMatchObject({ publicStatus: 'FAILED', privateStatus: 'SENT', privateError: null });
  });
  it('private reply not allowed is terminal and leaves the public reply intact', async () => {
    mocks.privateReply.mockRejectedValue(new FacebookApiError(10, 2018278)); await processFacebookJob(job); await processFacebookJob(job);
    expect(row).toMatchObject({ publicStatus: 'SENT', privateStatus: 'FAILED' }); expect(row.privateError).toContain('2018278');
    expect(mocks.privateReply).toHaveBeenCalledTimes(1);
  });
  it('does not resend ambiguous transport failures', async () => {
    mocks.privateReply.mockRejectedValue(new Error('timeout')); await processFacebookJob(job); await processFacebookJob(job);
    expect(row.privateStatus).toBe('UNCONFIRMED'); expect(mocks.privateReply).toHaveBeenCalledTimes(1);
  });
  it('enforces the seven-day private reply window', async () => {
    row.commentCreatedAt = new Date(Date.now() - 8 * 86400000); await processFacebookJob(job);
    expect(row.privateStatus).toBe('SKIPPED'); expect(mocks.privateReply).not.toHaveBeenCalled(); expect(mocks.publicReply).toHaveBeenCalledOnce();
  });
  it('does not process a job from another workspace', async () => {
    await processFacebookJob({ ...job, workspaceId: 'other-workspace' }); expect(mocks.privateReply).not.toHaveBeenCalled();
  });
  it('ignores stale jobs after reconnect', async () => {
    await processFacebookJob({ ...job, connectedAt: new Date(0).toISOString() }); expect(mocks.privateReply).not.toHaveBeenCalled(); expect(row.privateStatus).toBe('SKIPPED');
  });
  it('has no Facebook storage/queue/API access outside staging', async () => {
    vi.stubEnv('OPENREPLY_ENV', 'production'); await processFacebookWebhook(payload()); await processFacebookJob(job);
    expect(mocks.prisma.facebookPage.findUnique).not.toHaveBeenCalled(); expect(mocks.prisma.facebookDelivery.findFirst).not.toHaveBeenCalled();
  });
  it('authenticates with the separate Page app secret only', () => {
    const raw = JSON.stringify(payload()); const sign = (secret: string) => `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
    expect(verifyFacebookSignature(raw, sign('facebook-secret'))).toBe(true);
    expect(verifyFacebookSignature(raw, sign('instagram-secret'))).toBe(false);
    expect(verifyFacebookSignature(raw + ' ', sign('facebook-secret'))).toBe(false);
    expect(verifyFacebookSignature(raw, null)).toBe(false);
  });
  it('validates campaign targets, keywords and enabled replies', () => {
    const valid = { name: 'Offer', facebookPageId: 'page', keywords: ['link'], privateReplyMessage: 'Hi' };
    expect(facebookCampaignSchema.safeParse(valid).success).toBe(true);
    for (const patch of [{ keywords: [] }, { matchAnyPost: false }, { privateReplyMessage: '' }, { privateReplyEnabled: false }]) {
      expect(facebookCampaignSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
    }
  });
});
