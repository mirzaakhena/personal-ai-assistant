import type { MediaContentBlock } from '../utils/media.js';

export interface IncomingMessage {
  userId: string;
  body: string;
  mediaBlocks?: MediaContentBlock[];
  quotedBody?: string;
}

export interface MessageGateway {
  sendMessage(userId: string, content: string): Promise<void>;
  start(onMessage: (msg: IncomingMessage) => Promise<void>): Promise<void>;
  stop(): Promise<void>;
}
