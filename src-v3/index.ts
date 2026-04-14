// src-v3/index.ts

import 'dotenv/config';
import { createConsoleGateway } from './gateway/console.js';
import { createTelegramGateway } from './gateway/telegram.js';

// Uncomment ONE gateway:

const gateway = createConsoleGateway();

// const gateway = createTelegramGateway({
//   token: process.env.TELEGRAM_BOT_TOKEN ?? '',
//   whitelist: process.env.TELEGRAM_WHITELIST?.split(',').map(Number) ?? [],
// });

await gateway.start();
