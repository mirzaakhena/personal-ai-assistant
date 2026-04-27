// src/dashboard/error-middleware.ts

import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { BadQueryError } from './filter-builder.js';
import { DbBusyError, UserNotFoundError } from './userdb-pool.js';
import { SkillNotFoundError } from './skills-reader.js';
import { log } from '../utils/logger.js';

export class StoreNotFoundError extends Error {
  constructor(public storeName: string) {
    super(`STORE_NOT_FOUND: ${storeName}`);
    this.name = 'StoreNotFoundError';
  }
}

export const errorMiddleware: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof BadQueryError) {
    res.status(400).json({
      error: { code: 'INVALID_QUERY', message: err.message, details: err.details },
    });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: 'INVALID_QUERY', message: 'invalid request', details: err.issues },
    });
    return;
  }
  if (err instanceof UserNotFoundError) {
    res.status(404).json({
      error: { code: 'USER_NOT_FOUND', message: err.message },
    });
    return;
  }
  if (err instanceof StoreNotFoundError) {
    res.status(404).json({
      error: { code: 'STORE_NOT_FOUND', message: err.message },
    });
    return;
  }
  if (err instanceof SkillNotFoundError) {
    res.status(404).json({
      error: { code: 'SKILL_NOT_FOUND', message: err.message },
    });
    return;
  }
  if (err instanceof DbBusyError) {
    res.status(503).json({
      error: { code: 'DB_BUSY', message: err.message },
    });
    return;
  }
  log.error('[dashboard] unhandled error', err);
  res.status(500).json({
    error: { code: 'INTERNAL', message: 'internal error' },
  });
};
