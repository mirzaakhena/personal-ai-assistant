import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import type { MessageGateway, IncomingMessage } from './types.js';
import { log } from '../utils/logger.js';
import { PROJECT_DIR } from '../core/constants.js';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

export interface WebChatGatewayOptions {
  userId: string;
  port: number;
}

export function createWebChatGateway(opts: WebChatGatewayOptions): MessageGateway {
  const staticDir = join(PROJECT_DIR, 'web', 'dist');
  let wss: WebSocketServer | null = null;
  let activeSocket: WebSocket | null = null;
  let httpServer: ReturnType<typeof createServer> | null = null;

  return {
    async sendMessage(_userId: string, content: string) {
      if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
        activeSocket.send(JSON.stringify({ type: 'message', content }));
        log.chat(`${opts.userId} ← ${content}`);
      } else {
        log.error('[WEBCHAT] no active WebSocket connection');
      }
    },

    async start(onMessage) {
      httpServer = createServer((req, res) => {
        const url = req.url === '/' ? '/index.html' : req.url ?? '/index.html';
        const filePath = join(staticDir, url);

        if (!existsSync(filePath)) {
          const indexPath = join(staticDir, 'index.html');
          if (existsSync(indexPath)) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(readFileSync(indexPath));
          } else {
            res.writeHead(404);
            res.end('Not found. Run: cd web && pnpm build');
          }
          return;
        }

        const ext = extname(filePath);
        const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(readFileSync(filePath));
      });

      wss = new WebSocketServer({ server: httpServer });

      wss.on('connection', (ws) => {
        log.debug('[WEBCHAT] client connected');
        activeSocket = ws;

        ws.on('message', async (data) => {
          try {
            const parsed = JSON.parse(data.toString());
            if (parsed.type === 'message' && typeof parsed.content === 'string') {
              const incoming: IncomingMessage = {
                userId: opts.userId,
                body: parsed.content.trim(),
              };
              await onMessage(incoming);
            }
          } catch (err) {
            log.error('[WEBCHAT] failed to process message', err);
          }
        });

        ws.on('close', () => {
          log.debug('[WEBCHAT] client disconnected');
          if (activeSocket === ws) activeSocket = null;
        });
      });

      await new Promise<void>((resolve) => {
        httpServer!.listen(opts.port, () => {
          log.debug(`[WEBCHAT] listening on http://localhost:${opts.port}`);
          resolve();
        });
      });
    },

    async stop() {
      if (wss) wss.close();
      if (httpServer) httpServer.close();
    },
  };
}
