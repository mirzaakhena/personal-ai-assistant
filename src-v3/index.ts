// src-v3/index.ts

import { createConsoleGateway } from './gateway/console.js';

const gateway = createConsoleGateway();
await gateway.start();
