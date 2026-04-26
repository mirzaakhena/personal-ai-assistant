// web/dashboard/src/routes/store/store-views/TasksView.tsx

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/stores.js';
import type { StoreConfig } from '@shared/store-meta.js';
import { FilterBar, type FilterValues } from '../../../components/FilterBar.js';
import { Pagination } from '../../../components/Pagination.js';
import { RefreshButton } from '../../../components/RefreshButton.js';
import { ErrorBanner } from '../../../components/ErrorBanner.js';
import { ChartCard } from '../../../components/ChartCard.js';
import { fmtTimestamp } from '../../../lib/format.js';

const PILL: Record<string, string> = {
  pending:   'bg-yellow-100 text-yellow-900',
  done:      'bg-green-100 text-green-900',
  cancelled: 'bg-slate-200 text-slate-700',
};

export function TasksView({ uid, cfg }: { uid: string; cfg: StoreConfig }) {
  const [filter, setFilter] = useState<FilterValues>({});
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page), limit: '50' });
  for (const [k, v] of Object.entries(filter)) {
    if (Array.isArray(v)) v.forEach((vv) => params.append(`filter[${k}]`, vv));
    else if (v) params.set(`filter[${k}]`, v);
  }

  const list = useQuery({
    queryKey: ['storeList', uid, 'tasks', params.toString()],
    queryFn: () => api.storeList(uid, 'tasks', params),
  });
  const stats = useQuery({
    queryKey: ['storeStats', uid, 'tasks'],
    queryFn: () => api.storeStats(uid, 'tasks'),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">tasks</h1>
        <RefreshButton queryKey={['storeList', uid, 'tasks']} />
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
                  <th className="px-3 py-2">Title</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Trigger</th>
                  <th className="px-3 py-2">Due</th>
                  <th className="px-3 py-2">Updated</th>
                </tr>
              </thead>
              <tbody>
                {list.data.rows.map((row, i) => (
                  <tr key={i} className="border-t hover:bg-slate-50">
                    <td className="px-3 py-2">{String(row.title ?? '')}</td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded text-xs ${PILL[String(row.status)] ?? 'bg-slate-100'}`}>
                        {String(row.status)}
                      </span>
                    </td>
                    <td className="px-3 py-2">{String(row.trigger_type ?? '')}</td>
                    <td className="px-3 py-2">{String(row.due_date ?? '')}</td>
                    <td className="px-3 py-2">{fmtTimestamp(Number(row.updated_at))}</td>
                  </tr>
                ))}
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
