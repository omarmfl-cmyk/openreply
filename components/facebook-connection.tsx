"use client";
import { useEffect, useState } from 'react';

export function FacebookConnection({ canManage }: { canManage: boolean }) {
  const [state, setState] = useState<{ enabled: boolean; data: { id: string; name: string; tokenExpiresAt: string | null }[]; available: { id: string; name: string }[] } | null>(null);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function load() {
    const data = await fetch('/api/facebook/pages', { cache: 'no-store' }).then(r => r.json());
    if (!data.success) throw new Error(data.error || 'Could not load Facebook Pages');
    setState(data);
  }
  useEffect(() => {
    const timer = window.setTimeout(() => {
      load().catch(e => setError(e.message));
      const status = new URLSearchParams(window.location.search).get('facebook');
      if (status && ['denied', 'failed', 'misconfigured'].includes(status)) setError(`Facebook connection ${status}. Check staging settings and grant the requested Page permissions.`);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  async function change(method: 'POST' | 'DELETE', body: object) {
    setBusy(true); setError('');
    try {
      const result = await fetch('/api/facebook/pages', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
      if (!result.success) throw new Error(result.error);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Facebook connection failed'); }
    finally { setBusy(false); }
  }
  if (state?.enabled === false) return null;
  return <section className="panel rounded p-4 sm:p-6 space-y-4">
    <h2 className="text-base font-semibold">Facebook Pages</h2>
    {error && <p role="alert" className="text-sm text-error">{error}</p>}
    {state?.data.map(page => <div key={page.id} className="flex items-center justify-between gap-3">
      <div><p>{page.name}</p><p className="text-xs text-muted">{page.tokenExpiresAt ? `Token expires ${new Date(page.tokenExpiresAt).toLocaleString()}` : 'Connected'}</p></div>
      {canManage && <button disabled={busy} onClick={() => change('DELETE', { id: page.id })} className="rounded border border-border px-3 py-2">Disconnect Facebook</button>}
    </div>)}
    {canManage && <a className="inline-block rounded bg-accent px-4 py-2 text-white" href="/api/facebook/connect">Connect Facebook Page</a>}
    {canManage && !!state?.available.length && <div className="space-y-2">
      <label className="block">Choose Facebook Page<select aria-label="Choose Facebook Page" value={selected} onChange={e => setSelected(e.target.value)} className="block w-full border border-border rounded p-2 bg-surface">
        <option value="">Select a Page</option>{state.available.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select></label>
      <button disabled={!selected || busy} onClick={() => change('POST', { pageId: selected })} className="rounded bg-accent px-4 py-2 text-white disabled:opacity-50">Connect selected Page</button>
    </div>}
  </section>;
}
