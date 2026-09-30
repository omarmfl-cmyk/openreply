import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const id = z.string().regex(/^\d+(?:_\d+)?$/);
export const facebookCommentSchema = z.object({
  pageId: z.string().regex(/^\d+$/), commentId: id, postId: id,
  commenterId: z.string().regex(/^\d+$/), commenterName: z.string().optional(),
  commentText: z.string().min(1), createdTime: z.number().int().positive(),
});
export type FacebookComment = z.infer<typeof facebookCommentSchema>;

export function verifyFacebookSignature(raw: string, signature: string | null) {
  const secret = process.env.FACEBOOK_PAGE_APP_SECRET;
  if (!secret || !signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export function parseFacebookComments(payload: unknown): FacebookComment[] {
  const envelope = z.object({ object: z.literal('page'), entry: z.array(z.object({
    id: z.string(), changes: z.array(z.object({ field: z.string(), value: z.unknown() })).optional(),
  })) }).safeParse(payload);
  if (!envelope.success) return [];
  const result: FacebookComment[] = [];
  for (const entry of envelope.data.entry) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'feed') continue;
      const value = z.object({ item: z.literal('comment'), verb: z.literal('add'),
        comment_id: id, post_id: id, message: z.string().min(1), created_time: z.number().int().positive(),
        from: z.object({ id: z.string().regex(/^\d+$/), name: z.string().optional() }),
      }).safeParse(change.value);
      if (!value.success || value.data.from.id === entry.id) continue;
      const v = value.data;
      const parsed = facebookCommentSchema.safeParse({ pageId: entry.id, commentId: v.comment_id,
        postId: v.post_id, commentText: v.message, commenterId: v.from.id, commenterName: v.from.name, createdTime: v.created_time });
      if (parsed.success) result.push(parsed.data);
    }
  }
  return result;
}
