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
      const hBody = (await hRes.json()) as {
        ok: boolean;
        db: boolean;
        serverTime: number;
        version: string;
        capabilities: string[];
      };
      expect(hBody.ok).toBe(true);
      expect(hBody.db).toBe(true);
      expect(hBody.version).toBe('0.2.2');
      expect(hBody.capabilities).toContain('tag_disabled_at');

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

  it('returns 404 for retired Notion import routes and preserves legacy source=import sessions across sync, export, trash and backup', async () => {
    const { app, ctx } = createTempApp('pw');
    try {
      const loginRes = await app.request('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'pw' }),
      });
      const cookie = extractCookie(loginRes);

      // 1. 已下线的 Notion 导入路由全部返回 404
      const impPostRes = await app.request('/api/import/notion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({}),
      });
      expect(impPostRes.status).toBe(404);

      const batchesRes = await app.request('/api/import/batches', {
        headers: { Cookie: cookie },
      });
      expect(batchesRes.status).toBe(404);

      const undoRes = await app.request('/api/import/legacy-batch-1', {
        method: 'DELETE',
        headers: { Cookie: cookie },
      });
      expect(undoRes.status).toBe(404);

      // 2. 注入模拟存量库（含 source='import' 与 import_batch='legacy-batch-1'）
      const sync0 = (await (
        await app.request('/api/sync?since=0', { headers: { Cookie: cookie } })
      ).json()) as { modules: Array<{ id: string; name: string }> };
      const workModId = sync0.modules[0].id;
      const now = Date.now();
      ctx.sqlite
        .prepare(
          'INSERT INTO tags (id, module_id, name, sort, created_at, updated_at, deleted_at) VALUES (?, ?, ?, 0, ?, ?, NULL)',
        )
        .run('tag-legacy-1', workModId, '个人工作', now, now);
      ctx.sqlite
        .prepare(
          'INSERT INTO sessions (id, tag_id, todo_id, title, start_at, end_at, source, import_batch, created_at, updated_at, deleted_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, NULL)',
        )
        .run(
          'sess-legacy-import-1',
          'tag-legacy-1',
          'FDE存量历史',
          Date.UTC(2026, 10, 18, 1, 0, 0),
          Date.UTC(2026, 10, 18, 3, 0, 0),
          'import',
          'legacy-batch-1',
          now,
          now,
        );

      // 3. /api/sync、/api/export(csv/json) 100% 兼容存量导入数据
      const syncAfter = (await (
        await app.request('/api/sync?since=0', { headers: { Cookie: cookie } })
      ).json()) as {
        sessions: Array<{ id: string; source: string; import_batch: string | null }>;
      };
      const foundSess = syncAfter.sessions.find((s) => s.id === 'sess-legacy-import-1');
      expect(foundSess).toBeDefined();
      expect(foundSess!.source).toBe('import');
      expect(foundSess!.import_batch).toBe('legacy-batch-1');

      const csvRes = await app.request('/api/export?format=csv', { headers: { Cookie: cookie } });
      expect(csvRes.status).toBe(200);
      const csvText = await csvRes.text();
      expect(csvText).toContain('FDE存量历史');
      expect(csvText).toContain('import');

      const jsonRes = await app.request('/api/export?format=json', { headers: { Cookie: cookie } });
      expect(jsonRes.status).toBe(200);
      const jsonExport = (await jsonRes.json()) as { version: string; sessions: Array<{ id: string }> };
      expect(jsonExport.version).toBe('0.2.2');
      expect(jsonExport.sessions.some((s) => s.id === 'sess-legacy-import-1')).toBe(true);

      // 4. 软删除存量导入记录后可在回收站恢复
      const delSessRes = await app.request('/api/mutations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          mutations: [
            {
              mutation_id: 'mut-del-legacy-1',
              type: 'session.delete',
              payload: { id: 'sess-legacy-import-1' },
            },
          ],
        }),
      });
      expect(delSessRes.status).toBe(200);

      const trashRes = await app.request('/api/trash', { headers: { Cookie: cookie } });
      const trashJson = (await trashRes.json()) as { items: Array<{ kind: string; id: string }> };
      expect(trashJson.items.some((x) => x.kind === 'session' && x.id === 'sess-legacy-import-1')).toBe(true);

      const restoreRes = await app.request('/api/trash/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ kind: 'session', id: 'sess-legacy-import-1' }),
      });
      expect(restoreRes.status).toBe(200);

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

  it('migrates legacy v0.2.0 SQLite without tags.disabled_at, syncs disable/enable roundtrip, rejects duplicate name (409), and preserves disabled tags in exports', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-api-legacy-'));
    tempDirs.push(dir);
    const legacyDbPath = path.join(dir, 'timebook.sqlite');

    // 1. 构造不含 tags.disabled_at 列的旧版 v0.2.0 数据库
    const legacy = new Database(legacyDbPath);
    legacy.exec(`
      CREATE TABLE modules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color_key TEXT NOT NULL,
        sort INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      );
      CREATE TABLE tags (
        id TEXT PRIMARY KEY,
        module_id TEXT NOT NULL,
        name TEXT NOT NULL,
        sort INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      );
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        tag_id TEXT,
        todo_id TEXT,
        title TEXT,
        start_at INTEGER NOT NULL,
        end_at INTEGER,
        source TEXT NOT NULL,
        import_batch TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      );
      CREATE TABLE todos (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        tag_id TEXT,
        plan_date TEXT,
        due_date TEXT,
        recur TEXT,
        done_at INTEGER,
        sort INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      );
    `);
    const ts = 1_700_000_000_000;
    legacy
      .prepare('INSERT INTO modules (id, name, color_key, sort, created_at, updated_at, deleted_at) VALUES (?, ?, ?, 0, ?, ?, NULL)')
      .run('mod-legacy', '工作', 'blue', ts, ts);
    legacy
      .prepare('INSERT INTO tags (id, module_id, name, sort, created_at, updated_at, deleted_at) VALUES (?, ?, ?, 0, ?, ?, NULL)')
      .run('tag-legacy', 'mod-legacy', '老项目', ts, ts);
    legacy
      .prepare('INSERT INTO sessions (id, tag_id, todo_id, title, start_at, end_at, source, import_batch, created_at, updated_at, deleted_at) VALUES (?, ?, NULL, ?, ?, ?, ?, NULL, ?, ?, NULL)')
      .run('sess-legacy', 'tag-legacy', '老记录', ts + 1000, ts + 3601000, 'timer', ts, ts);
    legacy.close();

    // 2. 用新版 createDatabase 打开并自动迁移
    const db = createDatabase(dir);
    const { app, ctx } = createApp({
      db,
      auth: { password: 'pw', secret: 'sec', cookieSecure: 'auto' },
    });
    try {
      const cols = ctx.sqlite.prepare('PRAGMA table_info(tags)').all() as Array<{ name: string }>;
      expect(cols.some((c) => c.name === 'disabled_at')).toBe(true);

      const loginRes = await app.request('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'pw' }),
      });
      const cookie = extractCookie(loginRes);

      const sync0 = (await (
        await app.request('/api/sync?since=0', { headers: { Cookie: cookie } })
      ).json()) as { tags: Array<{ id: string; disabled_at: number | null }> };
      expect(sync0.tags.find((t) => t.id === 'tag-legacy')?.disabled_at).toBeNull();

      // 3. 停用标签并验证同步
      const disabledAt = 1_700_000_100_000;
      const disableRes = await app.request('/api/mutations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          mutations: [
            {
              mutation_id: 'mut-disable-1',
              type: 'tag.upsert',
              payload: {
                id: 'tag-legacy',
                module_id: 'mod-legacy',
                name: '老项目',
                sort: 0,
                disabled_at: disabledAt,
              },
            },
          ],
        }),
      });
      expect(disableRes.status).toBe(200);

      const syncDisabled = (await (
        await app.request('/api/sync?since=0', { headers: { Cookie: cookie } })
      ).json()) as { tags: Array<{ id: string; disabled_at: number | null }> };
      expect(syncDisabled.tags.find((t) => t.id === 'tag-legacy')?.disabled_at).toBe(disabledAt);

      // 4. 模拟旧版客户端省略 disabled_at 字段更新名称时，不误清空 disabled_at
      const legacyClientUpdate = await app.request('/api/mutations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          mutations: [
            {
              mutation_id: 'mut-legacy-client-rename',
              type: 'tag.upsert',
              payload: {
                id: 'tag-legacy',
                module_id: 'mod-legacy',
                name: '老项目改名',
                sort: 0,
              },
            },
          ],
        }),
      });
      expect(legacyClientUpdate.status).toBe(200);
      const afterRename = ctx.sqlite
        .prepare('SELECT disabled_at FROM tags WHERE id = ?')
        .get('tag-legacy') as { disabled_at: number | null };
      expect(afterRename.disabled_at).toBe(disabledAt);

      // 5. 同模块下不允许新建与已停用标签同名的事项（409）
      const dupRes = await app.request('/api/mutations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          mutations: [
            {
              mutation_id: 'mut-dup-disabled',
              type: 'tag.upsert',
              payload: {
                id: 'tag-new-dup',
                module_id: 'mod-legacy',
                name: '老项目改名',
                sort: 1,
              },
            },
          ],
        }),
      });
      expect(dupRes.status).toBe(409);

      // 6. 停用期间 CSV 与 JSON 导出均完整保留原标签名与 disabled_at
      const csvRes = await app.request('/api/export?format=csv', { headers: { Cookie: cookie } });
      expect(csvRes.status).toBe(200);
      const csvText = await csvRes.text();
      expect(csvText).toContain('老项目改名');
      expect(csvText).toContain('老记录');

      const jsonRes = await app.request('/api/export?format=json', { headers: { Cookie: cookie } });
      expect(jsonRes.status).toBe(200);
      const jsonBody = (await jsonRes.json()) as {
        version: string;
        tags: Array<{ id: string; disabled_at: number | null }>;
      };
      expect(jsonBody.version).toBe('0.2.2');
      expect(jsonBody.tags.find((t) => t.id === 'tag-legacy')?.disabled_at).toBe(disabledAt);

      // 7. 软删除已停用标签后从回收站恢复仍保留 disabled_at
      const softDel = await app.request('/api/mutations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          mutations: [
            { mutation_id: 'mut-del-disabled-tag', type: 'tag.delete', payload: { id: 'tag-legacy', mode: 'drop' } },
          ],
        }),
      });
      expect(softDel.status).toBe(200);
      const restoreRes = await app.request('/api/trash/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ kind: 'tag', id: 'tag-legacy' }),
      });
      expect(restoreRes.status).toBe(200);
      const restoredRow = ctx.sqlite
        .prepare('SELECT disabled_at, deleted_at FROM tags WHERE id = ?')
        .get('tag-legacy') as { disabled_at: number | null; deleted_at: number | null };
      expect(restoredRow.deleted_at).toBeNull();
      expect(restoredRow.disabled_at).toBe(disabledAt);

      // 8. 重新启用（disabled_at: null）
      const enableRes = await app.request('/api/mutations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          mutations: [
            {
              mutation_id: 'mut-enable-1',
              type: 'tag.upsert',
              payload: {
                id: 'tag-legacy',
                module_id: 'mod-legacy',
                name: '老项目改名',
                sort: 0,
                disabled_at: null,
              },
            },
          ],
        }),
      });
      expect(enableRes.status).toBe(200);
      const syncEnabled = (await (
        await app.request('/api/sync?since=0', { headers: { Cookie: cookie } })
      ).json()) as { tags: Array<{ id: string; disabled_at: number | null }> };
      expect(syncEnabled.tags.find((t) => t.id === 'tag-legacy')?.disabled_at).toBeNull();

      // 9. 校验 /api/status 版本与能力标识，以及连续停用后反复增量 sync 不丢失 disabled_at
      const statusRes = await app.request('/api/status', { headers: { Cookie: cookie } });
      expect(statusRes.status).toBe(200);
      const statusJson = (await statusRes.json()) as {
        version: string;
        capabilities: string[];
        cursor: number;
      };
      expect(statusJson.version).toBe('0.2.2');
      expect(statusJson.capabilities).toContain('tag_disabled_at');

      const sinceBefore = statusJson.cursor;
      const reDisableAt = 1_700_000_200_000;
      const reDisableRes = await app.request('/api/mutations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          mutations: [
            {
              mutation_id: 'mut-disable-again',
              type: 'tag.upsert',
              payload: {
                id: 'tag-legacy',
                module_id: 'mod-legacy',
                name: '老项目改名',
                sort: 0,
                disabled_at: reDisableAt,
              },
            },
          ],
        }),
      });
      expect(reDisableRes.status).toBe(200);
      const reDisableJson = (await reDisableRes.json()) as { cursor: number };

      // 多次增量拉取与全量拉取均精确返回 disabled_at
      const incSync1 = (await (
        await app.request(`/api/sync?since=${sinceBefore}`, { headers: { Cookie: cookie } })
      ).json()) as { tags: Array<{ id: string; disabled_at: number | null }>; cursor: number };
      expect(incSync1.tags.find((t) => t.id === 'tag-legacy')?.disabled_at).toBe(reDisableAt);

      const incSync2 = (await (
        await app.request(`/api/sync?since=${reDisableJson.cursor}`, { headers: { Cookie: cookie } })
      ).json()) as { tags: Array<{ id: string; disabled_at: number | null }> };
      expect(incSync2.tags).toHaveLength(0);

      const fullSyncAfter = (await (
        await app.request('/api/sync?since=0', { headers: { Cookie: cookie } })
      ).json()) as { tags: Array<{ id: string; disabled_at: number | null }> };
      expect(fullSyncAfter.tags.find((t) => t.id === 'tag-legacy')?.disabled_at).toBe(reDisableAt);
    } finally {
      ctx.close();
    }
  });
});
