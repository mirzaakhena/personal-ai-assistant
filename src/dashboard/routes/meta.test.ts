// src/dashboard/routes/meta.test.ts

import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mountMetaRoute } from './meta.js';
import { STORE_NAMES } from '../shared/store-types.js';

describe('GET /api/meta', () => {
  it('returns the full store config map', async () => {
    const app = express();
    mountMetaRoute(app);
    const r = await request(app).get('/api/meta');
    expect(r.status).toBe(200);
    for (const name of STORE_NAMES) {
      expect(r.body.stores[name]).toBeDefined();
      expect(r.body.stores[name].name).toBe(name);
    }
  });
});
