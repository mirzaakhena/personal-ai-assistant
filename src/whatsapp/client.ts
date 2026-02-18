import wwebjs from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';

const { Client, LocalAuth } = wwebjs;

export function createWhatsAppClient() {
  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
    puppeteer: {
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  });

  client.on('qr', (qr) => {
    console.log('[WA] Scan the QR code below to authenticate:');
    qrcode.generate(qr, { small: true });
  });

  client.on('authenticated', () => {
    console.log('[WA] Authenticated successfully');
  });

  client.on('auth_failure', (msg) => {
    console.error('[WA] Authentication failure:', msg);
  });

  client.on('ready', () => {
    console.log('[WA] Client is ready');
  });

  client.on('disconnected', (reason) => {
    console.warn('[WA] Client disconnected:', reason);
  });

  return client;
}
