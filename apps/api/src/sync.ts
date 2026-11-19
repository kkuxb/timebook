import {
  MUTATIONS_REQUEST_SCHEMA,
  TRASH_RETENTION_MS,
  type MutationItem,
  type SyncResponse,
} from '@timebook/core';
import type { DbContext } from './db/client.js';

export interface SyncQueryResult extends SyncResponse {
  runningSessionIds: string[];
}

export function querySyncSince(ctx: DbContext, since: number): SyncQueryResult {
  const cutoffTrash = Date.now() - TRASH_RETENTION_MS;
  const isInitial = since <= 0;

  const modules = ctx.sqlite
    .prepare(
      isInitial
        ? 'SELECT * FROM modules WHERE updated_at > ? AND (deleted_at IS NULL OR deleted_at >= ?)'
        : 'SELECT * FROM modules WHERE updated_at > ?',
    )
    .all(...(isInitial ? [since, cutoffTrash] : [since])) as SyncResponse['modules'];

  const tags = ctx.sqlite
    .prepare(
      isInitial
        ? 'SELECT * FROM tags WHERE updated_at > ? AND (deleted_at IS NULL OR deleted_at >= ?)'
        : 'SELECT * FROM tags WHERE updated_at > ?',
    )
    .all(...(isInitial ? [since, cutoffTrash] : [since])) as SyncResponse['tags'];

  const sessions = ctx.sqlite
    .prepare(
      isInitial
        ? 'SELECT * FROM sessions WHERE updated_at > ? AND (deleted_at IS NULL OR deleted_at >= ?)'
        : 'SELECT * FROM sessions WHERE updated_at > ?',
    )
    .all(...(isInitial ? [since, cutoffTrash] : [since])) as SyncResponse['sessions'];

  const todos = ctx.sqlite
    .prepare(
      isInitial
        ? 'SELECT * FROM todos WHERE updated_at > ? AND (deleted_at IS NULL OR deleted_at >= ?)'
        : 'SELECT * FROM todos WHERE updated_at > ?',
    )
    .all(...(isInitial ? [since, cutoffTrash] : [since])) as SyncResponse['todos'];

  const todoChecks = ctx.sqlite
    .prepare(
      isInitial
        ? 'SELECT * FROM todo_checks WHERE updated_at > ? AND (deleted_at IS NULL OR deleted_at >= ?)'
        : 'SELECT * FROM todo_checks WHERE updated_at > ?',
    )
    .all(...(isInitial ? [since, cutoffTrash] : [since])) as SyncResponse['todoChecks'];

  const runningRows = ctx.sqlite
    .prepare('SELECT id FROM sessions WHERE end_at IS NULL AND deleted_at IS NULL')
    .all() as Array<{ id: string }>;

  return {
    cursor: ctx.getLastCursor(),
    serverTime: Date.now(),
    modules,
    tags,
    sessions,
    todos,
    todoChecks,
    runningSessionIds: runningRows.map((r) => r.id),
  };
}

export class MutationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MutationConflictError';
  }
}

export function applyMutationsBatch(
  ctx: DbContext,
  rawBody: unknown,
): { ok: true; cursor: number; serverTime: number; appliedCount: number } {
  const parsed = MUTATIONS_REQUEST_SCHEMA.parse(rawBody);
  const { sqlite, nextCursor } = ctx;

  const checkApplied = sqlite.prepare(
    'SELECT mutation_id FROM applied_mutations WHERE mutation_id = ?',
  );
  const insertApplied = sqlite.prepare(
    'INSERT INTO applied_mutations (mutation_id, applied_at) VALUES (?, ?)',
  );

  const upsertModStmt = sqlite.prepare(`
    INSERT INTO modules (id, name, color_key, sort, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      color_key = excluded.color_key,
      sort = excluded.sort,
      updated_at = excluded.updated_at,
      deleted_at = NULL
  `);

  const upsertTagStmt = sqlite.prepare(`
    INSERT INTO tags (id, module_id, name, sort, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET
      module_id = excluded.module_id,
      name = excluded.name,
      sort = excluded.sort,
      updated_at = excluded.updated_at,
      deleted_at = NULL
  `);

  const upsertSessionStmt = sqlite.prepare(`
    INSERT INTO sessions (id, tag_id, todo_id, title, start_at, end_at, source, import_batch, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET
      tag_id = excluded.tag_id,
      todo_id = excluded.todo_id,
      title = excluded.title,
      start_at = excluded.start_at,
      end_at = excluded.end_at,
      source = excluded.source,
      import_batch = excluded.import_batch,
      updated_at = excluded.updated_at,
      deleted_at = NULL
  `);

  const upsertTodoStmt = sqlite.prepare(`
    INSERT INTO todos (id, title, tag_id, plan_date, due_date, recur, done_at, sort, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      tag_id = excluded.tag_id,
      plan_date = excluded.plan_date,
      due_date = excluded.due_date,
      recur = excluded.recur,
      done_at = excluded.done_at,
      sort = excluded.sort,
      updated_at = excluded.updated_at,
      deleted_at = NULL
  `);

  let appliedCount = 0;

  const applyOne = (m: MutationItem) => {
    const ts = nextCursor();
    switch (m.type) {
      case 'module.upsert': {
        const p = m.payload;
        upsertModStmt.run(p.id, p.name.trim(), p.color_key, p.sort ?? 0, p.created_at ?? ts, ts);
        break;
      }
      case 'module.delete': {
        const { id, mode, targetModuleId } = m.payload;
        const modTags = sqlite
          .prepare('SELECT id, name FROM tags WHERE module_id = ? AND deleted_at IS NULL')
          .all(id) as Array<{ id: string; name: string }>;

        if (mode === 'move' && targetModuleId && targetModuleId !== id) {
          const findTargetSameName = sqlite.prepare(
            'SELECT id FROM tags WHERE module_id = ? AND name = ? AND deleted_at IS NULL AND id != ?',
          );
          const moveSessionsByTag = sqlite.prepare(
            'UPDATE sessions SET tag_id = ?, updated_at = ? WHERE tag_id = ? AND deleted_at IS NULL',
          );
          const moveTodosByTag = sqlite.prepare(
            'UPDATE todos SET tag_id = ?, updated_at = ? WHERE tag_id = ? AND deleted_at IS NULL',
          );
          const softDelTag = sqlite.prepare(
            'UPDATE tags SET deleted_at = ?, updated_at = ? WHERE id = ?',
          );
          const moveTagMod = sqlite.prepare(
            'UPDATE tags SET module_id = ?, updated_at = ? WHERE id = ?',
          );

          for (const t of modTags) {
            const dup = findTargetSameName.get(targetModuleId, t.name, t.id) as
              | { id: string }
              | undefined;
            if (dup) {
              moveSessionsByTag.run(dup.id, nextCursor(), t.id);
              moveTodosByTag.run(dup.id, nextCursor(), t.id);
              softDelTag.run(ts, nextCursor(), t.id);
            } else {
              moveTagMod.run(targetModuleId, nextCursor(), t.id);
            }
          }
        } else {
          // drop 模式：软删模块下事项及已结束记录，保留关联待办和进行中计时并置 tag_id = NULL
          for (const t of modTags) {
            sqlite
              .prepare(
                'UPDATE sessions SET deleted_at = ?, updated_at = ? WHERE tag_id = ? AND end_at IS NOT NULL AND deleted_at IS NULL',
              )
              .run(ts, nextCursor(), t.id);
            sqlite
              .prepare(
                'UPDATE sessions SET tag_id = NULL, updated_at = ? WHERE tag_id = ? AND end_at IS NULL AND deleted_at IS NULL',
              )
              .run(nextCursor(), t.id);
            sqlite
              .prepare(
                'UPDATE todos SET tag_id = NULL, updated_at = ? WHERE tag_id = ? AND deleted_at IS NULL',
              )
              .run(nextCursor(), t.id);
            sqlite
              .prepare('UPDATE tags SET deleted_at = ?, updated_at = ? WHERE id = ?')
              .run(ts, nextCursor(), t.id);
          }
        }
        sqlite
          .prepare('UPDATE modules SET deleted_at = ?, updated_at = ? WHERE id = ?')
          .run(ts, nextCursor(), id);
        break;
      }
      case 'tag.upsert': {
        const p = m.payload;
        const cleanName = p.name.trim();
        const dup = sqlite
          .prepare(
            'SELECT id FROM tags WHERE module_id = ? AND name = ? AND deleted_at IS NULL AND id != ?',
          )
          .get(p.module_id, cleanName, p.id) as { id: string } | undefined;
        if (dup) {
          throw new MutationConflictError(`该模块下已存在同名事项「${cleanName}」`);
        }
        upsertTagStmt.run(p.id, p.module_id, cleanName, p.sort ?? 0, p.created_at ?? ts, ts);
        break;
      }
      case 'tag.delete': {
        const { id, mode, targetTagId } = m.payload;
        if (mode === 'move' && targetTagId && targetTagId !== id) {
          sqlite
            .prepare(
              'UPDATE sessions SET tag_id = ?, updated_at = ? WHERE tag_id = ? AND deleted_at IS NULL',
            )
            .run(targetTagId, nextCursor(), id);
          sqlite
            .prepare(
              'UPDATE todos SET tag_id = ?, updated_at = ? WHERE tag_id = ? AND deleted_at IS NULL',
            )
            .run(targetTagId, nextCursor(), id);
        } else {
          // drop 模式：软删关联的已结束记录，保留关联待办和进行中计时并转未分类
          sqlite
            .prepare(
              'UPDATE sessions SET deleted_at = ?, updated_at = ? WHERE tag_id = ? AND end_at IS NOT NULL AND deleted_at IS NULL',
            )
            .run(ts, nextCursor(), id);
          sqlite
            .prepare(
              'UPDATE sessions SET tag_id = NULL, updated_at = ? WHERE tag_id = ? AND end_at IS NULL AND deleted_at IS NULL',
            )
            .run(nextCursor(), id);
          sqlite
            .prepare(
              'UPDATE todos SET tag_id = NULL, updated_at = ? WHERE tag_id = ? AND deleted_at IS NULL',
            )
            .run(nextCursor(), id);
        }
        sqlite
          .prepare('UPDATE tags SET deleted_at = ?, updated_at = ? WHERE id = ?')
          .run(ts, nextCursor(), id);
        break;
      }
      case 'session.upsert': {
        const p = m.payload;
        upsertSessionStmt.run(
          p.id,
          p.tag_id,
          p.todo_id ?? null,
          p.title ?? null,
          p.start_at,
          p.end_at,
          p.source ?? 'manual',
          p.import_batch ?? null,
          p.created_at ?? ts,
          ts,
        );
        break;
      }
      case 'session.cancel_running': {
        // 取消进行中的计时：物理删除不留痕迹，不进入回收站
        sqlite
          .prepare('DELETE FROM sessions WHERE id = ? AND end_at IS NULL')
          .run(m.payload.id);
        break;
      }
      case 'session.delete': {
        sqlite
          .prepare('UPDATE sessions SET deleted_at = ?, updated_at = ? WHERE id = ?')
          .run(ts, ts, m.payload.id);
        break;
      }
      case 'todo.upsert': {
        const p = m.payload;
        upsertTodoStmt.run(
          p.id,
          p.title.trim(),
          p.tag_id,
          p.plan_date,
          p.due_date,
          p.recur,
          p.done_at,
          p.sort ?? 0,
          p.created_at ?? ts,
          ts,
        );
        break;
      }
      case 'todo.delete': {
        sqlite
          .prepare('UPDATE todos SET deleted_at = ?, updated_at = ? WHERE id = ?')
          .run(ts, ts, m.payload.id);
        break;
      }
      case 'todo_check.toggle': {
        const p = m.payload;
        if (p.done) {
          sqlite
            .prepare(
              `INSERT INTO todo_checks (todo_id, date, done_at, updated_at, deleted_at)
               VALUES (?, ?, ?, ?, NULL)
               ON CONFLICT(todo_id, date) DO UPDATE SET
                 done_at = excluded.done_at,
                 updated_at = excluded.updated_at,
                 deleted_at = NULL`,
            )
            .run(p.todo_id, p.date, p.done_at ?? ts, ts);
        } else {
          sqlite
            .prepare(
              `INSERT INTO todo_checks (todo_id, date, done_at, updated_at, deleted_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(todo_id, date) DO UPDATE SET
                 updated_at = excluded.updated_at,
                 deleted_at = excluded.deleted_at`,
            )
            .run(p.todo_id, p.date, p.done_at ?? ts, ts, ts);
        }
        break;
      }
    }
  };

  const tx = sqlite.transaction(() => {
    for (const m of parsed.mutations) {
      const exists = checkApplied.get(m.mutation_id);
      if (exists) continue;
      applyOne(m);
      insertApplied.run(m.mutation_id, Date.now());
      appliedCount += 1;
    }
  });

  tx();

  return {
    ok: true,
    cursor: ctx.getLastCursor(),
    serverTime: Date.now(),
    appliedCount,
  };
}
