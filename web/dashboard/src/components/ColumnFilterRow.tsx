import { useEffect, useState } from 'react';
import type { ColumnDef, FilterDef } from '@shared/store-meta.js';

export type FilterValues = Record<string, string | [string, string]>;

type Props = {
  columns: readonly ColumnDef[];
  filters: readonly FilterDef[];
  value: FilterValues;
  onChange: (next: FilterValues) => void;
  onApplyRange: (key: string, range: [string, string] | null) => void;
};

const inputClass =
  'w-full bg-bg border border-border focus:border-accent rounded px-2 py-1 text-xs transition';

function enumOptionsFor(col: ColumnDef, filters: readonly FilterDef[]): readonly string[] | null {
  if (col.enumOptions) return col.enumOptions;
  const match = filters.find((f) => f.key === col.key && f.type === 'enum');
  if (match && match.type === 'enum') return match.options;
  return null;
}

export function ColumnFilterRow({ columns, filters, value, onChange, onApplyRange }: Props) {
  return (
    <tr className="bg-surface border-b border-border">
      {columns.map((col) => (
        <td key={col.key} className="px-2 py-1.5 align-top">
          <FilterCell col={col} filters={filters} value={value[col.key]}
            onChange={(v) => onChange({ ...value, [col.key]: v })}
            onClear={() => {
              const next = { ...value };
              delete next[col.key];
              onChange(next);
            }}
            onApplyRange={(range) => onApplyRange(col.key, range)} />
        </td>
      ))}
    </tr>
  );
}

function FilterCell({
  col, filters, value, onChange, onClear, onApplyRange,
}: {
  col: ColumnDef;
  filters: readonly FilterDef[];
  value: string | [string, string] | undefined;
  onChange: (v: string) => void;
  onClear: () => void;
  onApplyRange: (range: [string, string] | null) => void;
}) {
  if (col.noFilter) return null;

  if (col.type === 'enum') {
    const opts = enumOptionsFor(col, filters);
    if (!opts) return null;
    return (
      <select
        value={(value as string) ?? ''}
        onChange={(e) => e.target.value === '' ? onClear() : onChange(e.target.value)}
        className={inputClass}
      >
        <option value="">all</option>
        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }

  if (col.type === 'string' || col.type === 'json') {
    return (
      <input type="text"
        value={(value as string) ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`filter ${col.key}…`}
        className={inputClass}
      />
    );
  }

  if (col.type === 'timestamp') {
    return <RangeInput type="date" value={value as [string, string] | undefined}
      onApply={onApplyRange} />;
  }

  if (col.type === 'number') {
    return <RangeInput type="number" value={value as [string, string] | undefined}
      onApply={onApplyRange} />;
  }

  return null;
}

function RangeInput({ type, value, onApply }: {
  type: 'date' | 'number';
  value: [string, string] | undefined;
  onApply: (range: [string, string] | null) => void;
}) {
  const applied = value ?? ['', ''];
  const [from, setFrom] = useState(applied[0]);
  const [to,   setTo]   = useState(applied[1]);

  useEffect(() => { setFrom(applied[0]); setTo(applied[1]); }, [applied[0], applied[1]]);

  const dirty = from !== applied[0] || to !== applied[1];

  function apply() {
    if (!from && !to) onApply(null);
    else onApply([from, to]);
  }

  return (
    <div className="flex items-center gap-1">
      <input type={type} value={from} onChange={(e) => setFrom(e.target.value)}
        className={`${inputClass} flex-1`} placeholder={type === 'date' ? '' : 'min'} />
      <span className="text-text-dim text-xs">→</span>
      <input type={type} value={to} onChange={(e) => setTo(e.target.value)}
        className={`${inputClass} flex-1`} placeholder={type === 'date' ? '' : 'max'} />
      <button onClick={apply} disabled={!dirty}
        className="text-xs border border-border hover:border-accent text-text-muted hover:text-accent px-2 py-1 rounded disabled:opacity-30 disabled:hover:border-border disabled:hover:text-text-muted transition">
        Apply
      </button>
    </div>
  );
}
