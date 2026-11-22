import { ulid } from 'ulid';
import { DEFAULT_MODULE_SEEDS } from './palette.js';
import type {
  ModuleEntity,
  MutationItem,
  SessionEntity,
  TagEntity,
  TodoCheckEntity,
  TodoEntity,
} from './types.js';

export interface MergeDataset {
  modules: ModuleEntity[];
  tags: TagEntity[];
  sessions: SessionEntity[];
  todos: TodoEntity[];
  todoChecks: TodoCheckEntity[];
}

export interface LocalToRemoteMergePlan {
  remappedLocalState: MergeDataset;
  mutationsToPush: MutationItem[];
  moduleIdMap: Record<string, string>;
  tagIdMap: Record<string, string>;
}

/**
 * 生成与服务端 SQLite 初始化完全同构的默认四模块种子（工作/学习/游戏/锻炼）。
 */
export function createDefaultModulesSeed(nowMs = Date.now()): ModuleEntity[] {
  return DEFAULT_MODULE_SEEDS.map((seed, index) => {
    const ts = nowMs + index;
    return {
      id: ulid(),
      name: seed.name,
      color_key: seed.colorKey,
      sort: seed.sort,
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
    };
  });
}

/**
 * 幂等保证仅在无任何有效模块且仅由主窗口初始化时才生成默认四模块种子。
 */
export function ensureSingleDefaultModulesSeed(
  existingModules: ModuleEntity[],
  windowKind: 'main' | 'widget' | 'launcher',
  nowMs = Date.now(),
): ModuleEntity[] | null {
  if (windowKind !== 'main') return null;
  if (existingModules.length > 0) return null;
  return createDefaultModulesSeed(nowMs);
}

/**
 * 若存在同名未删的重复模块（如历史多窗并发冷启动产生），按名称保留最早创建的 1 个并将关联事项归并到保留模块。
 */
export function dedupeDuplicateModules(
  modules: ModuleEntity[],
  tags: TagEntity[],
): { modules: ModuleEntity[]; tags: TagEntity[]; deduped: boolean } {
  const activeByName = new Map<string, ModuleEntity>();
  const remapModuleId = new Map<string, string>();
  const keptModules: ModuleEntity[] = [];

  const sorted = [...modules].sort((a, b) => a.created_at - b.created_at || a.sort - b.sort);
  for (const mod of sorted) {
    if (mod.deleted_at !== null) {
      keptModules.push(mod);
      continue;
    }
    const key = mod.name.trim();
    const first = activeByName.get(key);
    if (!first) {
      activeByName.set(key, mod);
      keptModules.push(mod);
    } else {
      remapModuleId.set(mod.id, first.id);
    }
  }

  if (remapModuleId.size === 0) {
    return { modules, tags, deduped: false };
  }

  const nextTags = tags.map((t) => {
    const mapped = remapModuleId.get(t.module_id);
    return mapped ? { ...t, module_id: mapped } : t;
  });

  return { modules: keptModules, tags: nextTags, deduped: true };
}

/**
 * 规划单机本地数据首次接入远端 NAS 服务时的无损合并去重方案：
 * - 同名未删模块（含默认四模块）自动映射到远端模块 ID，避免产生重复模块；
 * - 同映射模块下的同名未删事项自动映射到远端事项 ID；
 * - 其余本机新建模块、事项、待办、重复打卡与专注记录（含进行中计时）重写外键后按依赖顺序生成幂等变更批。
 */
export function planLocalToRemoteMerge(
  local: MergeDataset,
  remote: MergeDataset,
): LocalToRemoteMergePlan {
  const moduleIdMap = new Map<string, string>();
  const tagIdMap = new Map<string, string>();

  const remoteModuleIds = new Set(remote.modules.map((m) => m.id));
  const remoteActiveModByName = new Map<string, ModuleEntity>();
  for (const m of remote.modules) {
    if (m.deleted_at === null) {
      remoteActiveModByName.set(m.name.trim(), m);
    }
  }

  const remoteTagIds = new Set(remote.tags.map((t) => t.id));
  const remoteActiveTagByModAndName = new Map<string, TagEntity>();
  for (const t of remote.tags) {
    if (t.deleted_at === null) {
      remoteActiveTagByModAndName.set(`${t.module_id}::${t.name.trim()}`, t);
    }
  }

  const remoteTodoIds = new Set(remote.todos.map((td) => td.id));
  const remoteSessionIds = new Set(remote.sessions.map((s) => s.id));
  const remoteCheckKeys = new Set(
    remote.todoChecks
      .filter((c) => c.deleted_at === null)
      .map((c) => `${c.todo_id}::${c.date}`),
  );

  const modMutations: MutationItem[] = [];
  const tagMutations: MutationItem[] = [];
  const todoMutations: MutationItem[] = [];
  const checkMutations: MutationItem[] = [];
  const sessionMutations: MutationItem[] = [];

  const mergedModules = [...remote.modules];
  const mergedTags = [...remote.tags];
  const mergedTodos = [...remote.todos];
  const mergedChecks = [...remote.todoChecks];
  const mergedSessions = [...remote.sessions];

  for (const mod of local.modules) {
    if (mod.deleted_at !== null) continue;
    const cleanName = mod.name.trim();
    const matchedRemote = remoteActiveModByName.get(cleanName);
    if (matchedRemote) {
      moduleIdMap.set(mod.id, matchedRemote.id);
      continue;
    }
    moduleIdMap.set(mod.id, mod.id);
    if (!remoteModuleIds.has(mod.id)) {
      remoteModuleIds.add(mod.id);
      mergedModules.push({ ...mod, name: cleanName });
      modMutations.push({
        mutation_id: `merge:mod:${mod.id}:${mod.updated_at}`,
        type: 'module.upsert',
        payload: {
          id: mod.id,
          name: cleanName,
          color_key: mod.color_key,
          sort: mod.sort,
          created_at: mod.created_at,
        },
      });
    }
  }

  for (const tag of local.tags) {
    if (tag.deleted_at !== null) continue;
    const mappedModId = moduleIdMap.get(tag.module_id) ?? tag.module_id;
    const cleanName = tag.name.trim();
    const matchedRemote = remoteActiveTagByModAndName.get(`${mappedModId}::${cleanName}`);
    if (matchedRemote) {
      tagIdMap.set(tag.id, matchedRemote.id);
      continue;
    }
    tagIdMap.set(tag.id, tag.id);
    if (!remoteTagIds.has(tag.id)) {
      remoteTagIds.add(tag.id);
      const disabledAt = tag.disabled_at ?? null;
      const remappedTag: TagEntity = {
        ...tag,
        module_id: mappedModId,
        name: cleanName,
        disabled_at: disabledAt,
      };
      mergedTags.push(remappedTag);
      tagMutations.push({
        mutation_id: `merge:tag:${tag.id}:${tag.updated_at}`,
        type: 'tag.upsert',
        payload: {
          id: tag.id,
          module_id: mappedModId,
          name: cleanName,
          sort: tag.sort,
          created_at: tag.created_at,
          disabled_at: disabledAt,
        },
      });
    }
  }

  for (const todo of local.todos) {
    if (todo.deleted_at !== null) continue;
    const mappedTagId = todo.tag_id ? (tagIdMap.get(todo.tag_id) ?? todo.tag_id) : null;
    if (!remoteTodoIds.has(todo.id)) {
      remoteTodoIds.add(todo.id);
      const remappedTodo: TodoEntity = {
        ...todo,
        tag_id: mappedTagId,
      };
      mergedTodos.push(remappedTodo);
      todoMutations.push({
        mutation_id: `merge:todo:${todo.id}:${todo.updated_at}`,
        type: 'todo.upsert',
        payload: {
          id: todo.id,
          title: todo.title.trim(),
          tag_id: mappedTagId,
          plan_date: todo.plan_date,
          due_date: todo.due_date,
          recur: todo.recur,
          done_at: todo.done_at,
          sort: todo.sort,
          created_at: todo.created_at,
        },
      });
    }
  }

  for (const check of local.todoChecks) {
    if (check.deleted_at !== null) continue;
    const key = `${check.todo_id}::${check.date}`;
    if (!remoteCheckKeys.has(key)) {
      remoteCheckKeys.add(key);
      mergedChecks.push({ ...check });
      checkMutations.push({
        mutation_id: `merge:check:${check.todo_id}:${check.date}:${check.updated_at}`,
        type: 'todo_check.toggle',
        payload: {
          todo_id: check.todo_id,
          date: check.date,
          done: true,
          done_at: check.done_at,
        },
      });
    }
  }

  for (const session of local.sessions) {
    if (session.deleted_at !== null) continue;
    const mappedTagId = session.tag_id ? (tagIdMap.get(session.tag_id) ?? session.tag_id) : null;
    if (!remoteSessionIds.has(session.id)) {
      remoteSessionIds.add(session.id);
      const remappedSession: SessionEntity = {
        ...session,
        tag_id: mappedTagId,
      };
      mergedSessions.push(remappedSession);
      sessionMutations.push({
        mutation_id: `merge:session:${session.id}:${session.updated_at}`,
        type: 'session.upsert',
        payload: {
          id: session.id,
          tag_id: mappedTagId,
          todo_id: session.todo_id,
          title: session.title,
          start_at: session.start_at,
          end_at: session.end_at,
          source: session.source,
          import_batch: session.import_batch,
          created_at: session.created_at,
        },
      });
    }
  }

  return {
    remappedLocalState: {
      modules: mergedModules,
      tags: mergedTags,
      sessions: mergedSessions,
      todos: mergedTodos,
      todoChecks: mergedChecks,
    },
    mutationsToPush: [
      ...modMutations,
      ...tagMutations,
      ...todoMutations,
      ...checkMutations,
      ...sessionMutations,
    ],
    moduleIdMap: Object.fromEntries(moduleIdMap),
    tagIdMap: Object.fromEntries(tagIdMap),
  };
}

/**
 * 检测远端服务端返回的标签对象是否表明其为不支持 disabled_at 或静默丢弃停用状态的旧版服务端。
 * - 若未返回目标记录（null/undefined）返回 false；
 * - 若对象缺少 'disabled_at' 属性键，说明旧版服务端未包含该字段，返回 true；
 * - 若期望停用（expectedDisabled === true）但服务端返回的 disabled_at 不是有效数字，返回 true；
 * - 其余情况（包含新版重新启用返回 disabled_at: null）返回 false。
 */
export function detectLegacyTagDisableIgnored(
  rawRemoteTag: Record<string, unknown> | null | undefined,
  expectedDisabled: boolean,
): boolean {
  if (!rawRemoteTag) return false;
  if (!Object.prototype.hasOwnProperty.call(rawRemoteTag, 'disabled_at')) {
    return true;
  }
  if (expectedDisabled) {
    const val = rawRemoteTag.disabled_at;
    if (typeof val !== 'number' || !Number.isFinite(val)) {
      return true;
    }
  }
  return false;
}
