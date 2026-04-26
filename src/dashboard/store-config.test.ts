// src/dashboard/store-config.test.ts

import { describe, it, expect } from 'vitest';
import { STORE_NAMES } from './shared/store-types.js';
import { STORE_CONFIG } from './store-config.js';

describe('STORE_CONFIG', () => {
  it('has an entry for every StoreName', () => {
    for (const name of STORE_NAMES) {
      expect(STORE_CONFIG[name]).toBeDefined();
      expect(STORE_CONFIG[name].name).toBe(name);
    }
  });

  it('every store has at least one column', () => {
    for (const name of STORE_NAMES) {
      expect(STORE_CONFIG[name].columns.length).toBeGreaterThan(0);
    }
  });

  it('defaultSort.key appears in sortable allow-list', () => {
    for (const name of STORE_NAMES) {
      const cfg = STORE_CONFIG[name];
      expect(cfg.sortable).toContain(cfg.defaultSort.key);
    }
  });

  it('every filter key references a known column', () => {
    for (const name of STORE_NAMES) {
      const cfg = STORE_CONFIG[name];
      const cols = new Set(cfg.columns.map((c) => c.key));
      for (const f of cfg.filters) expect(cols.has(f.key)).toBe(true);
    }
  });
});
