import wwebjs from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { log } from '../utils/logger.js';

const { Client, LocalAuth } = wwebjs;

export function createWhatsAppClient() {
  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
    puppeteer: {
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  });

  client.on('qr', (qr) => {
    log.debug('[WA] scan QR code:');
    qrcode.generate(qr, { small: true });
  });

  client.on('authenticated', () => {
    log.debug('[WA] authenticated');
  });

  client.on('auth_failure', (msg) => {
    log.error('[WA] auth failed', msg);
  });

  client.on('ready', () => {
    log.debug('[WA] ready');
  });

  client.on('disconnected', (reason) => {
    log.error('[WA] disconnected', reason);
  });

  return client;
}
