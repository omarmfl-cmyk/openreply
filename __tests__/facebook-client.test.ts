import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { exchangeFacebookCode, facebookRequest, listManagedPages, sendPrivateReply, sendPublicReply } from '@/lib/facebook/client';
const http = vi.fn<typeof fetch>();
beforeEach(() => {
  http.mockReset(); vi.stubGlobal('fetch', http);
  vi.stubEnv('OPENREPLY_ENV', 'staging'); vi.stubEnv('FACEBOOK_AUTOMATION_ENABLED', 'true'); vi.stubEnv('FACEBOOK_PAGE_GRAPH_API_VERSION', 'v26.0');
  vi.stubEnv('FACEBOOK_PAGE_APP_ID', '123'); vi.stubEnv('FACEBOOK_PAGE_APP_SECRET', 'app-secret');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it('posts public replies to the comment edge with a Page Bearer token', async () => {
  http.mockResolvedValue(Response.json({ id: 'reply' }));
  expect(await sendPublicReply('token', '100_200', 'Hello')).toBe('reply');
  expect(http).toHaveBeenCalledWith('https://graph.facebook.com/v26.0/100_200/comments', expect.objectContaining({
    method: 'POST', headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Hello' }),
  }));
});
it('private reply addresses comment_id, never treats an author ID as a Messenger recipient', async () => {
  http.mockResolvedValue(Response.json({ message_id: 'message' }));
  expect(await sendPrivateReply('token', '100', '100_200', 'Hi')).toBe('message');
  expect(http).toHaveBeenCalledWith('https://graph.facebook.com/v26.0/100/messages', expect.objectContaining({ body: JSON.stringify({ recipient: { comment_id: '100_200' }, message: { text: 'Hi' } }) }));
});
it('redacts Meta error messages while preserving the reason code', async () => {
  http.mockResolvedValue(Response.json({ error: { code: 10, error_subcode: 99, message: 'token=secret' } }, { status: 400 }));
  const error = await sendPrivateReply('token', '100', '100_200', 'Hi').catch(e => e);
  expect(error.message).toContain('code 10, subcode 99'); expect(error.message).not.toContain('secret'); expect(http).toHaveBeenCalledOnce();
});
it('does not treat a successful HTTP response without a reply ID as confirmed delivery', async () => {
  http.mockResolvedValue(Response.json({})); await expect(sendPublicReply('token', '100_200', 'Hi')).rejects.toThrow('unconfirmed');
});
it('discovers all Pages using cursors without fetching arbitrary paging URLs', async () => {
  http.mockResolvedValueOnce(Response.json({ data: [{ id: '100', name: 'First', access_token: 'one' }], paging: { next: 'https://untrusted.test', cursors: { after: 'next' } } }))
    .mockResolvedValueOnce(Response.json({ data: [{ id: '200', name: 'Second', access_token: 'two' }] }));
  expect((await listManagedPages('user-token')).map(p => p.id)).toEqual(['100', '200']);
  expect(String(http.mock.calls[1][0])).toContain('https://graph.facebook.com/v26.0/me/accounts?');
  expect(String(http.mock.calls[1][0])).toContain('after=next');
});
it('exchanges the OAuth code server-side with the exact callback', async () => {
  http.mockResolvedValue(Response.json({ access_token: 'user-token' }));
  expect(await exchangeFacebookCode('code', 'https://staging.test/api/facebook/callback')).toBe('user-token');
  const url = new URL(String(http.mock.calls[0][0])); expect(url.searchParams.get('redirect_uri')).toBe('https://staging.test/api/facebook/callback');
  expect(url.searchParams.get('client_secret')).toBe('app-secret');
});
it('blocks API access outside staging', async () => {
  vi.stubEnv('OPENREPLY_ENV', 'production'); await expect(facebookRequest('me', 'token')).rejects.toThrow('disabled'); expect(http).not.toHaveBeenCalled();
});
