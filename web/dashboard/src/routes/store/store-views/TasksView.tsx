import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/stores.js';
import type { StoreConfig } from '@shared/store-meta.js';
import { Pagination } from '../../../components/Pagination.js';
import { RefreshButton } from '../../../components/RefreshButton.js';
import { ErrorBanner } from '../../../components/ErrorBanner.js';
import { ChartCard } from '../../../components/ChartCard.js';
import { ColumnFilterRow, type FilterValues } from '../../../components/ColumnFilterRow.js';
import { fmtTimestamp, truncateUuid } from '../../../lib/format.js';
import { useDebouncedValue } from '../../../lib/use-debounced-value.js';

const PILL: Record<string, string> = {
  pending:   'bg-warning/15 text-warning border border-warning/30',
  done:      'bg-success/15 text-success border border-success/30',
  cancelled: 'bg-text-dim/15 text-text-muted border border-text-dim/30',
};

export function TasksView({ uid, cfg }: { uid: string; cfg: StoreConfig }) {
  const [filter, setFilter] = useState<FilterValues>({});
  const [page, setPage] = useState(1);
  const debouncedFilter = useDebouncedValue(filter, 2000);

  const params = new URLSearchParams({ page: String(page), limit: '50' });
  for (const [k, v] of Object.entries(debouncedFilter)) {
    if (Array.isArray(v)) {
      if (v[0]) params.set(`filter[${k}]`, v[0]);
      if (v[1]) params.append(`filter[${k}]`, v[1]);
    } else if (v) params.set(`filter[${k}]`, v);
  }

  const list = useQuery({
    queryKey: ['storeList', uid, 'tasks', params.toString()],
    queryFn: () => api.storeList(uid, 'tasks', params),
  });
  const stats = useQuery({
    queryKey: ['storeStats', uid, 'tasks'],
    queryFn: () => api.storeStats(uid, 'tasks'),
  });

  function applyRange(key: string, range: [string, string] | null) {
    setFilter((f) => {
      const next = { ...f };
      if (range === null) delete next[key]; else next[key] = range;
      return next;
    });
    setPage(1);
  }

  const hasFilters = Object.keys(filter).length > 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">tasks</h1>
        <div className="flex items-center gap-2">
          {hasFilters && (
            <button onClick={() => setFilter({})}
              className="text-sm border border-border hover:border-border-strong text-text-muted hover:text-text px-3 py-1.5 rounded transition">
              Clear filters
            </button>
          )}
          <RefreshButton queryKey={['storeList', uid, 'tasks']} />
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
          <div className="bg-surface border border-border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-left border-b border-border">
                  <tr>
                    <th className="px-3 py-2 text-xs uppercase tracking-wider font-semibold text-text-muted">ID</th>
                    <th className="px-3 py-2 text-xs uppercase tracking-wider font-semibold text-text-muted">Title</th>
                    <th className="px-3 py-2 text-xs uppercase tracking-wider font-semibold text-text-muted">Status</th>
                    <th className="px-3 py-2 text-xs uppercase tracking-wider font-semibold text-text-muted">Trigger</th>
                    <th className="px-3 py-2 text-xs uppercase tracking-wider font-semibold text-text-muted">Due</th>
                    <th className="px-3 py-2 text-xs uppercase tracking-wider font-semibold text-text-muted">Updated</th>
                  </tr>
                  <ColumnFilterRow columns={cfg.columns} filters={cfg.filters}
                    value={filter}
                    onChange={(f) => { setFilter(f); setPage(1); }}
                    onApplyRange={applyRange} />
                </thead>
                <tbody>
                  {list.data.rows.map((row, i) => (
                    <tr key={i} className="border-t border-border hover:bg-surface-2">
                      <td className="px-3 py-2 font-mono text-xs text-accent">{truncateUuid(String(row.id ?? ''))}</td>
                      <td className="px-3 py-2 text-text">{String(row.title ?? '')}</td>
                      <td className="px-3 py-2">
                        <span className={`px-2 py-0.5 rounded text-xs ${PILL[String(row.status)] ?? 'bg-surface-2'}`}>
                          {String(row.status)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-text-muted">{String(row.trigger_type ?? '')}</td>
                      <td className="px-3 py-2 text-text-muted">{String(row.due_date ?? '')}</td>
                      <td className="px-3 py-2 text-text-muted tabular-nums">{fmtTimestamp(Number(row.updated_at))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <Pagination page={list.data.page} limit={list.data.limit}
                      total={list.data.total} onChange={setPage} />
        </>
      )}
    </div>
  );
}
