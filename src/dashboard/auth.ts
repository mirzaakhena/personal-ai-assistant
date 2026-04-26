// src/dashboard/auth.ts

import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler, Express } from 'express';

export const COOKIE_NAME = 'pai_dashboard';
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function unauthenticated(res: Parameters<RequestHandler>[1]): void {
  res.status(401).json({
    error: { code: 'UNAUTHENTICATED', message: 'login required' },
  });
}

export function createAuthMiddleware(opts: { token: string }): RequestHandler {
  return (req, res, next) => {
    const cookieVal = (req as { cookies?: Record<string, string> }).cookies?.[COOKIE_NAME];
    if (!cookieVal || !safeEqual(cookieVal, opts.token)) {
      unauthenticated(res);
      return;
    }
    next();
  };
}

export function mountAuthRoutes(
  app: Express,
  opts: { token: string; secureCookie: boolean },
): void {
  app.post('/api/auth', (req, res) => {
    const submitted = (req.body as { token?: unknown })?.token;
    if (typeof submitted !== 'string' || !safeEqual(submitted, opts.token)) {
      unauthenticated(res);
      return;
    }
    res.cookie(COOKIE_NAME, opts.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: opts.secureCookie,
      maxAge: COOKIE_MAX_AGE_MS,
      path: '/',
    });
    res.json({ ok: true });
  });

  app.post('/api/auth/logout', (_req, res) => {
    res.cookie(COOKIE_NAME, '', {
      httpOnly: true,
      sameSite: 'lax',
      secure: opts.secureCookie,
      maxAge: 0,
      path: '/',
    });
    res.json({ ok: true });
  });
}
