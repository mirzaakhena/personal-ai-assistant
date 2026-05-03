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

  // Don't render inputs for columns without a backing FilterDef.
  // Enum is exempt because enumOptions can be defined directly on ColumnDef.
  const hasDef = filters.some((f) => f.key === col.key);
  if (!hasDef && col.type !== 'enum') return null;

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

/** Convert epoch-ms string → YYYY-MM-DD for display in a date input. */
function epochToDateStr(epochStr: string): string {
  const n = Number(epochStr);
  if (!epochStr || !Number.isFinite(n)) return '';
  const d = new Date(n);
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const dd   = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function RangeInput({ type, value, onApply }: {
  type: 'date' | 'number';
  value: [string, string] | undefined;
  onApply: (range: [string, string] | null) => void;
}) {
  // For date type: parent stores epoch-ms strings; local state holds YYYY-MM-DD for display.
  // For number type: no conversion needed; pass values through as-is.
  function toDisplay(v: string): string {
    if (type === 'date') return epochToDateStr(v);
    return v;
  }

  const applied = value ?? ['', ''];
  const [from, setFrom] = useState(() => toDisplay(applied[0]));
  const [to,   setTo]   = useState(() => toDisplay(applied[1]));

  // Re-sync local display state when the applied (parent) value changes.
  useEffect(() => {
    setFrom(toDisplay(applied[0]));
    setTo(toDisplay(applied[1]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied[0], applied[1]]);

  // For dirty comparison, convert current display values back to the wire format.
  function toWire(displayVal: string): string {
    if (type !== 'date' || !displayVal) return displayVal;
    return String(new Date(displayVal + 'T00:00:00').getTime());
  }
  const fromWire = toWire(from);
  const toWire_  = toWire(to);
  const dirty = fromWire !== applied[0] || toWire_ !== applied[1];

  function apply() {
    if (!from && !to) {
      onApply(null);
    } else if (type === 'date') {
      // Open-ended bounds when one side is left empty: 0 (epoch start) for `from`,
      // 8.64e15 (max valid JS Date) for `to`. Backend requires both to be finite numbers.
      const fromEpoch = from ? String(new Date(from + 'T00:00:00').getTime()) : '0';
      const toEpoch   = to   ? String(new Date(to   + 'T23:59:59.999').getTime()) : '8640000000000000';
      onApply([fromEpoch, toEpoch]);
    } else {
      // number-range: same idea — 0 lower bound, MAX_SAFE_INTEGER upper bound when omitted.
      const fromN = from || '0';
      const toN   = to   || String(Number.MAX_SAFE_INTEGER);
      onApply([fromN, toN]);
    }
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
