// src-v3/trigger/server.ts

import { createServer, IncomingMessage, ServerResponse } from 'http';
import type { TriggerHandler, TriggerServer } from './types.js';
import { log } from '../utils/logger.js';

export interface TriggerServerConfig {
  /** Host to bind, default '127.0.0.1' */
  host?: string;
  /** Port to listen on, default 3100 */
  port?: number;
  /** Called when a valid trigger arrives */
  onTrigger: TriggerHandler;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function sendText(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain' });
  res.end(text);
}

export function createTriggerServer(config: TriggerServerConfig): TriggerServer {
  const host = config.host ?? '127.0.0.1';
  const port = config.port ?? 3100;
  let server: ReturnType<typeof createServer> | null = null;

  function handleRequest(req: IncomingMessage, res: ServerResponse): void {
    if (req.url !== '/trigger') {
      sendText(res, 404, 'Not found');
      return;
    }

    if (req.method !== 'POST') {
      sendText(res, 405, 'Method not allowed');
      return;
    }

    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        sendJson(res, 400, { error: 'invalid_json' });
        return;
      }

      if (typeof parsed !== 'object' || parsed === null) {
        sendJson(res, 400, { error: 'invalid_json' });
        return;
      }

      const { userId, message } = parsed as { userId?: unknown; message?: unknown };

      if (typeof userId !== 'string' || userId.length === 0) {
        sendJson(res, 400, { error: 'missing_field', field: 'userId' });
        return;
      }

      if (typeof message !== 'string' || message.length === 0) {
        sendJson(res, 400, { error: 'missing_field', field: 'message' });
        return;
      }

      // Respond immediately before invoking handler (fire-and-forget)
      sendJson(res, 200, { accepted: true });

      // Invoke handler async; catch and log any error so it doesn't crash process
      config.onTrigger({ userId, message }).catch((err) => {
        log.error(`[TRIGGER] handler failed for ${userId}`, err);
      });
    });
    req.on('error', (err) => {
      log.error('[TRIGGER] request stream error', err);
      if (!res.headersSent) {
        sendText(res, 500, 'Internal error');
      }
    });
  }

  return {
    async start(): Promise<void> {
      return new Promise((resolve, reject) => {
        server = createServer(handleRequest);
        server.once('error', reject);
        server.listen(port, host, () => {
          log.debug(`[TRIGGER] listening on ${host}:${port}`);
          resolve();
        });
      });
    },

    async stop(): Promise<void> {
      if (!server) return;
      return new Promise((resolve, reject) => {
        server!.close((err) => {
          if (err) reject(err);
          else resolve();
        });
        server = null;
      });
    },
  };
}
