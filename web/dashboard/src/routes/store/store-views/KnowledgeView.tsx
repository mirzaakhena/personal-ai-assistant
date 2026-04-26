// web/dashboard/src/routes/store/store-views/KnowledgeView.tsx

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/stores.js';
import type { StoreConfig } from '@shared/store-meta.js';
import { Pagination } from '../../../components/Pagination.js';
import { RefreshButton } from '../../../components/RefreshButton.js';
import { ErrorBanner } from '../../../components/ErrorBanner.js';
import { ChartCard } from '../../../components/ChartCard.js';
import { GenericStoreView } from '../$store.js';

export function KnowledgeView({ uid, cfg }: { uid: string; cfg: StoreConfig }) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  if (!q.trim()) return (
    <div>
      <SearchBox value={q} onChange={setQ} />
      <GenericStoreView uid={uid} storeName="knowledge" cfg={cfg} />
    </div>
  );

  const params = new URLSearchParams({ q, page: String(page), limit: '50' });
  const key = ['knowledgeSearch', uid, q, page] as const;
  const search = useQuery({ queryKey: key, queryFn: () => api.knowledgeSearch(uid, params) });
  const stats = useQuery({
    queryKey: ['storeStats', uid, 'knowledge'],
    queryFn: () => api.storeStats(uid, 'knowledge'),
    enabled: cfg.charts.length > 0,
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">knowledge</h1>
        <RefreshButton queryKey={['knowledgeSearch', uid, q]} />
      </div>

      <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} />

      {stats.data && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          {cfg.charts.map((c) => stats.data!.charts[c.id] && (
            <ChartCard key={c.id} title={c.label} payload={stats.data!.charts[c.id]} />
          ))}
        </div>
      )}

      {search.isError && <ErrorBanner error={search.error} />}
      {search.isLoading && <div>Searching…</div>}
      {search.data && (
        <>
          <SnippetTable hits={search.data.hits} />
          <Pagination page={search.data.page} limit={search.data.limit}
                      total={search.data.total} onChange={setPage} />
        </>
      )}
    </div>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="mb-4">
      <input
        type="search" value={value} onChange={(e) => onChange(e.target.value)}
        placeholder="Search knowledge (FTS5; clear to browse)"
        className="border rounded px-3 py-2 w-96"
      />
    </div>
  );
}

function SnippetTable({ hits }: {
  hits: Array<Record<string, unknown> & { snippet?: string }>;
}) {
  return (
    <div className="overflow-x-auto border rounded">
      <table className="w-full text-sm">
        <thead className="bg-slate-100 text-left">
          <tr>
            <th className="px-3 py-2">Category</th>
            <th className="px-3 py-2">Key</th>
            <th className="px-3 py-2">Snippet</th>
          </tr>
        </thead>
        <tbody>
          {hits.map((h, i) => (
            <tr key={i} className="border-t">
              <td className="px-3 py-2 align-top">{String(h.category ?? '')}</td>
              <td className="px-3 py-2 align-top">{String(h.key ?? '')}</td>
              <td className="px-3 py-2 align-top"
                  dangerouslySetInnerHTML={{ __html: String(h.snippet ?? '') }} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
