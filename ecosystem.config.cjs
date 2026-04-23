/**
 * PM2 ecosystem config for personal-ai-assistant v4.
 *
 * Usage:
 *   pnpm build                              # compile TS → dist/
 *   pm2 start ecosystem.config.cjs
 *   pm2 save                                # persist list across reboots
 *   pm2 startup                             # install init-system hook
 *   pm2 logs pai-v4                         # tail logs
 *   pm2 restart pai-v4                      # SIGINT → summarize → restart
 *   pm2 stop pai-v4                         # SIGINT → summarize → stop
 *
 * .env loading:
 *   The app imports 'dotenv/config' at startup, so a .env file in `cwd`
 *   is loaded automatically. You don't need PM2's env_file option.
 *
 * Why script points at dist/src/index.js, not src/index.ts:
 *   tsc emits src → dist/src. Running compiled JS avoids the tsx
 *   transpile-on-load overhead (small but nonzero). If you prefer to
 *   skip `pnpm build` and run TypeScript directly, change `script` and
 *   `interpreter` as noted below.
 */
module.exports = {
  apps: [
    {
      name: 'pai-v4',
      script: './dist/src/index.js',
      interpreter: 'node',

      // Alternative: run TypeScript directly via tsx (no build step).
      // Uncomment this block and comment out `script` + `interpreter` above.
      //
      // script: 'node_modules/tsx/dist/cli.mjs',
      // args: 'src/index.ts',

      cwd: __dirname,

      // Singleton — the DB is single-writer per user and the trigger server
      // binds one port. Do not cluster.
      instances: 1,
      exec_mode: 'fork',

      // Restart behavior
      autorestart: true,
      watch: false,                     // production: no hot-reload
      max_memory_restart: '500M',       // generous cap; Sonnet+SQLite sits ~150–250M
      min_uptime: '10s',                // restart attempts within 10s count as crash-loop
      max_restarts: 10,                 // bail if crash-looping

      // ⚠️ CRITICAL: graceful-shutdown summarize takes ~5–15s per active session
      // (LLM call + DB write). PM2's default kill_timeout (1600ms) kills the
      // process mid-summarize, which is how wake-up briefings end up showing
      // "fallback: summarization unavailable" forever. 30s gives summarize
      // enough headroom.
      kill_timeout: 30000,

      // PM2 sends SIGINT by default on stop/restart. Our index.ts handles it.
      // (SIGTERM also works if you configure it elsewhere.)
      // kill_signal: 'SIGINT',          // default — leave commented

      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      out_file: './logs/pai-v4.out.log',
      error_file: './logs/pai-v4.err.log',
      merge_logs: true,

      env: {
        NODE_ENV: 'production',
        // Keep everything else in .env so you can rotate secrets without
        // touching this file. Example variables (commented out):
        //
        // GATEWAY: 'telegram',
        // CLAUDE_MODEL: 'sonnet',
        // TELEGRAM_BOT_TOKEN: 'set in .env',
        // TELEGRAM_WHITELIST: '628123456789',
        // DATA_DIR: '/absolute/path/to/data',
        // SUMMARIZE_TURN_THRESHOLD: '30',
        // SUMMARIZE_MODEL: 'claude-haiku-4-5',
        // MAX_TURNS: '50',
      },
    },
  ],
};
