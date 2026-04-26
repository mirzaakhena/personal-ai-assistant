// web/dashboard/src/components/FilterBar.tsx

import type { FilterDef, StoreConfig } from '@shared/store-meta.js';

export type FilterValues = Record<string, string | string[]>;

export function FilterBar({
  config, value, onChange,
}: {
  config: StoreConfig;
  value: FilterValues;
  onChange: (next: FilterValues) => void;
}) {
  if (config.filters.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-3 mb-4">
      {config.filters.map((f) => (
        <FilterField key={f.key} def={f} value={value[f.key]}
                     onChange={(v) => onChange({ ...value, [f.key]: v })} />
      ))}
      <button onClick={() => onChange({})} className="text-sm border px-3 py-1 rounded">
        Reset
      </button>
    </div>
  );
}

function FilterField({ def, value, onChange }: {
  def: FilterDef;
  value: string | string[] | undefined;
  onChange: (v: string | string[]) => void;
}) {
  switch (def.type) {
    case 'enum':
      return (
        <label className="text-sm">
          <span className="block text-xs text-slate-500">{def.key}</span>
          <select value={(value as string) ?? ''}
                  onChange={(e) => onChange(e.target.value)}
                  className="border rounded px-2 py-1">
            <option value="">all</option>
            {def.options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
      );
    case 'string':
    case 'substring':
      return (
        <label className="text-sm">
          <span className="block text-xs text-slate-500">{def.key}</span>
          <input type="text" value={(value as string) ?? ''}
                 onChange={(e) => onChange(e.target.value)}
                 className="border rounded px-2 py-1" />
        </label>
      );
    case 'date-range':
    case 'number-range': {
      const arr = (Array.isArray(value) ? value : ['', '']) as string[];
      return (
        <label className="text-sm">
          <span className="block text-xs text-slate-500">{def.key} (from–to)</span>
          <span className="space-x-1">
            <input type="text" value={arr[0]} onChange={(e) => onChange([e.target.value, arr[1]])}
                   className="border rounded px-2 py-1 w-28" placeholder="from" />
            <input type="text" value={arr[1]} onChange={(e) => onChange([arr[0], e.target.value])}
                   className="border rounded px-2 py-1 w-28" placeholder="to" />
          </span>
        </label>
      );
    }
  }
}
