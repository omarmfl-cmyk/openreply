"use client";
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { FacebookCampaignInput } from '@/lib/facebook/campaigns';

export const emptyFacebookCampaign: FacebookCampaignInput = {
  name: '', facebookPageId: '', postId: null, matchAnyPost: true, keywords: [], matchAnyWord: false,
  wholeWordMatch: true, privateReplyEnabled: true, privateReplyMessage: '', publicReplyEnabled: false, publicReplyMessage: '', isActive: true,
};
export type FacebookCampaignRecord = FacebookCampaignInput & { id: string; automationId: string | null; facebookPage?: { name: string } };

export function FacebookFields({ value, onChange }: { value: FacebookCampaignInput; onChange: (value: FacebookCampaignInput) => void }) {
  const [pages, setPages] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState('');
  const [keywordText, setKeywordText] = useState(value.keywords.join(', '));
  useEffect(() => {
    fetch('/api/facebook/pages', { cache: 'no-store' }).then(r => r.json()).then(d => {
      if (!d.success) throw new Error(d.error);
      setPages(d.data);
    }).catch(e => setError(e.message));
  }, []);
  const field = 'block w-full rounded border border-border bg-surface p-2 mt-1';
  function set(patch: Partial<FacebookCampaignInput>) { onChange({ ...value, ...patch }); }
  return <fieldset className="panel rounded p-4 space-y-3">
    <legend className="font-semibold">Facebook comment replies</legend>
    {error && <p role="alert">{error}</p>}
    <label className="block">Facebook campaign name<input className={field} value={value.name} maxLength={100} onChange={e => set({ name: e.target.value })} required /></label>
    <label className="block">Facebook Page<select className={field} value={value.facebookPageId} onChange={e => set({ facebookPageId: e.target.value, postId: null })} required>
      <option value="">Select a connected Page</option>{pages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select></label>
    {!pages.length && <p className="text-sm text-muted">Connect a Facebook Page in Settings first.</p>}
    <label className="block"><input type="checkbox" checked={value.matchAnyPost} onChange={e => set({ matchAnyPost: e.target.checked })} /> Match all Page posts</label>
    {!value.matchAnyPost && <label className="block">Facebook post ID (PageID_PostID)<input className={field} value={value.postId ?? ''} onChange={e => set({ postId: e.target.value || null })} /></label>}
    <label className="block"><input type="checkbox" checked={value.matchAnyWord} onChange={e => set({ matchAnyWord: e.target.checked })} /> Match any word</label>
    {!value.matchAnyWord && <label className="block">Facebook keywords, separated by commas<input className={field} value={keywordText} onChange={e => { setKeywordText(e.target.value); set({ keywords: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }); }} /></label>}
    <label className="block"><input type="checkbox" checked={value.wholeWordMatch} onChange={e => set({ wholeWordMatch: e.target.checked })} /> Whole-word matching</label>
    <label className="block"><input type="checkbox" checked={value.publicReplyEnabled} onChange={e => set({ publicReplyEnabled: e.target.checked })} /> Public comment reply</label>
    {value.publicReplyEnabled && <label className="block">Public reply<textarea className={field} maxLength={1000} value={value.publicReplyMessage ?? ''} onChange={e => set({ publicReplyMessage: e.target.value })} /></label>}
    <label className="block"><input type="checkbox" checked={value.privateReplyEnabled} onChange={e => set({ privateReplyEnabled: e.target.checked })} /> Private Messenger reply</label>
    {value.privateReplyEnabled && <label className="block">Private reply<textarea className={field} maxLength={1000} value={value.privateReplyMessage} onChange={e => set({ privateReplyMessage: e.target.value })} /></label>}
    <p className="text-xs text-muted">One private reply per comment within seven days, when Facebook permits. Use plain text and full links.</p>
    <label className="block"><input type="checkbox" checked={value.isActive} onChange={e => set({ isActive: e.target.checked })} /> Facebook campaign active</label>
  </fieldset>;
}

export function FacebookCampaignEditor({ campaignId, initial = emptyFacebookCampaign, replaceAutomationId }: { campaignId?: string; initial?: FacebookCampaignInput; replaceAutomationId?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [loading, setLoading] = useState(!!campaignId);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [platform, setPlatform] = useState('Facebook');
  const [automationId, setAutomationId] = useState('');
  const [originalAutomationId, setOriginalAutomationId] = useState('');
  const [instagramCampaigns, setInstagramCampaigns] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (!campaignId) return;
    fetch('/api/facebook/campaigns', { cache: 'no-store' }).then(r => r.json()).then(d => {
      const row = d.data?.find((c: FacebookCampaignRecord) => c.id === campaignId);
      if (!row) throw new Error('Facebook campaign not found');
      setValue(row);
      setAutomationId(row.automationId ?? '');
      setOriginalAutomationId(row.automationId ?? '');
      setPlatform(row.automationId ? 'Both' : 'Facebook');
    }).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [campaignId]);
  useEffect(() => {
    if (!campaignId) return;
    fetch('/api/automations', { cache: 'no-store' }).then(r => r.json()).then(d => {
      if (d.success) setInstagramCampaigns(d.data.map((c: { id: string; name: string }) => ({ id: c.id, name: c.name })));
    }).catch(() => setError('Could not load Instagram campaigns'));
  }, [campaignId]);
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      if (platform !== 'Facebook' && !automationId) throw new Error('Choose the Instagram campaign to use');
      const result = await fetch(`/api/facebook/campaigns${campaignId ? `?id=${campaignId}` : ''}`, {
        method: campaignId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...value,
          isActive: platform === 'Instagram' ? false : value.isActive,
          automationId: platform === 'Both' ? automationId : null,
          replaceAutomationId: replaceAutomationId || (platform === 'Facebook' ? originalAutomationId || undefined : undefined) }),
      }).then(r => r.json());
      if (!result.success) throw new Error(result.error);
      router.push(platform === 'Instagram' ? `/campaigns/${automationId}/edit` : '/campaigns'); router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed'); }
    finally { setBusy(false); }
  }
  if (loading) return <p>Loading Facebook campaign…</p>;
  return <form onSubmit={save} className="max-w-2xl space-y-4">
    {error && <p role="alert" className="text-error">{error}</p>}
    {campaignId && !replaceAutomationId && <label className="block">Platform<select className="block border border-border bg-surface rounded p-2" value={platform} onChange={e => setPlatform(e.target.value)}><option>Instagram</option><option>Facebook</option><option>Both</option></select></label>}
    {platform !== 'Facebook' && <label className="block">Use an existing Instagram campaign<select className="block w-full border border-border bg-surface rounded p-2" value={automationId} onChange={e => setAutomationId(e.target.value)}><option value="">Select campaign</option>{instagramCampaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select><span className="text-xs text-muted">Instagram keeps its current account, posts and message settings.</span></label>}
    <FacebookFields key={campaignId ?? 'new'} value={value} onChange={setValue} />
    {replaceAutomationId && <p className="text-sm text-muted">Saving Facebook-only pauses the previous Instagram campaign.</p>}
    <button disabled={busy} className="rounded bg-accent px-4 py-2 text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save Facebook campaign'}</button>
  </form>;
}
