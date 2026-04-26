// web/dashboard/src/components/StoreTable.tsx

import type { ColumnDef, StoreConfig } from '@shared/store-meta.js';
import { fmtTimestamp, truncate, fmtJson } from '../lib/format.js';

export function StoreTable({
  config, rows, sort, onSortChange,
}: {
  config: StoreConfig;
  rows: Array<Record<string, unknown>>;
  sort: string;
  onSortChange: (next: string) => void;
}) {
  const [sortKey, sortDir] = sort.split(':');

  function clickHeader(col: ColumnDef) {
    if (!config.sortable.includes(col.key)) return;
    if (sortKey === col.key) onSortChange(`${col.key}:${sortDir === 'asc' ? 'desc' : 'asc'}`);
    else onSortChange(`${col.key}:asc`);
  }

  return (
    <div className="overflow-x-auto border rounded">
      <table className="w-full text-sm">
        <thead className="bg-slate-100 text-left">
          <tr>
            {config.columns.map((col) => (
              <th key={col.key} onClick={() => clickHeader(col)}
                  className={`px-3 py-2 ${config.sortable.includes(col.key) ? 'cursor-pointer hover:bg-slate-200' : ''}`}
                  style={{ width: col.width }}>
                {col.label}{sortKey === col.key && (sortDir === 'asc' ? ' ↑' : ' ↓')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={config.columns.length} className="px-3 py-6 text-center text-slate-500">
              No rows
            </td></tr>
          )}
          {rows.map((row, i) => (
            <tr key={i} className="border-t hover:bg-slate-50">
              {config.columns.map((col) => (
                <td key={col.key} className="px-3 py-2 align-top">
                  {renderCell(row[col.key], col)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderCell(val: unknown, col: ColumnDef): string {
  if (val == null) return '';
  switch (col.type) {
    case 'timestamp': return fmtTimestamp(val as number);
    case 'json':      return col.truncateAt ? truncate(fmtJson(val), col.truncateAt) : fmtJson(val);
    case 'string':    return col.truncateAt ? truncate(String(val), col.truncateAt) : String(val);
    case 'number':    return String(val);
    case 'enum':      return String(val);
  }
}
