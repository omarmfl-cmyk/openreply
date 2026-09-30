"use client";
import { useEffect, useState } from 'react';

type Row = { id: string; commentText: string; publicStatus: string; privateStatus: string; publicError: string | null; privateError: string | null; campaign: { name: string }; facebookPage: { name: string } };
export function FacebookLogs() {
  const [enabled, setEnabled] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    fetch('/api/facebook/pages').then(r => r.json()).then(async d => {
      if (cancelled || !d.enabled) return;
      setEnabled(true);
      const result = await fetch(`/api/facebook/logs?page=${page}`, { cache: 'no-store' }).then(r => r.json());
      if (!result.success) throw new Error(result.error);
      if (!cancelled) { setRows(result.data); setTotal(result.total); }
    }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [page]);
  if (!enabled) return null;
  return <section className="panel rounded p-4 space-y-3"><h2 className="font-semibold">Facebook logs</h2>
    {error && <p role="alert">{error}</p>}
    {!rows.length && <p className="text-sm text-muted">No Facebook matches yet.</p>}
    {rows.map(row => <div key={row.id} className="border-b border-border py-3 text-sm">
      <p className="font-semibold">Facebook · {row.facebookPage.name} · {row.campaign.name}</p><p>{row.commentText}</p>
      <p>Public: {row.publicStatus} {row.publicError}</p><p>Private: {row.privateStatus} {row.privateError}</p>
    </div>)}
    <div className="flex gap-3"><button disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page}</span><button disabled={page * 20 >= total} onClick={() => setPage(page + 1)}>Next</button></div>
    <h2 className="font-semibold pt-4">Instagram logs</h2>
  </section>;
}
