import type { StoreName } from './store-types.js';

export type ColumnDef = {
  key: string;
  label: string;
  type: 'string' | 'number' | 'timestamp' | 'json' | 'enum';
  width?: number;
  truncateAt?: number;
};

export type FilterDef =
  | { key: string; type: 'string' | 'substring' }
  | { key: string; type: 'enum'; options: readonly string[] }
  | { key: string; type: 'date-range' }
  | { key: string; type: 'number-range' };

export type ChartDef = {
  id: string;
  label: string;
  type: 'line' | 'bar' | 'donut';
};

export type StoreConfig = {
  name: StoreName;
  table: string;                       // SQLite table name (informational)
  primaryKey: readonly string[];       // for row identity in UI
  columns: readonly ColumnDef[];
  filters: readonly FilterDef[];
  sortable: readonly string[];         // allow-list of sort keys
  defaultSort: { key: string; dir: 'asc' | 'desc' };
  charts: readonly ChartDef[];
  fts: boolean;                        // exposes /search endpoint
};
