import { createHash } from 'node:crypto';
import { send } from '@vercel/queue';
import { z } from 'zod';
import { prisma } from '@/lib/db/client';
import { decryptToken } from '@/lib/meta/oauth';
import { matchKeywords } from '@/lib/utils/keyword-matcher';
import { facebookEnabled } from './config';
import { FacebookApiError, sendPrivateReply, sendPublicReply } from './client';
import { parseFacebookComments } from './webhook';

export const FACEBOOK_TOPIC = 'facebook-comments';
export const facebookJobSchema = z.object({ deliveryId: z.string().min(1), workspaceId: z.string().min(1), connectedAt: z.string().datetime() });
export type FacebookJob = z.infer<typeof facebookJobSchema>;

export async function processFacebookWebhook(payload: unknown) {
  if (!facebookEnabled()) return;
  for (const comment of parseFacebookComments(payload)) {
    const page = await prisma.facebookPage.findUnique({ where: { pageId: comment.pageId } });
    if (!page || page.disconnectedAt || comment.createdTime * 1000 < page.connectedAt.getTime() - 1000) continue;
    const campaigns = await prisma.facebookCampaign.findMany({
      where: { facebookPageId: page.id, workspaceId: page.workspaceId, isActive: true,
        OR: [{ matchAnyPost: true }, { postId: comment.postId }] },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    for (const campaign of campaigns) {
      const match = campaign.matchAnyWord ? { matched: true, matchedKeyword: null } : matchKeywords(comment.commentText, campaign.keywords, campaign.wholeWordMatch);
      if (!match.matched) continue;
      const delivery = await prisma.facebookDelivery.upsert({
        where: { facebookPageId_campaignId_commentId: { facebookPageId: page.id, campaignId: campaign.id, commentId: comment.commentId } },
        update: {},
        create: { facebookPageId: page.id, campaignId: campaign.id, commentId: comment.commentId,
          postId: comment.postId, commenterId: comment.commenterId, commenterName: comment.commenterName,
          commentText: comment.commentText, matchedKeyword: match.matchedKeyword, commentCreatedAt: new Date(comment.createdTime * 1000),
          publicStatus: campaign.publicReplyEnabled ? 'PENDING' : 'SKIPPED', privateStatus: campaign.privateReplyEnabled ? 'PENDING' : 'SKIPPED' },
      });
      if (delivery.publicStatus !== 'PENDING' && delivery.privateStatus !== 'PENDING') continue;
      const identity = JSON.stringify(['facebook', page.pageId, campaign.id, comment.commentId]);
      // SDK 0.6.0: repeated accepted publishes may return different IDs or null.
      // A thrown publish error must reach Meta as 500 so the durable row is re-enqueued.
      await send(FACEBOOK_TOPIC, { deliveryId: delivery.id, workspaceId: page.workspaceId, connectedAt: page.connectedAt.toISOString() } satisfies FacebookJob,
        { idempotencyKey: createHash('sha256').update(identity).digest('hex'), retentionSeconds: 86400 });
    }
  }
}

export async function processFacebookJob(input: unknown) {
  if (!facebookEnabled()) return;
  const parsed = facebookJobSchema.safeParse(input);
  if (!parsed.success) return;
  const job = parsed.data;
  const delivery = await prisma.facebookDelivery.findFirst({
    where: { id: job.deliveryId, campaign: { workspaceId: job.workspaceId }, facebookPage: { workspaceId: job.workspaceId } },
    include: { campaign: true, facebookPage: true },
  });
  if (!delivery) return;
  const { campaign, facebookPage: page } = delivery;
  if (!campaign.isActive || page.disconnectedAt || page.connectedAt.toISOString() !== job.connectedAt ||
      page.id !== campaign.facebookPageId || !page.accessToken || (page.tokenExpiresAt && page.tokenExpiresAt <= new Date())) {
    for (const channel of ['public', 'private'] as const) {
      await prisma.facebookDelivery.updateMany({ where: { id: delivery.id, [`${channel}Status`]: 'PENDING' },
        data: { [`${channel}Status`]: 'SKIPPED', [`${channel}Error`]: 'Campaign paused, Page disconnected/reconnected, or token expired. Reconnect if needed.' } });
    }
    return;
  }
  let token: string;
  try { token = decryptToken(page.accessToken); }
  catch {
    for (const channel of ['public', 'private'] as const) {
      await prisma.facebookDelivery.updateMany({ where: { id: delivery.id, [`${channel}Status`]: 'PENDING' },
        data: { [`${channel}Status`]: 'FAILED', [`${channel}Error`]: 'Stored Page token could not be decrypted. Reconnect the Page.' } });
    }
    return;
  }
  for (const channel of ['public', 'private'] as const) {
    if (delivery[`${channel}Status`] !== 'PENDING') continue;
    const enabled = channel === 'public' ? campaign.publicReplyEnabled : campaign.privateReplyEnabled;
    const text = channel === 'public' ? campaign.publicReplyMessage : campaign.privateReplyMessage;
    const expired = channel === 'private' && Date.now() - delivery.commentCreatedAt.getTime() >= 7 * 86400000;
    if (!enabled || !text || expired) {
      await prisma.facebookDelivery.updateMany({ where: { id: delivery.id, [`${channel}Status`]: 'PENDING' },
        data: { [`${channel}Status`]: 'SKIPPED', [`${channel}Error`]: expired ? 'Private reply unavailable: comment is at least seven days old.' : 'Reply disabled.' } });
      continue;
    }
    // ponytail: at-most-once sends can miss delivery after a crash before HTTP;
    // add provider-side reconciliation before permitting any manual resend.
    // Claim before the network call. A timeout or process crash is NOT proof of
    // failure. Never resend an ambiguous outcome; show UNCONFIRMED for review.
    const claimed = await prisma.facebookDelivery.updateMany({ where: { id: delivery.id, [`${channel}Status`]: 'PENDING' },
      data: { [`${channel}Status`]: 'UNCONFIRMED', [`${channel}Error`]: 'Delivery started; outcome is unconfirmed. Do not resend automatically.' } });
    if (!claimed.count) continue;
    if (channel === 'private') {
      const privateClaim = await prisma.facebookPrivateClaim.createMany({
        data: [{ id: JSON.stringify(['facebook', page.pageId, delivery.commentId]) }], skipDuplicates: true,
      });
      if (!privateClaim.count) {
        await prisma.facebookDelivery.update({ where: { id: delivery.id }, data: { privateStatus: 'SKIPPED', privateError: 'A private reply was already attempted for this Page comment.' } });
        continue;
      }
    }
    try {
      const replyId = channel === 'public'
        ? await sendPublicReply(token, delivery.commentId, text)
        : await sendPrivateReply(token, page.pageId, delivery.commentId, text);
      await prisma.facebookDelivery.update({ where: { id: delivery.id }, data: {
        [`${channel}Status`]: 'SENT', [`${channel}ReplyId`]: replyId, [`${channel}Error`]: null,
      } });
    } catch (error) {
      await prisma.facebookDelivery.update({ where: { id: delivery.id }, data: {
        [`${channel}Status`]: error instanceof FacebookApiError ? 'FAILED' : 'UNCONFIRMED',
        [`${channel}Error`]: error instanceof FacebookApiError ? error.message : 'Delivery outcome unconfirmed; automatic retries disabled to prevent duplicate replies.',
      } });
    }
  }
}
