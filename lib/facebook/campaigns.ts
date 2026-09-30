import { z } from 'zod';

export const facebookCampaignSchema = z.object({
  facebookPageId: z.string().min(1), name: z.string().trim().min(1).max(100),
  postId: z.string().regex(/^\d+_\d+$/).nullable().default(null), matchAnyPost: z.boolean().default(true),
  keywords: z.array(z.string().trim().min(1).max(50)).max(10).default([]),
  matchAnyWord: z.boolean().default(false), wholeWordMatch: z.boolean().default(true),
  privateReplyEnabled: z.boolean().default(true), privateReplyMessage: z.string().trim().max(1000).default(''),
  publicReplyEnabled: z.boolean().default(false), publicReplyMessage: z.string().trim().max(1000).nullable().default(null),
  isActive: z.boolean().default(true),
}).refine(v => v.matchAnyPost || !!v.postId, 'Choose a Facebook post or all posts')
  .refine(v => v.matchAnyWord || v.keywords.length > 0, 'Add Facebook keywords or match any word')
  .refine(v => !v.privateReplyEnabled || !!v.privateReplyMessage, 'Enter a private reply')
  .refine(v => !v.publicReplyEnabled || !!v.publicReplyMessage, 'Enter a public reply')
  .refine(v => v.privateReplyEnabled || v.publicReplyEnabled, 'Enable at least one reply');

export type FacebookCampaignInput = z.infer<typeof facebookCampaignSchema>;
