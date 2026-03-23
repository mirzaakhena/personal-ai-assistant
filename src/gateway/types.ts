import type { MediaContentBlock } from '../utils/media.js';

export interface IncomingMessage {
  userId: string;
  body: string;
  mediaBlocks?: MediaContentBlock[];
  quotedBody?: string;
}

export type GatewayType = 'whatsapp' | 'webchat';

export interface MessageGateway {
  readonly type: GatewayType;
  sendMessage(userId: string, content: string): Promise<void>;
  start(onMessage: (msg: IncomingMessage) => Promise<void>): Promise<void>;
  stop(): Promise<void>;
}
