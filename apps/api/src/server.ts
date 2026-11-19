import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { startBackupScheduler } from './backup.js';

const port = Number(process.env.PORT || 3210);
const host = process.env.HOST || '0.0.0.0';

if (!process.env.TIMEBOOK_PASSWORD) {
  console.warn('[timebook] 警告：未配置 TIMEBOOK_PASSWORD 环境变量，登录接口将拒绝所有口令。');
}

const { app, ctx } = createApp();
const stopBackup = startBackupScheduler(ctx);

const server = serve(
  {
    fetch: app.fetch,
    port,
    hostname: host,
  },
  (info) => {
    console.log(`[timebook] 服务已启动：http://${host}:${info.port} (DATA_DIR=${ctx.dataDir})`);
  },
);

const shutdown = () => {
  stopBackup();
  server.close(() => {
    ctx.close();
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
