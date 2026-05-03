import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/stores.js';
import { STORE_CONFIG } from '../../../../../src/dashboard/store-config.js';
import { STORE_NAMES, type StoreName } from '@shared/store-types.js';
import type { StoreConfig } from '@shared/store-meta.js';
import { StoreTable } from '../../components/StoreTable.js';
import type { FilterValues } from '../../components/ColumnFilterRow.js';
import { Pagination } from '../../components/Pagination.js';
import { ChartCard } from '../../components/ChartCard.js';
import { RefreshButton } from '../../components/RefreshButton.js';
import { ErrorBanner } from '../../components/ErrorBanner.js';
import { useDebouncedValue } from '../../lib/use-debounced-value.js';
import { KnowledgeView } from './store-views/KnowledgeView.js';
import { MessagesView } from './store-views/MessagesView.js';
import { LedgerView } from './store-views/LedgerView.js';
import { TasksView } from './store-views/TasksView.js';

const PAGE_LIMIT = 50;

export function StoreRoute() {
  const { uid, store } = useParams<{ uid: string; store: string }>();
  if (!uid || !store) return <div className="text-text-muted">Pick a user + store.</div>;
  if (!STORE_NAMES.includes(store as StoreName)) return <div className="text-text-muted">Unknown store.</div>;
  const storeName = store as StoreName;
  const cfg = STORE_CONFIG[storeName];

  switch (storeName) {
    case 'knowledge': return <KnowledgeView uid={uid} cfg={cfg} />;
    case 'messages':  return <MessagesView  uid={uid} cfg={cfg} />;
    case 'ledger':    return <LedgerView    uid={uid} cfg={cfg} />;
    case 'tasks':     return <TasksView     uid={uid} cfg={cfg} />;
    default:          return <GenericStoreView uid={uid} storeName={storeName} cfg={cfg} />;
  }
}

export function GenericStoreView({ uid, storeName, cfg }: {
  uid: string;
  storeName: StoreName;
  cfg: StoreConfig;
}) {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState(`${cfg.defaultSort.key}:${cfg.defaultSort.dir}`);
  const [filter, setFilter] = useState<FilterValues>({});
  const debouncedFilter = useDebouncedValue(filter, 2000);

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(PAGE_LIMIT));
  params.set('sort', sort);
  for (const [k, v] of Object.entries(debouncedFilter)) {
    if (Array.isArray(v)) {
      if (v[0]) params.set(`filter[${k}]`, v[0]);
      if (v[1]) params.append(`filter[${k}]`, v[1]);
    } else if (v) params.set(`filter[${k}]`, v);
  }

  const listKey = ['storeList', uid, storeName, params.toString()] as const;
  const list = useQuery({ queryKey: listKey, queryFn: () => api.storeList(uid, storeName, params) });

  const statsKey = ['storeStats', uid, storeName] as const;
  const stats = useQuery({
    queryKey: statsKey, queryFn: () => api.storeStats(uid, storeName, '30d'),
    enabled: cfg.charts.length > 0,
  });

  const refreshKey = ['storeList', uid, storeName] as const;
  const hasFilters = Object.keys(filter).length > 0;

  function applyRange(key: string, range: [string, string] | null) {
    setFilter((f) => {
      const next = { ...f };
      if (range === null) delete next[key]; else next[key] = range;
      return next;
    });
    setPage(1);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">{storeName}</h1>
        <div className="flex items-center gap-2">
          {hasFilters && (
            <button onClick={() => setFilter({})}
              className="text-sm border border-border hover:border-border-strong text-text-muted hover:text-text px-3 py-1.5 rounded transition">
              Clear filters
            </button>
          )}
          <RefreshButton queryKey={refreshKey} />
        </div>
      </div>

      {stats.data && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          {cfg.charts.map((c) => stats.data!.charts[c.id] && (
            <ChartCard key={c.id} title={c.label} payload={stats.data!.charts[c.id]} />
          ))}
        </div>
      )}

      {list.isError && <ErrorBanner error={list.error} />}
      {list.isLoading && <div className="text-text-muted mb-3">Loading…</div>}
      {list.data && (
        <>
          <StoreTable config={cfg} rows={list.data.rows} sort={sort}
            onSortChange={(s) => { setSort(s); setPage(1); }}
            filter={filter}
            onFilterChange={(f) => { setFilter(f); setPage(1); }}
            onApplyRange={applyRange} />
          <Pagination page={list.data.page} limit={list.data.limit}
                      total={list.data.total} onChange={setPage} />
        </>
      )}
    </div>
  );
}
