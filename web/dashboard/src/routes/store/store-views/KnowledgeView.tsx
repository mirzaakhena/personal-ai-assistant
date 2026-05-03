import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/stores.js';
import type { StoreConfig } from '@shared/store-meta.js';
import { Pagination } from '../../../components/Pagination.js';
import { RefreshButton } from '../../../components/RefreshButton.js';
import { ErrorBanner } from '../../../components/ErrorBanner.js';
import { ChartCard } from '../../../components/ChartCard.js';
import { GenericStoreView } from '../$store.js';
import { useDebouncedValue } from '../../../lib/use-debounced-value.js';

export function KnowledgeView({ uid, cfg }: { uid: string; cfg: StoreConfig }) {
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 2000);
  const trimmed = debouncedQ.trim();

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">knowledge</h1>
        <RefreshButton queryKey={['knowledgeSearch', uid, trimmed]} />
      </div>
      <SearchBox value={q} onChange={setQ} />
      {trimmed
        ? <SearchMode uid={uid} q={trimmed} cfg={cfg} />
        : <BrowseMode uid={uid} cfg={cfg} />}
    </div>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="mb-4">
      <input
        type="search" value={value} onChange={(e) => onChange(e.target.value)}
        placeholder="Search knowledge (FTS5; clear to browse)"
        className="bg-surface border border-border focus:border-accent rounded px-3 py-2 w-96 text-sm transition"
      />
    </div>
  );
}

function BrowseMode({ uid, cfg }: { uid: string; cfg: StoreConfig }) {
  return <GenericStoreView uid={uid} storeName="knowledge" cfg={cfg} />;
}

function SearchMode({ uid, q, cfg }: { uid: string; q: string; cfg: StoreConfig }) {
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ q, page: String(page), limit: '50' });
  const search = useQuery({
    queryKey: ['knowledgeSearch', uid, q, page],
    queryFn: () => api.knowledgeSearch(uid, params),
  });
  const stats = useQuery({
    queryKey: ['storeStats', uid, 'knowledge'],
    queryFn: () => api.storeStats(uid, 'knowledge'),
    enabled: cfg.charts.length > 0,
  });

  return (
    <>
      {stats.data && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          {cfg.charts.map((c) => stats.data!.charts[c.id] && (
            <ChartCard key={c.id} title={c.label} payload={stats.data!.charts[c.id]} />
          ))}
        </div>
      )}
      {search.isError && <ErrorBanner error={search.error} />}
      {search.isLoading && <div className="text-text-muted">Searching…</div>}
      {search.data && (
        <>
          <SnippetTable hits={search.data.hits} />
          <Pagination page={search.data.page} limit={search.data.limit}
                      total={search.data.total} onChange={setPage} />
        </>
      )}
    </>
  );
}

function SnippetTable({ hits }: {
  hits: Array<Record<string, unknown> & { snippet?: string }>;
}) {
  return (
    <div className="overflow-x-auto bg-surface border border-border rounded-lg">
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-left border-b border-border">
          <tr>
            <th className="px-3 py-2 text-xs uppercase tracking-wider text-text-muted">Category</th>
            <th className="px-3 py-2 text-xs uppercase tracking-wider text-text-muted">Key</th>
            <th className="px-3 py-2 text-xs uppercase tracking-wider text-text-muted">Snippet</th>
          </tr>
        </thead>
        <tbody>
          {hits.map((h, i) => (
            <tr key={i} className="border-t border-border hover:bg-surface-2">
              <td className="px-3 py-2 align-top">{String(h.category ?? '')}</td>
              <td className="px-3 py-2 align-top font-mono text-xs">{String(h.key ?? '')}</td>
              <td className="px-3 py-2 align-top text-text-muted"
                  dangerouslySetInnerHTML={{ __html: String(h.snippet ?? '') }} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
