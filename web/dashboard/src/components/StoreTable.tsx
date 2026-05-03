import { useState } from 'react';
import type { ColumnDef, StoreConfig } from '@shared/store-meta.js';
import { fmtTimestamp, truncate, fmtJson, truncateUuid } from '../lib/format.js';
import { ContentModal } from './ContentModal.js';
import { ColumnFilterRow, type FilterValues } from './ColumnFilterRow.js';

type ModalState = { title: string; variant: 'text' | 'json'; content: unknown } | null;

export function StoreTable({
  config, rows, sort, onSortChange, filter, onFilterChange, onApplyRange,
}: {
  config: StoreConfig;
  rows: Array<Record<string, unknown>>;
  sort: string;
  onSortChange: (next: string) => void;
  filter: FilterValues;
  onFilterChange: (next: FilterValues) => void;
  onApplyRange: (key: string, range: [string, string] | null) => void;
}) {
  const [sortKey, sortDir] = sort.split(':');
  const [modal, setModal] = useState<ModalState>(null);
  const [toast, setToast] = useState<string | null>(null);

  function clickHeader(col: ColumnDef) {
    if (!config.sortable.includes(col.key)) return;
    if (sortKey === col.key) onSortChange(`${col.key}:${sortDir === 'asc' ? 'desc' : 'asc'}`);
    else onSortChange(`${col.key}:asc`);
  }

  function copyAndToast(text: string) {
    void navigator.clipboard.writeText(text);
    setToast('Copied');
    setTimeout(() => setToast(null), 2000);
  }

  const visibleColumns = config.columns.filter((c) => c.display !== 'hidden');

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left border-b border-border">
            <tr>
              {visibleColumns.map((col) => (
                <th key={col.key} onClick={() => clickHeader(col)}
                    className={`px-3 py-2 text-xs uppercase tracking-wider font-semibold text-text-muted ${
                      config.sortable.includes(col.key) ? 'cursor-pointer hover:text-text' : ''
                    }`}
                    style={{ width: col.width }}>
                  {col.label}
                  {sortKey === col.key && (
                    <span className="text-accent ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>
                  )}
                </th>
              ))}
            </tr>
            <ColumnFilterRow columns={visibleColumns} filters={config.filters}
              value={filter} onChange={onFilterChange} onApplyRange={onApplyRange} />
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={visibleColumns.length}
                  className="px-3 py-6 text-center text-text-muted">
                No rows
              </td></tr>
            )}
            {rows.map((row, i) => (
              <tr key={i} className="border-t border-border hover:bg-surface-2">
                {visibleColumns.map((col) => (
                  <td key={col.key} className="px-3 py-2 align-top">
                    {renderCell(row[col.key], col, setModal, copyAndToast)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ContentModal
        open={modal !== null}
        onClose={() => setModal(null)}
        title={modal?.title}
        variant={modal?.variant ?? 'text'}
        content={modal?.content}
      />
      {toast && (
        <div className="fixed top-4 right-4 bg-surface-2 border border-border-strong text-text px-3 py-2 rounded-lg shadow-lg text-sm z-50">
          {toast}
        </div>
      )}
    </div>
  );
}

function renderCell(
  val: unknown,
  col: ColumnDef,
  setModal: (m: ModalState) => void,
  copyAndToast: (text: string) => void,
): React.ReactNode {
  if (val == null) return <span className="text-text-dim">—</span>;

  if (col.display === 'uuid-short') {
    const full = String(val);
    return (
      <button
        onClick={() => copyAndToast(full)}
        title={`${full} (click to copy)`}
        className="font-mono text-xs text-accent hover:underline"
      >
        {truncateUuid(full)}
      </button>
    );
  }

  switch (col.type) {
    case 'timestamp':
      return <span className="text-text-muted tabular-nums">{fmtTimestamp(val as number)}</span>;

    case 'json': {
      const short = col.truncateAt ? truncate(fmtJson(val), col.truncateAt) : fmtJson(val);
      return (
        <button
          onClick={() => setModal({ title: `${col.label} (json)`, variant: 'json', content: val })}
          className="text-left text-text-muted hover:text-text font-mono text-xs hover:underline"
        >
          {short}
        </button>
      );
    }

    case 'string': {
      const s = String(val);
      if (col.truncateAt && s.length > col.truncateAt) {
        return (
          <button
            onClick={() => setModal({ title: col.label, variant: 'text', content: s })}
            className="text-left text-text hover:underline"
          >
            {truncate(s, col.truncateAt)}
          </button>
        );
      }
      return <span className="text-text">{s}</span>;
    }

    case 'number': return <span className="tabular-nums text-text">{String(val)}</span>;
    case 'enum':   return <span className="text-text">{String(val)}</span>;
  }
}
