import { z } from 'zod';
import {
  COLOR_KEY_SCHEMA,
  formatShanghaiTime,
  toShanghaiDateStr,
  TRASH_RETENTION_MS,
  type ModuleEntity,
  type SessionEntity,
  type TagEntity,
  type TodoEntity,
} from '@timebook/core';
import { toCsv } from '@timebook/notion-import';
import { ulid } from 'ulid';
import type { DbContext } from './db/client.js';

export const IMPORT_PAYLOAD_SCHEMA = z.object({
  batchName: z.string().optional(),
  modules: z.array(
    z.object({
      name: z.string().min(1),
      color_key: COLOR_KEY_SCHEMA,
    }),
  ),
  tags: z.array(
    z.object({
      moduleName: z.string().min(1),
      name: z.string().min(1),
    }),
  ),
  sessions: z.array(
    z.object({
      tagName: z.string().nullable(),
      moduleName: z.string().nullable(),
      title: z.string().nullable(),
      start_at: z.number().int(),
      end_at: z.number().int(),
    }),
  ),
  todos: z.array(
    z.object({
      title: z.string().min(1),
      tagName: z.string().nullable(),
      plan_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
      due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    }),
  ),
});

export interface ImportBatchMeta {
  batchId: string;
  batchName: string;
  createdAt: number;
  importedSessions: number;
  importedTodos: number;
  createdModuleIds?: string[];
  createdTagIds?: string[];
  undoneAt: number | null;
}

export function importNotionBatch(
  ctx: DbContext,
  rawBody: unknown,
): {
  batchId: string;
  importedSessions: number;
  importedTodos: number;
  cursor: number;
} {
  const payload = IMPORT_PAYLOAD_SCHEMA.parse(rawBody);
  const { sqlite, nextCursor } = ctx;
  const batchId = ulid();
  const now = Date.now();

  const tx = sqlite.transaction(() => {
    const existingMods = sqlite
      .prepare('SELECT * FROM modules WHERE deleted_at IS NULL')
      .all() as ModuleEntity[];
    const modByName = new Map<string, ModuleEntity>(existingMods.map((m) => [m.name, m]));
    let maxModSort = existingMods.reduce((acc, m) => Math.max(acc, m.sort), -1);

    const insertMod = sqlite.prepare(
      'INSERT INTO modules (id, name, color_key, sort, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, NULL)',
    );

    const createdModuleIds: string[] = [];
    const createdTagIds: string[] = [];

    const ensureModule = (name: string, colorKey: string): ModuleEntity => {
      const found = modByName.get(name);
      if (found) return found;
      const ts = nextCursor();
      maxModSort += 1;
      const created: ModuleEntity = {
        id: ulid(),
        name,
        color_key: COLOR_KEY_SCHEMA.parse(colorKey),
        sort: maxModSort,
        created_at: ts,
        updated_at: ts,
        deleted_at: null,
      };
      insertMod.run(created.id, created.name, created.color_key, created.sort, ts, ts);
      modByName.set(name, created);
      createdModuleIds.push(created.id);
      return created;
    };

    for (const m of payload.modules) {
      ensureModule(m.name.trim(), m.color_key);
    }

    const existingTags = sqlite
      .prepare('SELECT * FROM tags WHERE deleted_at IS NULL')
      .all() as TagEntity[];
    const tagByKey = new Map<string, TagEntity>();
    const tagByName = new Map<string, TagEntity>();
    for (const t of existingTags) {
      tagByKey.set(`${t.module_id}::${t.name}`, t);
      if (!tagByName.has(t.name)) tagByName.set(t.name, t);
    }

    const insertTag = sqlite.prepare(
      'INSERT INTO tags (id, module_id, name, sort, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, NULL)',
    );

    for (const td of payload.tags) {
      const mod = ensureModule(td.moduleName.trim(), 'blue');
      const cleanTagName = td.name.trim();
      const key = `${mod.id}::${cleanTagName}`;
      if (!tagByKey.has(key)) {
        const ts = nextCursor();
        const created: TagEntity = {
          id: ulid(),
          module_id: mod.id,
          name: cleanTagName,
          sort: 0,
          created_at: ts,
          updated_at: ts,
          deleted_at: null,
        };
        insertTag.run(created.id, created.module_id, created.name, 0, ts, ts);
        tagByKey.set(key, created);
        createdTagIds.push(created.id);
        if (!tagByName.has(cleanTagName)) tagByName.set(cleanTagName, created);
      }
    }

    const resolveTagId = (moduleName: string | null, tagName: string | null): string | null => {
      if (!tagName) return null;
      if (moduleName) {
        const mod = modByName.get(moduleName);
        if (mod) {
          const hit = tagByKey.get(`${mod.id}::${tagName}`);
          if (hit) return hit.id;
        }
      }
      return tagByName.get(tagName)?.id ?? null;
    };

    const insertSession = sqlite.prepare(
      'INSERT INTO sessions (id, tag_id, todo_id, title, start_at, end_at, source, import_batch, created_at, updated_at, deleted_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, NULL)',
    );

    let importedSessions = 0;
    for (const s of payload.sessions) {
      if (s.end_at <= s.start_at) continue;
      const ts = nextCursor();
      const tagId = resolveTagId(s.moduleName, s.tagName);
      insertSession.run(
        ulid(),
        tagId,
        s.title,
        s.start_at,
        s.end_at,
        'import',
        batchId,
        ts,
        ts,
      );
      importedSessions += 1;
    }

    const insertTodo = sqlite.prepare(
      'INSERT INTO todos (id, title, tag_id, plan_date, due_date, recur, done_at, import_batch, sort, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, 0, ?, ?, NULL)',
    );

    let importedTodos = 0;
    for (const td of payload.todos) {
      const ts = nextCursor();
      const tagId = resolveTagId(null, td.tagName);
      insertTodo.run(ulid(), td.title.trim(), tagId, td.plan_date, td.due_date, batchId, ts, ts);
      importedTodos += 1;
    }

    const meta: ImportBatchMeta = {
      batchId,
      batchName: payload.batchName?.trim() || `Notion 导入 ${toShanghaiDateStr(now)}`,
      createdAt: now,
      importedSessions,
      importedTodos,
      createdModuleIds,
      createdTagIds,
      undoneAt: null,
    };

    sqlite
      .prepare(
        'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      )
      .run(`import_batch:${batchId}`, JSON.stringify(meta), now);

    return { importedSessions, importedTodos };
  });

  const result = tx();
  return {
    batchId,
    importedSessions: result.importedSessions,
    importedTodos: result.importedTodos,
    cursor: ctx.getLastCursor(),
  };
}

export function listImportBatches(ctx: DbContext): ImportBatchMeta[] {
  const rows = ctx.sqlite
    .prepare("SELECT value FROM settings WHERE key LIKE 'import_batch:%'")
    .all() as Array<{ value: string }>;
  const list: ImportBatchMeta[] = [];
  for (const row of rows) {
    try {
      list.push(JSON.parse(row.value) as ImportBatchMeta);
    } catch {
      // 忽略损坏元数据
    }
  }
  return list.sort((a, b) => b.createdAt - a.createdAt);
}

export function undoImportBatch(
  ctx: DbContext,
  batchId: string,
): { ok: true; deletedSessions: number; deletedTodos: number; deletedTags: number; cursor: number } {
  const { sqlite, nextCursor } = ctx;
  const tx = sqlite.transaction(() => {
    const delTs = Date.now();

    // 1. 软删除该批次下的专注记录
    const sessRows = sqlite
      .prepare('SELECT id FROM sessions WHERE import_batch = ? AND deleted_at IS NULL')
      .all(batchId) as Array<{ id: string }>;
    const softDelSess = sqlite.prepare(
      'UPDATE sessions SET deleted_at = ?, updated_at = ? WHERE id = ?',
    );
    for (const r of sessRows) {
      softDelSess.run(delTs, nextCursor(), r.id);
    }

    // 2. 软删除该批次下的待办
    const todoRows = sqlite
      .prepare('SELECT id FROM todos WHERE import_batch = ? AND deleted_at IS NULL')
      .all(batchId) as Array<{ id: string }>;
    const softDelTodo = sqlite.prepare(
      'UPDATE todos SET deleted_at = ?, updated_at = ? WHERE id = ?',
    );
    for (const r of todoRows) {
      softDelTodo.run(delTs, nextCursor(), r.id);
    }

    // 3. 回滚本批次独占新建的事项标签与模块（仅当无其他活跃记录/待办引用时）
    let deletedTags = 0;
    const metaRow = sqlite
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(`import_batch:${batchId}`) as { value: string } | undefined;
    if (metaRow) {
      try {
        const meta = JSON.parse(metaRow.value) as ImportBatchMeta;
        const countSessByTag = sqlite.prepare(
          'SELECT COUNT(*) AS cnt FROM sessions WHERE tag_id = ? AND deleted_at IS NULL',
        );
        const countTodoByTag = sqlite.prepare(
          'SELECT COUNT(*) AS cnt FROM todos WHERE tag_id = ? AND deleted_at IS NULL',
        );
        const softDelTag = sqlite.prepare(
          'UPDATE tags SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
        );

        for (const tagId of meta.createdTagIds ?? []) {
          const sCnt = (countSessByTag.get(tagId) as { cnt: number }).cnt;
          const tCnt = (countTodoByTag.get(tagId) as { cnt: number }).cnt;
          if (sCnt === 0 && tCnt === 0) {
            const info = softDelTag.run(delTs, nextCursor(), tagId);
            if (info.changes > 0) deletedTags += 1;
          }
        }

        const countTagsByMod = sqlite.prepare(
          'SELECT COUNT(*) AS cnt FROM tags WHERE module_id = ? AND deleted_at IS NULL',
        );
        const softDelMod = sqlite.prepare(
          'UPDATE modules SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
        );
        for (const modId of meta.createdModuleIds ?? []) {
          const mTagCnt = (countTagsByMod.get(modId) as { cnt: number }).cnt;
          if (mTagCnt === 0) {
            softDelMod.run(delTs, nextCursor(), modId);
          }
        }

        meta.undoneAt = delTs;
        sqlite
          .prepare('UPDATE settings SET value = ?, updated_at = ? WHERE key = ?')
          .run(JSON.stringify(meta), delTs, `import_batch:${batchId}`);
      } catch {
        // 忽略损坏元数据
      }
    }
    return {
      deletedSessions: sessRows.length,
      deletedTodos: todoRows.length,
      deletedTags,
    };
  });

  const res = tx();
  return { ok: true, ...res, cursor: ctx.getLastCursor() };
}

export function exportDatabaseJson(ctx: DbContext) {
  const modules = ctx.sqlite.prepare('SELECT * FROM modules').all() as ModuleEntity[];
  const tags = ctx.sqlite.prepare('SELECT * FROM tags').all() as TagEntity[];
  const sessions = ctx.sqlite.prepare('SELECT * FROM sessions').all() as SessionEntity[];
  const todos = ctx.sqlite.prepare('SELECT * FROM todos').all() as TodoEntity[];
  const todoChecks = ctx.sqlite.prepare('SELECT * FROM todo_checks').all();

  return {
    exportedAt: Date.now(),
    version: '1.0.0',
    modules,
    tags,
    sessions,
    todos,
    todoChecks,
  };
}

export function exportSessionsCsv(ctx: DbContext): string {
  const modules = ctx.sqlite.prepare('SELECT * FROM modules').all() as ModuleEntity[];
  const tags = ctx.sqlite.prepare('SELECT * FROM tags').all() as TagEntity[];
  const sessions = ctx.sqlite
    .prepare(
      'SELECT * FROM sessions WHERE deleted_at IS NULL AND end_at IS NOT NULL ORDER BY start_at DESC',
    )
    .all() as SessionEntity[];

  const modMap = new Map(modules.map((m) => [m.id, m]));
  const tagMap = new Map(tags.map((t) => [t.id, t]));

  const rows = sessions.map((s) => {
    const tag = s.tag_id ? tagMap.get(s.tag_id) : undefined;
    const mod = tag ? modMap.get(tag.module_id) : undefined;
    const startDate = toShanghaiDateStr(s.start_at);
    const endDate = toShanghaiDateStr(s.end_at!);
    const startStr = `${startDate} ${formatShanghaiTime(s.start_at)}`;
    const endStr = `${endDate} ${formatShanghaiTime(s.end_at!)}`;
    const mins = Math.round((s.end_at! - s.start_at) / 60000);
    return [
      startStr,
      endStr,
      mins,
      mod ? mod.name : '未分类',
      tag ? tag.name : '未分类',
      s.title ?? '',
      s.source,
    ];
  });

  return toCsv(['开始时间', '结束时间', '时长(分钟)', '模块', '事项', '具体内容', '来源'], rows, true);
}

export interface TrashItem {
  kind: 'module' | 'tag' | 'session' | 'todo';
  id: string;
  title: string;
  subtitle: string;
  deletedAt: number;
}

export function listTrashItems(ctx: DbContext): TrashItem[] {
  const cutoff = Date.now() - TRASH_RETENTION_MS;
  const batches = listImportBatches(ctx);
  const undoneBatches = batches.filter((b) => b.undoneAt !== null);
  const undoneBatchIds = new Set(undoneBatches.map((b) => b.batchId));
  const undoneTagIds = new Set(undoneBatches.flatMap((b) => b.createdTagIds ?? []));
  const undoneModIds = new Set(undoneBatches.flatMap((b) => b.createdModuleIds ?? []));

  const allMods = ctx.sqlite.prepare('SELECT * FROM modules').all() as ModuleEntity[];
  const allTags = ctx.sqlite.prepare('SELECT * FROM tags').all() as TagEntity[];
  const modMap = new Map(allMods.map((m) => [m.id, m]));
  const tagMap = new Map(allTags.map((t) => [t.id, t]));

  const items: TrashItem[] = [];

  for (const m of allMods) {
    if (m.deleted_at !== null && m.deleted_at >= cutoff && !undoneModIds.has(m.id)) {
      items.push({
        kind: 'module',
        id: m.id,
        title: m.name,
        subtitle: '模块',
        deletedAt: m.deleted_at,
      });
    }
  }

  for (const t of allTags) {
    if (t.deleted_at !== null && t.deleted_at >= cutoff && !undoneTagIds.has(t.id)) {
      const mod = modMap.get(t.module_id);
      items.push({
        kind: 'tag',
        id: t.id,
        title: t.name,
        subtitle: mod ? `事项 · 属于「${mod.name}」` : '事项',
        deletedAt: t.deleted_at,
      });
    }
  }

  const deletedSessions = ctx.sqlite
    .prepare(
      'SELECT * FROM sessions WHERE deleted_at IS NOT NULL AND deleted_at >= ? AND end_at IS NOT NULL',
    )
    .all(cutoff) as SessionEntity[];

  for (const s of deletedSessions) {
    if (s.import_batch && undoneBatchIds.has(s.import_batch)) continue;
    const tag = s.tag_id ? tagMap.get(s.tag_id) : undefined;
    const mins = Math.max(1, Math.round((s.end_at! - s.start_at) / 60000));
    const label = s.title
      ? tag
        ? `${tag.name} · ${s.title}`
        : `未分类 · ${s.title}`
      : tag
        ? tag.name
        : '未分类';
    items.push({
      kind: 'session',
      id: s.id,
      title: label,
      subtitle: `专注记录 · ${toShanghaiDateStr(s.start_at)} ${formatShanghaiTime(s.start_at)} · ${mins} 分钟`,
      deletedAt: s.deleted_at!,
    });
  }

  const deletedTodos = ctx.sqlite
    .prepare('SELECT * FROM todos WHERE deleted_at IS NOT NULL AND deleted_at >= ?')
    .all(cutoff) as TodoEntity[];

  for (const td of deletedTodos) {
    const tdWithBatch = td as TodoEntity & { import_batch?: string | null };
    if (tdWithBatch.import_batch && undoneBatchIds.has(tdWithBatch.import_batch)) continue;
    const tag = td.tag_id ? tagMap.get(td.tag_id) : undefined;
    items.push({
      kind: 'todo',
      id: td.id,
      title: td.title,
      subtitle: tag ? `待办 · ${tag.name}` : '待办 · 未分类',
      deletedAt: td.deleted_at!,
    });
  }

  return items.sort((a, b) => b.deletedAt - a.deletedAt);
}

export const RESTORE_SCHEMA = z.object({
  kind: z.enum(['module', 'tag', 'session', 'todo']),
  id: z.string().min(1),
});

export function restoreTrashItem(
  ctx: DbContext,
  rawBody: unknown,
): { ok: true; cursor: number } {
  const { kind, id } = RESTORE_SCHEMA.parse(rawBody);
  const { sqlite, nextCursor } = ctx;

  const restoreModuleById = (modId: string) => {
    sqlite
      .prepare('UPDATE modules SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL')
      .run(nextCursor(), modId);
  };

  const restoreTagById = (tagId: string) => {
    const tag = sqlite.prepare('SELECT * FROM tags WHERE id = ?').get(tagId) as TagEntity | undefined;
    if (!tag) return;
    restoreModuleById(tag.module_id);
    if (tag.deleted_at !== null) {
      // 检查同一模块下是否已有未删同名事项，若存在则改名后恢复避免唯一索引冲突
      const dup = sqlite
        .prepare('SELECT id FROM tags WHERE module_id = ? AND name = ? AND deleted_at IS NULL AND id != ?')
        .get(tag.module_id, tag.name, tag.id) as { id: string } | undefined;
      if (dup) {
        sqlite
          .prepare('UPDATE tags SET name = ?, deleted_at = NULL, updated_at = ? WHERE id = ?')
          .run(`${tag.name} (恢复)`, nextCursor(), tag.id);
      } else {
        sqlite
          .prepare('UPDATE tags SET deleted_at = NULL, updated_at = ? WHERE id = ?')
          .run(nextCursor(), tag.id);
      }
    }
  };

  const tx = sqlite.transaction(() => {
    if (kind === 'module') {
      restoreModuleById(id);
    } else if (kind === 'tag') {
      restoreTagById(id);
    } else if (kind === 'session') {
      const sess = sqlite.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as
        | SessionEntity
        | undefined;
      if (sess) {
        if (sess.tag_id) restoreTagById(sess.tag_id);
        sqlite
          .prepare('UPDATE sessions SET deleted_at = NULL, updated_at = ? WHERE id = ?')
          .run(nextCursor(), id);
      }
    } else if (kind === 'todo') {
      const td = sqlite.prepare('SELECT * FROM todos WHERE id = ?').get(id) as
        | TodoEntity
        | undefined;
      if (td) {
        if (td.tag_id) restoreTagById(td.tag_id);
        sqlite
          .prepare('UPDATE todos SET deleted_at = NULL, updated_at = ? WHERE id = ?')
          .run(nextCursor(), id);
      }
    }
  });

  tx();
  return { ok: true, cursor: ctx.getLastCursor() };
}
