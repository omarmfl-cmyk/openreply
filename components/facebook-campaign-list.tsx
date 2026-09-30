"use client";
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { FacebookCampaignRecord } from './facebook-campaign';

export function FacebookCampaignList() {
  const [rows, setRows] = useState<FacebookCampaignRecord[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    fetch('/api/facebook/pages').then(r => r.json()).then(async d => {
      if (!d.enabled) return;
      const result = await fetch('/api/facebook/campaigns', { cache: 'no-store' }).then(r => r.json());
      if (!result.success) throw new Error(result.error);
      setRows(result.data);
    }).catch(e => setError(e.message));
  }, []);
  if (!rows.length && !error) return null;
  return <section className="space-y-3"><h2 className="font-semibold">Facebook campaigns</h2>
    {error && <p role="alert">{error}</p>}
    {rows.map(row => <div key={row.id} className="panel rounded p-4 flex justify-between gap-3">
      <div><p className="font-semibold">{row.name}</p><p className="text-sm text-muted">{row.automationId ? 'Both · ' : 'Facebook · '}{row.facebookPage?.name} · {row.isActive ? 'Active' : 'Paused'}</p></div>
      <Link href={row.automationId ? `/campaigns/${row.automationId}/edit` : `/campaigns/facebook/${row.id}/edit`} className="text-accent">Edit</Link>
    </div>)}
  </section>;
}
