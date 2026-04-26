import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createQueryCostStore, type QueryCostRecord } from './query-costs.js';

describe('QueryCostStore — dashboard helpers', () => {
  let tmp: string; let db: Database.Database;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'qc-dash-'));
    db = new Database(join(tmp, 'test.db'));
  });
  afterEach(() => { db.close(); rmSync(tmp, { recursive: true, force: true }); });

  function mk(over: Partial<Omit<QueryCostRecord, 'id'>>): Omit<QueryCostRecord, 'id'> {
    return {
      session_id: 'S', timestamp: 1000, model: 'claude-haiku',
      input_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0,
      output_tokens: 0, actual_cost_usd: 0, simulated_api_cost_usd: 0,
      duration_ms: 0, num_turns: 0, ...over,
    };
  }

  it('listPage paginates', () => {
    const s = createQueryCostStore(db);
    for (let i = 0; i < 5; i++) s.insert(mk({ timestamp: 1000 + i }));
    const r = s.listPage({ limit: 3, offset: 0 });
    expect(r.total).toBe(5);
    expect(r.rows.length).toBe(3);
  });

  it('listPage filters by sessionId', () => {
    const s = createQueryCostStore(db);
    s.insert(mk({ session_id: 'A', timestamp: 1000 }));
    s.insert(mk({ session_id: 'B', timestamp: 1001 }));
    const r = s.listPage({ sessionId: 'A', limit: 50, offset: 0 });
    expect(r.total).toBe(1);
    expect(r.rows[0].session_id).toBe('A');
  });

  it('aggregateByDay sums cost per Jakarta YMD', () => {
    const s = createQueryCostStore(db);
    const day1 = Date.UTC(2026, 3, 20, 5);
    s.insert(mk({ timestamp: day1, actual_cost_usd: 0.10 }));
    s.insert(mk({ timestamp: day1, actual_cost_usd: 0.05 }));
    const agg = s.aggregateByDay({ sinceMs: 0 });
    expect(agg.length).toBeGreaterThanOrEqual(1);
    expect(agg.reduce((a, b) => a + b.usd, 0)).toBeCloseTo(0.15, 5);
  });
});
