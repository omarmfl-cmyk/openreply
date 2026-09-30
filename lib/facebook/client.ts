import { z } from 'zod';
import { requireEnv } from '@/lib/env';
import { facebookVersion, requireFacebook } from './config';

export class FacebookApiError extends Error {
  constructor(public code: number, public subcode: number | undefined) {
    // Do not persist Meta's raw error text: it can contain tokens or user data.
    super(`Facebook rejected the request (code ${code}${subcode ? `, subcode ${subcode}` : ''}). Check Page permissions, token validity and reply eligibility.`);
  }
}

export async function facebookRequest(path: string, token: string, body?: object) {
  requireFacebook();
  const response = await fetch(`https://graph.facebook.com/${facebookVersion()}/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store', signal: AbortSignal.timeout(20000),
  });
  const data = await response.json();
  if (data.error || !response.ok) throw new FacebookApiError(data.error?.code ?? response.status, data.error?.error_subcode);
  return data;
}

export async function exchangeFacebookCode(code: string, redirectUri: string) {
  requireFacebook();
  const params = new URLSearchParams({
    client_id: requireEnv('FACEBOOK_PAGE_APP_ID'),
    client_secret: requireEnv('FACEBOOK_PAGE_APP_SECRET'), redirect_uri: redirectUri, code,
  });
  const response = await fetch(`https://graph.facebook.com/${facebookVersion()}/oauth/access_token?${params}`, {
    cache: 'no-store', signal: AbortSignal.timeout(20000),
  });
  const data = await response.json();
  if (!response.ok || typeof data.access_token !== 'string') throw new Error('Facebook token exchange failed');
  return data.access_token as string;
}

const pageSchema = z.object({ id: z.string().regex(/^\d+$/), name: z.string(), access_token: z.string().min(1), tasks: z.array(z.string()).default([]) });
export type ManagedPage = z.infer<typeof pageSchema>;

export async function listManagedPages(token: string): Promise<ManagedPage[]> {
  const pages: ManagedPage[] = [];
  let after: string | undefined;
  const seen = new Set<string>();
  do {
    const params = new URLSearchParams({ fields: 'id,name,access_token,tasks', limit: '100' });
    if (after) params.set('after', after);
    const data = await facebookRequest(`me/accounts?${params}`, token);
    pages.push(...z.array(pageSchema).parse(data.data));
    after = data.paging?.next ? data.paging?.cursors?.after : undefined;
    if (after && seen.has(after)) throw new Error('Facebook returned a repeated Page cursor');
    if (after) seen.add(after);
  } while (after);
  return pages;
}

export async function sendPublicReply(token: string, commentId: string, message: string) {
  const data = await facebookRequest(`${encodeURIComponent(commentId)}/comments`, token, { message });
  if (typeof data.id !== 'string') throw new Error('Facebook reply outcome is unconfirmed');
  return data.id as string;
}

export async function sendPrivateReply(token: string, pageId: string, commentId: string, text: string) {
  const data = await facebookRequest(`${pageId}/messages`, token, { recipient: { comment_id: commentId }, message: { text } });
  if (typeof data.message_id !== 'string') throw new Error('Facebook private reply outcome is unconfirmed');
  return data.message_id as string;
}
