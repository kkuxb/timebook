import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { runDailyBackup } from '../src/backup.js';
import { createDatabase } from '../src/db/client.js';

const tempDirs: string[] = [];

function createTempApp(password = 'test-pass-123') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-api-test-'));
  tempDirs.push(dir);
  const db = createDatabase(dir);
  const { app, ctx } = createApp({
    db,
    auth: {
      password,
      secret: 'unit-test-secret',
      cookieSecure: 'auto',
    },
  });
  return { app, ctx, dir };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function extractCookie(res: Response): string {
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) return '';
  return setCookie.split(';')[0];
}

describe('@timebook/api integration', () => {
  it('seeds 4 default modules and verifies /api/health heartbeat real read/write', async () => {
    const { app, ctx } = createTempApp();
    try {
      const hRes = await app.request('/api/health');
      expect(hRes.status).toBe(200);
      const hBody = (await hRes.json()) as { ok: boolean; db: boolean; serverTime: number };
      expect(hBody.ok).toBe(true);
      expect(hBody.db).toBe(true);

      const hbRow = ctx.sqlite.prepare('SELECT at FROM heartbeat WHERE id = 1').get() as { at: number };
      expect(hbRow.at).toBe(hBody.serverTime);

      const mods = ctx.sqlite.prepare('SELECT name, color_key FROM modules ORDER BY sort').all() as Array<{
        name: string;
        color_key: string;
      }>;
      expect(mods.map((m) => m.name)).toEqual(['工作', '学习', '游戏', '锻炼']);
    } finally {
      ctx.close();
    }
  });

  it('enforces auth, 5-attempts/min rate limit (401x5 then 429), and cookie login', async () => {
    const { app, ctx } = createTempApp('my-secret-pw');
    try {
      const unauth = await app.request('/api/sync?since=0');
      expect(unauth.status).toBe(401);

      for (let i = 0; i < 5; i += 1) {
        const res = await app.request('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.0.0.88' },
          body: JSON.stringify({ password: 'wrong' }),
        });
        expect(res.status).toBe(401);
      }

      // 第 6 次触发 429
      const limited = await app.request('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.0.0.88' },
        body: JSON.stringify({ password: 'my-secret-pw' }),
      });
      expect(limited.status).toBe(429);

      // 另一 IP 正确口令成功登录
      const okLogin = await app.request('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.0.0.99' },
        body: JSON.stringify({ password: 'my-secret-pw' }),
      });
      expect(okLogin.status).toBe(200);
      const cookie = extractCookie(okLogin);
      expect(cookie).toContain('tb_session=');

      const syncRes = await app.request('/api/sync?since=0', {
        headers: { Cookie: cookie },
      });
      expect(syncRes.status).toBe(200);
    } finally {
      ctx.close();
    }
  });

  it('guarantees idempotent mutations, drop-tag keeps todos & running timer, and trash restore recovers hierarchy', async () => {
    const { app, ctx } = createTempApp('pw');
    try {
      const loginRes = await app.request('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'pw' }),
      });
      const cookie = extractCookie(loginRes);

      const sync0 = (await (
        await app.request('/api/sync?since=0', { headers: { Cookie: cookie } })
      ).json()) as { modules: Array<{ id: string; name: string }> };
      const workModId = sync0.modules[0].id;

      // 1. 重复提交同一 mutation_id 两次，只写入一次
      const payload = {
        mutations: [
          {
            mutation_id: 'mut-tag-1',
            type: 'tag.upsert',
            payload: { id: 'tag-a', module_id: workModId, name: '研发', sort: 0 },
          },
          {
            mutation_id: 'mut-todo-1',
            type: 'todo.upsert',
            payload: {
              id: 'todo-a',
              title: '上线测试',
              tag_id: 'tag-a',
              plan_date: '2026-11-19',
              due_date: null,
              recur: null,
              done_at: null,
            },
          },
          {
            mutation_id: 'mut-sess-done',
            type: 'session.upsert',
            payload: {
              id: 'sess-done-1',
              tag_id: 'tag-a',
              todo_id: 'todo-a',
              title: '核心开发',
              start_at: 1000000,
              end_at: 4600000,
              source: 'manual',
            },
          },
          {
            mutation_id: 'mut-sess-run',
            type: 'session.upsert',
            payload: {
              id: 'sess-run-1',
              tag_id: 'tag-a',
              todo_id: null,
              title: null,
              start_at: 5000000,
              end_at: null,
              source: 'timer',
            },
          },
        ],
      };

      const m1 = await app.request('/api/mutations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify(payload),
      });
      expect(m1.status).toBe(200);
      const m1Json = (await m1.json()) as { appliedCount: number; cursor: number };
      expect(m1Json.appliedCount).toBe(4);

      const m2 = await app.request('/api/mutations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify(payload),
      });
      expect(m2.status).toBe(200);
      const m2Json = (await m2.json()) as { appliedCount: number };
      expect(m2Json.appliedCount).toBe(0);

      // 2. 删除事项 drop 模式：软删已结束记录，保留待办与进行中计时并将 tag_id 置 null
      const delRes = await app.request('/api/mutations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          mutations: [
            {
              mutation_id: 'mut-del-tag-a',
              type: 'tag.delete',
              payload: { id: 'tag-a', mode: 'drop' },
            },
          ],
        }),
      });
      expect(delRes.status).toBe(200);

      const todoRow = ctx.sqlite.prepare('SELECT tag_id, deleted_at FROM todos WHERE id = ?').get('todo-a') as {
        tag_id: string | null;
        deleted_at: number | null;
      };
      expect(todoRow.deleted_at).toBeNull();
      expect(todoRow.tag_id).toBeNull();

      const runRow = ctx.sqlite.prepare('SELECT tag_id, deleted_at FROM sessions WHERE id = ?').get('sess-run-1') as {
        tag_id: string | null;
        deleted_at: number | null;
      };
      expect(runRow.deleted_at).toBeNull();
      expect(runRow.tag_id).toBeNull();

      const doneRow = ctx.sqlite.prepare('SELECT deleted_at FROM sessions WHERE id = ?').get('sess-done-1') as {
        deleted_at: number | null;
      };
      expect(doneRow.deleted_at).not.toBeNull();

      // 3. 回收站可见被删事项和记录，恢复记录连带恢复原事项
      const trashRes = await app.request('/api/trash', { headers: { Cookie: cookie } });
      const trashJson = (await trashRes.json()) as { items: Array<{ kind: string; id: string }> };
      expect(trashJson.items.some((x) => x.kind === 'session' && x.id === 'sess-done-1')).toBe(true);

      const restoreRes = await app.request('/api/trash/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ kind: 'session', id: 'sess-done-1' }),
      });
      expect(restoreRes.status).toBe(200);

      const restoredSess = ctx.sqlite.prepare('SELECT deleted_at FROM sessions WHERE id = ?').get('sess-done-1') as {
        deleted_at: number | null;
      };
      const restoredTag = ctx.sqlite.prepare('SELECT deleted_at FROM tags WHERE id = ?').get('tag-a') as {
        deleted_at: number | null;
      };
      expect(restoredSess.deleted_at).toBeNull();
      expect(restoredTag.deleted_at).toBeNull();
    } finally {
      ctx.close();
    }
  });

  it('imports Notion batch, exposes via sync, undoes with soft-delete propagation, exports & backs up SQLite', async () => {
    const { app, ctx } = createTempApp('pw');
    try {
      const loginRes = await app.request('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'pw' }),
      });
      const cookie = extractCookie(loginRes);

      const impRes = await app.request('/api/import/notion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          batchName: '测试批次',
          modules: [{ name: '工作', color_key: 'blue' }],
          tags: [{ moduleName: '工作', name: '个人工作' }],
          sessions: [
            {
              tagName: '个人工作',
              moduleName: '工作',
              title: 'FDE开发',
              start_at: Date.UTC(2026, 10, 18, 1, 0, 0),
              end_at: Date.UTC(2026, 10, 18, 3, 0, 0),
            },
          ],
          todos: [{ title: '旧待办', tagName: null, plan_date: null, due_date: null }],
        }),
      });
      expect(impRes.status).toBe(200);
      const impJson = (await impRes.json()) as { batchId: string; importedSessions: number; cursor: number };
      expect(impJson.importedSessions).toBe(1);

      // 导出 CSV 和 JSON
      const csvRes = await app.request('/api/export?format=csv', { headers: { Cookie: cookie } });
      expect(csvRes.status).toBe(200);
      const csvText = await csvRes.text();
      expect(csvText).toContain('FDE开发');

      const jsonRes = await app.request('/api/export?format=json', { headers: { Cookie: cookie } });
      expect(jsonRes.status).toBe(200);

      // 整批撤销前记录 cursor
      const beforeUndoCursor = impJson.cursor;
      const undoRes = await app.request(`/api/import/${impJson.batchId}`, {
        method: 'DELETE',
        headers: { Cookie: cookie },
      });
      expect(undoRes.status).toBe(200);

      // 增量同步能拿到被软删除的 session、todo 与本批独占新建的 tag
      const deltaSync = (await (
        await app.request(`/api/sync?since=${beforeUndoCursor}`, { headers: { Cookie: cookie } })
      ).json()) as {
        sessions: Array<{ deleted_at: number | null; import_batch: string | null }>;
        todos: Array<{ title: string; deleted_at: number | null }>;
        tags: Array<{ name: string; deleted_at: number | null }>;
      };
      expect(deltaSync.sessions).toHaveLength(1);
      expect(deltaSync.sessions[0].deleted_at).not.toBeNull();
      expect(deltaSync.sessions[0].import_batch).toBe(impJson.batchId);
      expect(deltaSync.todos).toHaveLength(1);
      expect(deltaSync.todos[0].title).toBe('旧待办');
      expect(deltaSync.todos[0].deleted_at).not.toBeNull();
      expect(deltaSync.tags).toHaveLength(1);
      expect(deltaSync.tags[0].name).toBe('个人工作');
      expect(deltaSync.tags[0].deleted_at).not.toBeNull();

      // 验证空模块 drop 删除无需 targetModuleId 且成功软删除
      const addEmptyMod = await app.request('/api/mutations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          mutations: [
            {
              mutation_id: 'mut-empty-mod-1',
              type: 'module.upsert',
              payload: { id: 'mod-empty', name: '空模块', color_key: 'sky', sort: 9 },
            },
            {
              mutation_id: 'mut-empty-mod-del',
              type: 'module.delete',
              payload: { id: 'mod-empty', mode: 'drop' },
            },
          ],
        }),
      });
      expect(addEmptyMod.status).toBe(200);
      const emptyModRow = ctx.sqlite
        .prepare('SELECT deleted_at FROM modules WHERE id = ?')
        .get('mod-empty') as { deleted_at: number | null };
      expect(emptyModRow.deleted_at).not.toBeNull();

      // 在线备份可生成有效 sqlite 文件
      const backupRes = await runDailyBackup(ctx, Date.UTC(2026, 10, 16, 4, 0, 0)); // 周一
      expect(fs.existsSync(backupRes.sqlitePath)).toBe(true);
      expect(backupRes.weeklyJsonPath && fs.existsSync(backupRes.weeklyJsonPath)).toBe(true);
      const bkDb = new Database(backupRes.sqlitePath, { readonly: true });
      const row = bkDb.prepare('SELECT COUNT(*) AS cnt FROM modules').get() as { cnt: number };
      expect(row.cnt).toBeGreaterThanOrEqual(4);
      bkDb.close();
    } finally {
      ctx.close();
    }
  });

  it('supports Bearer token auth and controlled CORS headers for desktop clients', async () => {
    const { app, ctx } = createTempApp('desktop-pw');
    try {
      const preflight = await app.request('/api/sync?since=0', {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://tauri.localhost',
          'Access-Control-Request-Method': 'GET',
        },
      });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get('access-control-allow-origin')).toBe('http://tauri.localhost');
      expect(preflight.headers.get('access-control-allow-headers')).toContain('Authorization');

      const loginRes = await app.request('/api/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://tauri.localhost',
        },
        body: JSON.stringify({ password: 'desktop-pw' }),
      });
      expect(loginRes.status).toBe(200);
      expect(loginRes.headers.get('access-control-allow-origin')).toBe('http://tauri.localhost');
      const loginJson = (await loginRes.json()) as { ok: boolean; token?: string };
      expect(loginJson.ok).toBe(true);
      expect(typeof loginJson.token).toBe('string');
      expect(loginJson.token!.length).toBeGreaterThan(20);

      // 无 Cookie 仅凭 Bearer Token 访问
      const syncRes = await app.request('/api/sync?since=0', {
        headers: {
          Origin: 'http://tauri.localhost',
          Authorization: `Bearer ${loginJson.token}`,
        },
      });
      expect(syncRes.status).toBe(200);
      expect(syncRes.headers.get('access-control-allow-origin')).toBe('http://tauri.localhost');
      const syncJson = (await syncRes.json()) as { modules: Array<{ id: string; name: string }> };
      expect(syncJson.modules).toHaveLength(4);

      const mutRes = await app.request('/api/mutations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://tauri.localhost',
          Authorization: `Bearer ${loginJson.token}`,
        },
        body: JSON.stringify({
          mutations: [
            {
              mutation_id: 'mut-bearer-1',
              type: 'tag.upsert',
              payload: {
                id: 'tag-bearer-1',
                module_id: syncJson.modules[0].id,
                name: '桌面同步事项',
                sort: 0,
              },
            },
          ],
        }),
      });
      expect(mutRes.status).toBe(200);
      const mutJson = (await mutRes.json()) as { appliedCount: number };
      expect(mutJson.appliedCount).toBe(1);

      // 伪造或错误格式的 Bearer 必须返回 401
      const badBearer = await app.request('/api/sync?since=0', {
        headers: {
          Origin: 'http://tauri.localhost',
          Authorization: 'Bearer invalid.token.value',
        },
      });
      expect(badBearer.status).toBe(401);
      expect(badBearer.headers.get('access-control-allow-origin')).toBe('http://tauri.localhost');
    } finally {
      ctx.close();
    }
  });
});
