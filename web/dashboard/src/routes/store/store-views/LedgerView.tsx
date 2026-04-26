// web/dashboard/src/routes/store/store-views/LedgerView.tsx

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/stores.js';
import type { StoreConfig } from '@shared/store-meta.js';
import { FilterBar, type FilterValues } from '../../../components/FilterBar.js';
import { Pagination } from '../../../components/Pagination.js';
import { RefreshButton } from '../../../components/RefreshButton.js';
import { ErrorBanner } from '../../../components/ErrorBanner.js';
import { ChartCard } from '../../../components/ChartCard.js';
import { JsonDrawer } from '../../../components/JsonDrawer.js';
import { fmtTimestamp } from '../../../lib/format.js';

export function LedgerView({ uid, cfg }: { uid: string; cfg: StoreConfig }) {
  const [filter, setFilter] = useState<FilterValues>({});
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState(`${cfg.defaultSort.key}:${cfg.defaultSort.dir}`);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const params = new URLSearchParams({ page: String(page), limit: '50', sort });
  for (const [k, v] of Object.entries(filter)) {
    if (Array.isArray(v)) v.forEach((vv) => params.append(`filter[${k}]`, vv));
    else if (v) params.set(`filter[${k}]`, v);
  }

  const list = useQuery({
    queryKey: ['storeList', uid, 'ledger', params.toString()],
    queryFn: () => api.storeList(uid, 'ledger', params),
  });
  const stats = useQuery({
    queryKey: ['storeStats', uid, 'ledger'],
    queryFn: () => api.storeStats(uid, 'ledger'),
  });

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">ledger</h1>
        <RefreshButton queryKey={['storeList', uid, 'ledger']} />
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
          <div className="overflow-x-auto border rounded">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 text-left">
                <tr>
                  <th className="px-3 py-2">Stream</th>
                  <th className="px-3 py-2">Tags</th>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {list.data.rows.map((row) => {
                  const id = String(row.id);
                  const open = expanded.has(id);
                  return (
                    <>
                      <tr key={id} className="border-t hover:bg-slate-50">
                        <td className="px-3 py-2">{String(row.stream ?? '')}</td>
                        <td className="px-3 py-2">{String(row.tags ?? '')}</td>
                        <td className="px-3 py-2">{fmtTimestamp(Number(row.ts))}</td>
                        <td className="px-3 py-2">
                          <button onClick={() => toggle(id)} className="text-xs underline">
                            {open ? 'hide payload' : 'show payload'}
                          </button>
                        </td>
                      </tr>
                      {open && (
                        <tr key={`${id}-body`} className="border-t bg-slate-50">
                          <td colSpan={4} className="p-3"><JsonDrawer value={row.payload} /></td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={list.data.page} limit={list.data.limit}
                      total={list.data.total} onChange={setPage} />
        </>
      )}
    </div>
  );
}
