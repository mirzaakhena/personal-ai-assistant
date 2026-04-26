// web/dashboard/src/routes/store/$store.tsx

import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/stores.js';
import { STORE_CONFIG } from '../../../../../src/dashboard/store-config.js';
import { STORE_NAMES, type StoreName } from '@shared/store-types.js';
import type { StoreConfig } from '@shared/store-meta.js';
import { StoreTable } from '../../components/StoreTable.js';
import { FilterBar, type FilterValues } from '../../components/FilterBar.js';
import { Pagination } from '../../components/Pagination.js';
import { ChartCard } from '../../components/ChartCard.js';
import { RefreshButton } from '../../components/RefreshButton.js';
import { ErrorBanner } from '../../components/ErrorBanner.js';

const PAGE_LIMIT = 50;

export function StoreRoute() {
  const { uid, store } = useParams<{ uid: string; store: string }>();
  if (!uid || !store) return <div>Pick a user + store.</div>;
  if (!STORE_NAMES.includes(store as StoreName)) return <div>Unknown store.</div>;
  const storeName = store as StoreName;
  const cfg = STORE_CONFIG[storeName];

  // Per-store custom views will be added in Phase 7. For now, all stores use Generic.
  // (Once Phase 7 is in, the dispatcher below will branch on storeName.)
  return <GenericStoreView uid={uid} storeName={storeName} cfg={cfg} />;
}

export function GenericStoreView({ uid, storeName, cfg }: {
  uid: string;
  storeName: StoreName;
  cfg: StoreConfig;
}) {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState(`${cfg.defaultSort.key}:${cfg.defaultSort.dir}`);
  const [filter, setFilter] = useState<FilterValues>({});

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(PAGE_LIMIT));
  params.set('sort', sort);
  for (const [k, v] of Object.entries(filter)) {
    if (Array.isArray(v)) v.forEach((vv) => params.append(`filter[${k}]`, vv));
    else if (v) params.set(`filter[${k}]`, v);
  }

  const listKey = ['storeList', uid, storeName, params.toString()] as const;
  const list = useQuery({ queryKey: listKey, queryFn: () => api.storeList(uid, storeName, params) });

  const statsKey = ['storeStats', uid, storeName] as const;
  const stats = useQuery({
    queryKey: statsKey, queryFn: () => api.storeStats(uid, storeName, '30d'),
    enabled: cfg.charts.length > 0,
  });

  const refreshKey = ['storeList', uid, storeName] as const;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">{storeName}</h1>
        <RefreshButton queryKey={refreshKey} />
      </div>

      {stats.data && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          {cfg.charts.map((c) => stats.data!.charts[c.id] && (
            <ChartCard key={c.id} title={c.label} payload={stats.data!.charts[c.id]} />
          ))}
        </div>
      )}

      <FilterBar config={cfg} value={filter} onChange={(v) => { setFilter(v); setPage(1); }} />

      {list.isError && <ErrorBanner error={list.error} />}
      {list.isLoading && <div>Loading…</div>}
      {list.data && (
        <>
          <StoreTable config={cfg} rows={list.data.rows} sort={sort}
                      onSortChange={(s) => { setSort(s); setPage(1); }} />
          <Pagination page={list.data.page} limit={list.data.limit}
                      total={list.data.total} onChange={setPage} />
        </>
      )}
    </div>
  );
}
