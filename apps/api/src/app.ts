import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { z } from 'zod';
import { toShanghaiDateStr } from '@timebook/core';
import {
  clearSessionCookie,
  getClientIp,
  IpRateLimiter,
  issueSessionCookie,
  requireAuthMiddleware,
  resolveAuthConfig,
  verifyPassword,
  type AuthConfig,
} from './auth.js';
import { getBackupStatus, runDailyBackup } from './backup.js';
import { createDatabase, type DbContext } from './db/client.js';
import {
  exportDatabaseJson,
  exportSessionsCsv,
  importNotionBatch,
  listImportBatches,
  listTrashItems,
  restoreTrashItem,
  undoImportBatch,
} from './import-export.js';
import { applyMutationsBatch, MutationConflictError, querySyncSince } from './sync.js';

export interface CreateAppOptions {
  db?: DbContext;
  auth?: Partial<AuthConfig>;
  webDistDir?: string;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function resolveDefaultWebDist(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidate = path.resolve(here, '../../web/dist');
  return candidate;
}

export function createApp(options: CreateAppOptions = {}) {
  const ctx = options.db ?? createDatabase();
  const authConfig = resolveAuthConfig(options.auth);
  const limiter = new IpRateLimiter(5, 60_000);
  const webDistDir = path.resolve(options.webDistDir ?? resolveDefaultWebDist());

  const app = new Hono();

  // 受控 CORS 支持（供 Tauri 桌面客户端跨域连接家庭 NAS）
  app.use('/api/*', async (c, next) => {
    const origin = c.req.header('origin');
    if (origin) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Access-Control-Allow-Credentials', 'true');
      c.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      c.header('Vary', 'Origin');
    }
    if (c.req.method === 'OPTIONS') {
      return c.body(null, 204);
    }
    await next();
  });

  // 免登录健康检查：真实写入并回读 SQLite heartbeat 表
  app.get('/api/health', (c) => {
    const serverTime = Date.now();
    try {
      ctx.sqlite
        .prepare(
          'INSERT INTO heartbeat (id, at) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET at = excluded.at',
        )
        .run(serverTime);
      const row = ctx.sqlite.prepare('SELECT at FROM heartbeat WHERE id = 1').get() as
        | { at: number }
        | undefined;
      if (!row || row.at !== serverTime) {
        return c.json(
          { ok: false, db: false, error: '心跳回读不一致', serverTime },
          503,
        );
      }
      return c.json({ ok: true, db: true, serverTime });
    } catch (err) {
      return c.json(
        {
          ok: false,
          db: false,
          error: err instanceof Error ? err.message : String(err),
          serverTime,
        },
        503,
      );
    }
  });

  // 登录接口（带 IP 限流）
  app.post('/api/login', async (c) => {
    const ip = getClientIp(c);
    const check = limiter.isBlocked(ip);
    if (check.blocked) {
      return c.json(
        {
          ok: false,
          error: `口令尝试次数过多，请 ${check.retryAfterSec} 秒后再试`,
          retryAfterSec: check.retryAfterSec,
        },
        429,
      );
    }

    let password = '';
    try {
      const body = (await c.req.json()) as { password?: unknown };
      password = typeof body?.password === 'string' ? body.password : '';
    } catch {
      return c.json({ ok: false, error: '请求格式错误' }, 400);
    }

    if (!verifyPassword(password, authConfig.password)) {
      limiter.recordFailure(ip);
      return c.json({ ok: false, error: '访问口令不正确' }, 401);
    }

    limiter.reset(ip);
    const token = issueSessionCookie(c, authConfig);
    return c.json({ ok: true, serverTime: Date.now(), token });
  });

  app.post('/api/logout', (c) => {
    clearSessionCookie(c, authConfig);
    return c.json({ ok: true });
  });

  // 保护其余全部 /api/* 路由
  const protectedApi = new Hono();
  protectedApi.use('*', requireAuthMiddleware(authConfig));

  protectedApi.get('/auth/me', (c) => {
    return c.json({ ok: true, authenticated: true, serverTime: Date.now() });
  });

  protectedApi.get('/status', (c) => {
    const backup = getBackupStatus(ctx);
    return c.json({
      ok: true,
      serverTime: Date.now(),
      cursor: ctx.getLastCursor(),
      backup,
    });
  });

  protectedApi.post('/backup/run', async (c) => {
    const res = await runDailyBackup(ctx);
    return c.json({ ok: true, backup: getBackupStatus(ctx), ...res });
  });

  protectedApi.get('/sync', (c) => {
    const sinceParam = c.req.query('since');
    const since = sinceParam ? Math.max(0, Number(sinceParam) || 0) : 0;
    const data = querySyncSince(ctx, since);
    return c.json(data);
  });

  protectedApi.post('/mutations', async (c) => {
    try {
      const body = await c.req.json();
      const result = applyMutationsBatch(ctx, body);
      return c.json(result);
    } catch (err) {
      if (err instanceof MutationConflictError) {
        return c.json({ ok: false, error: err.message }, 409);
      }
      if (err instanceof z.ZodError) {
        return c.json({ ok: false, error: '数据校验失败', details: err.flatten() }, 400);
      }
      return c.json(
        { ok: false, error: err instanceof Error ? err.message : '写入失败' },
        500,
      );
    }
  });

  protectedApi.post('/import/notion', async (c) => {
    try {
      const body = await c.req.json();
      const res = importNotionBatch(ctx, body);
      return c.json({ ok: true, ...res });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return c.json({ ok: false, error: '导入载荷格式无效', details: err.flatten() }, 400);
      }
      return c.json(
        { ok: false, error: err instanceof Error ? err.message : '导入失败' },
        500,
      );
    }
  });

  protectedApi.get('/import/batches', (c) => {
    return c.json({ ok: true, batches: listImportBatches(ctx) });
  });

  protectedApi.delete('/import/:batchId', (c) => {
    const batchId = c.req.param('batchId');
    const res = undoImportBatch(ctx, batchId);
    return c.json(res);
  });

  protectedApi.get('/export', (c) => {
    const format = (c.req.query('format') || 'json').toLowerCase();
    const dateStr = toShanghaiDateStr(Date.now());
    if (format === 'csv') {
      const csv = exportSessionsCsv(ctx);
      return c.body(csv, 200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="timebook-sessions-${dateStr}.csv"`,
      });
    }
    const jsonData = exportDatabaseJson(ctx);
    return c.body(JSON.stringify(jsonData, null, 2), 200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="timebook-backup-${dateStr}.json"`,
    });
  });

  protectedApi.get('/trash', (c) => {
    return c.json({ ok: true, items: listTrashItems(ctx) });
  });

  protectedApi.post('/trash/restore', async (c) => {
    try {
      const body = await c.req.json();
      const res = restoreTrashItem(ctx, body);
      return c.json(res);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return c.json({ ok: false, error: '恢复参数无效' }, 400);
      }
      return c.json(
        { ok: false, error: err instanceof Error ? err.message : '恢复失败' },
        500,
      );
    }
  });

  app.route('/api', protectedApi);

  // 未命中的 /api 路由返回 404 JSON
  app.all('/api/*', (c) => c.json({ ok: false, error: '接口不存在' }, 404));

  // 静态文件托管与 SPA 回退
  app.get('*', (c) => {
    if (!fs.existsSync(webDistDir)) {
      return c.text('Timebook API 运行中（前端尚未构建）', 200);
    }
    const reqPath = c.req.path === '/' ? '/index.html' : c.req.path;
    const safeRel = path.normalize(reqPath).replace(/^(\.\.(\/|\\|$))+/, '');
    let filePath = path.join(webDistDir, safeRel);
    if (!filePath.startsWith(webDistDir)) {
      return c.text('Forbidden', 403);
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      // 如果不是静态资源扩展名，回退到 index.html
      if (path.extname(safeRel) && path.extname(safeRel) !== '.html') {
        return c.text('Not Found', 404);
      }
      filePath = path.join(webDistDir, 'index.html');
      if (!fs.existsSync(filePath)) {
        return c.text('index.html not found', 404);
      }
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
    const content = fs.readFileSync(filePath);
    const headers: Record<string, string> = { 'Content-Type': contentType };
    if (path.basename(filePath) === 'sw.js' || path.basename(filePath) === 'index.html') {
      headers['Cache-Control'] = 'no-cache';
    } else if (safeRel.includes('assets')) {
      headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    }
    return c.body(content, 200, headers);
  });

  return { app, ctx };
}
