// src-v3/gateway/console.ts

import * as readline from 'readline/promises';
import { stdin, stdout } from 'process';
import type { Gateway } from './types.js';
import type { AIEngine } from '../ai-engine/index.js';
import type { SessionStore } from '../db/sessions.js';
import { log } from '../utils/logger.js';
import { buildUserPrompt } from '../utils/prompt.js';
import { incrementTurnCount, getTurnCount, clearTurnCount } from '../utils/turns.js';
import { updateStats, getStats, clearStats } from '../utils/stats.js';

export interface ConsoleGatewayConfig {
  engine: AIEngine;
  sessions: SessionStore;
  userId?: string;
}

export function createConsoleGateway(config: ConsoleGatewayConfig): Gateway {
  const { engine, sessions } = config;
  const userId = config.userId ?? 'console-user';
  let rl: readline.Interface | null = null;
  let running = false;

  function getSessionId(): string | undefined {
    return sessions.get(userId);
  }

  function handleNew(): void {
    sessions.delete(userId);
    clearTurnCount(userId);
    clearStats(userId);
    console.log('\nSession cleared. Starting fresh.\n');
  }

  function handleStatus(): void {
    const sessionId = getSessionId();
    const turnCount = getTurnCount(userId);
    const stats = getStats(userId);

    console.log('');
    console.log(`  Session:  ${sessionId ?? 'none'}`);
    console.log(`  Turns:    ${turnCount}`);
    if (stats) {
      console.log(`  Cost:     $${stats.accumulated.costUsd.toFixed(4)} (last: $${stats.lastQuery.costUsd.toFixed(4)})`);
      console.log(`  Duration: ${stats.accumulated.durationMs}ms (last: ${stats.lastQuery.durationMs}ms)`);
      console.log(`  AI Turns: ${stats.accumulated.numTurns} (last: ${stats.lastQuery.numTurns})`);
    } else {
      console.log('  Stats:    no queries yet');
    }
    console.log('');
  }

  async function handleMessage(input: string): Promise<void> {
    const turn = incrementTurnCount(userId);
    const sessionId = getSessionId();
    const prompt = buildUserPrompt(input);

    log.debug(`turn ${turn}, session: ${sessionId ?? 'new'}`);

    const result = await engine.query(prompt, {
      sessionId,
      callbacks: {
        onInit: (info) => log.debug(`model=${info.model} tools=${info.tools.length}`),
        onThinking: (text) => log.debug(`thinking: ${text.slice(0, 80)}...`),
        onToolUse: (name) => log.debug(`tool: ${name}`),
        onSessionId: (id) => log.debug(`session: ${id}`),
        onError: (err) => log.error(`[${err.level}] ${err.reason}: ${err.messages.join(', ')}`),
        onFallback: (text) => {
          log.error('send_message not called');
          if (text) {
            console.log(`\n${text}\n`);
          }
        },
      },
    });

    sessions.save(userId, result.sessionId);
    updateStats(userId, result.sessionId, result.costUsd, result.durationMs, result.numTurns);
  }

  return {
    async start(): Promise<void> {
      running = true;
      rl = readline.createInterface({ input: stdin, output: stdout });

      console.log('');
      console.log('Personal AI Assistant v3 — Console Gateway');
      console.log('Commands: /new (reset session), /status (show stats), /exit (quit)');
      console.log('');

      const savedSession = getSessionId();
      if (savedSession) {
        log.debug(`resuming session: ${savedSession}`);
      }

      while (running) {
        let input: string;
        try {
          input = await rl.question('you > ');
        } catch {
          // readline closed (Ctrl+C or Ctrl+D)
          break;
        }

        const trimmed = input.trim();
        if (!trimmed) continue;

        switch (trimmed) {
          case '/new':
            handleNew();
            break;
          case '/status':
            handleStatus();
            break;
          case '/exit':
            running = false;
            break;
          default:
            await handleMessage(trimmed);
            break;
        }
      }

      await this.stop();
    },

    async stop(): Promise<void> {
      running = false;
      if (rl) {
        rl.close();
        rl = null;
      }
      console.log('\nGoodbye!\n');
    },
  };
}
