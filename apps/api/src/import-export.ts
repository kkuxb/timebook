import { z } from 'zod';
import {
  formatShanghaiTime,
  toCsv,
  toShanghaiDateStr,
  TRASH_RETENTION_MS,
  type ModuleEntity,
  type SessionEntity,
  type TagEntity,
  type TodoEntity,
} from '@timebook/core';
import type { DbContext } from './db/client.js';

export function exportDatabaseJson(ctx: DbContext) {
  const modules = ctx.sqlite.prepare('SELECT * FROM modules').all() as ModuleEntity[];
  const tags = ctx.sqlite.prepare('SELECT * FROM tags').all() as TagEntity[];
  const sessions = ctx.sqlite.prepare('SELECT * FROM sessions').all() as SessionEntity[];
  const todos = ctx.sqlite.prepare('SELECT * FROM todos').all() as TodoEntity[];
  const todoChecks = ctx.sqlite.prepare('SELECT * FROM todo_checks').all();

  return {
    exportedAt: Date.now(),
    version: '0.2.0',
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

  const allMods = ctx.sqlite.prepare('SELECT * FROM modules').all() as ModuleEntity[];
  const allTags = ctx.sqlite.prepare('SELECT * FROM tags').all() as TagEntity[];
  const modMap = new Map(allMods.map((m) => [m.id, m]));
  const tagMap = new Map(allTags.map((t) => [t.id, t]));

  const items: TrashItem[] = [];

  for (const m of allMods) {
    if (m.deleted_at !== null && m.deleted_at >= cutoff) {
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
    if (t.deleted_at !== null && t.deleted_at >= cutoff) {
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
