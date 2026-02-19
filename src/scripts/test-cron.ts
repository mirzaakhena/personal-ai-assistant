/**
 * Standalone cronjob smoke test — no Claude SDK, no WhatsApp.
 *
 * Tests:
 *   1. Once job  — fires ~5 seconds from now, verifies DB state
 *   2. Recurring — fires every 5 seconds, stops after 3 fires
 *
 * Run: npx tsx src/scripts/test-cron.ts
 */

import cron from 'node-cron';
import { v4 as uuidv4 } from 'uuid';
import {
  insertCronjob,
  insertExecution,
  updateCronjobStatus,
  getCronjobById,
  getLastExecutionForJob,
} from '../db/cronjobs.js';
import { createCronRegistry } from '../cron/registry.js';

const TIMEZONE = 'Asia/Jakarta';

// Replicate the private timestampToCronExpr from scheduler.ts
function timestampToCronExpr(ms: number): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    second: '2-digit',
    minute: '2-digit',
    hour: '2-digit',
    day: '2-digit',
    month: '2-digit',
    hour12: false,
  }).formatToParts(new Date(ms));

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
  const sec   = parseInt(get('second'), 10);
  const min   = parseInt(get('minute'), 10);
  const hour  = parseInt(get('hour'), 10);
  const day   = parseInt(get('day'), 10);
  const month = parseInt(get('month'), 10);

  return `${sec} ${min} ${hour} ${day} ${month} *`;
}

function wibNow(): string {
  return new Date().toLocaleString('id-ID', { timeZone: TIMEZONE });
}

const registry = createCronRegistry();

// ─────────────────────────────────────────────
// Test 1: Once job
// ─────────────────────────────────────────────
function testOnceJob(): Promise<void> {
  return new Promise((resolve, reject) => {
    const scheduledAt = Date.now() + 5_000;
    const jobId = uuidv4();

    insertCronjob({
      id: jobId,
      phone_number: '628000000000',
      message: 'Halo dari test cronjob!',
      type: 'once',
      schedule_cron: null,
      schedule_human: 'Test: 5 detik dari sekarang',
      scheduled_at: scheduledAt,
      end_date: null,
      status: 'PENDING',
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    const cronExpr = timestampToCronExpr(scheduledAt);
    console.log(`  job id   : ${jobId}`);
    console.log(`  fires at : ${new Date(scheduledAt).toLocaleString('id-ID', { timeZone: TIMEZONE })} WIB`);
    console.log(`  cron expr: ${cronExpr}`);
    console.log('  waiting...');

    const timeout = setTimeout(() => reject(new Error('Once job did not fire within 15s')), 15_000);

    const task = cron.schedule(
      cronExpr,
      () => {
        clearTimeout(timeout);
        task.stop();
        registry.delete(jobId);

        const executionId = uuidv4();
        insertExecution({
          id: executionId,
          cronjob_id: jobId,
          scheduled_at: scheduledAt,
          executed_at: Date.now(),
          status: 'EXECUTED',
          created_at: Date.now(),
        });
        updateCronjobStatus(jobId, 'EXECUTED');

        const job  = getCronjobById(jobId);
        const exec = getLastExecutionForJob(jobId);

        console.log(`  ✓ FIRED at ${wibNow()} WIB`);
        console.log(`  DB job status  : ${job?.status}`);
        console.log(`  DB exec status : ${exec?.status}`);

        if (job?.status !== 'EXECUTED') return reject(new Error(`Expected EXECUTED, got ${job?.status}`));
        if (exec?.status !== 'EXECUTED') return reject(new Error(`Expected exec EXECUTED, got ${exec?.status}`));

        resolve();
      },
      { timezone: TIMEZONE }
    );

    registry.set(jobId, task);
  });
}

// ─────────────────────────────────────────────
// Test 2: Recurring job (every 5 seconds, 3 fires)
// ─────────────────────────────────────────────
function testRecurringJob(): Promise<void> {
  return new Promise((resolve, reject) => {
    const jobId = uuidv4();
    const SCHEDULE = '*/5 * * * * *'; // every 5 seconds (6-field with seconds)
    const MAX_FIRES = 3;
    let fireCount = 0;

    insertCronjob({
      id: jobId,
      phone_number: '628000000000',
      message: 'Recurring test message',
      type: 'recurring',
      schedule_cron: SCHEDULE,
      schedule_human: 'Setiap 5 detik (test)',
      scheduled_at: null,
      end_date: null,
      status: 'ACTIVE',
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    console.log(`  job id   : ${jobId}`);
    console.log(`  cron expr: ${SCHEDULE}`);
    console.log(`  will fire ${MAX_FIRES}x then stop`);

    const timeout = setTimeout(() => reject(new Error('Recurring job did not fire enough times within 30s')), 30_000);

    const task = cron.schedule(
      SCHEDULE,
      () => {
        fireCount++;

        insertExecution({
          id: uuidv4(),
          cronjob_id: jobId,
          scheduled_at: Date.now(),
          executed_at: Date.now(),
          status: 'EXECUTED',
          created_at: Date.now(),
        });

        console.log(`  ✓ FIRED #${fireCount} at ${wibNow()} WIB`);

        if (fireCount >= MAX_FIRES) {
          clearTimeout(timeout);
          task.stop();
          registry.delete(jobId);
          updateCronjobStatus(jobId, 'COMPLETED');

          const job = getCronjobById(jobId);
          console.log(`  DB job status: ${job?.status}`);

          if (job?.status !== 'COMPLETED') return reject(new Error(`Expected COMPLETED, got ${job?.status}`));

          resolve();
        }
      },
      { timezone: TIMEZONE }
    );

    registry.set(jobId, task);
  });
}

// ─────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║   Cronjob Smoke Test (no SDK/WA)     ║');
  console.log('╚══════════════════════════════════════╝\n');

  console.log('▶ Test 1: Once job (fires in ~5 detik)');
  await testOnceJob();
  console.log('  PASSED ✓\n');

  console.log('▶ Test 2: Recurring job (every 5 detik, 3x fires)');
  await testRecurringJob();
  console.log('  PASSED ✓\n');

  console.log('══════════════════════════════════════');
  console.log('  Semua test passed! Cron berfungsi.');
  console.log('══════════════════════════════════════');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n✗ TEST FAILED:', err.message);
  process.exit(1);
});
