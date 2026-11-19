import Dexie, { type Table } from 'dexie';
import type {
  ModuleEntity,
  MutationItem,
  SessionEntity,
  SyncResponse,
  TagEntity,
  TodoCheckEntity,
  TodoEntity,
} from '@timebook/core';

export interface PendingMutationRecord {
  seq?: number;
  mutation_id: string;
  type: MutationItem['type'];
  payload: unknown;
  createdAt: number;
}

export interface MetaRecord {
  key: string;
  value: unknown;
}

class TimebookDexie extends Dexie {
  modules!: Table<ModuleEntity, string>;
  tags!: Table<TagEntity, string>;
  sessions!: Table<SessionEntity, string>;
  todos!: Table<TodoEntity, string>;
  todoChecks!: Table<TodoCheckEntity, [string, string]>;
  pendingMutations!: Table<PendingMutationRecord, number>;
  meta!: Table<MetaRecord, string>;

  constructor() {
    super('timebook-local');
    this.version(1).stores({
      modules: 'id, updated_at, deleted_at',
      tags: 'id, module_id, updated_at, deleted_at',
      sessions: 'id, tag_id, todo_id, start_at, end_at, updated_at, deleted_at',
      todos: 'id, tag_id, plan_date, updated_at, deleted_at',
      todoChecks: '[todo_id+date], todo_id, date, updated_at',
      pendingMutations: '++seq, mutation_id',
      meta: 'key',
    });
  }
}

export const localDb = new TimebookDexie();

export interface LocalSnapshot {
  cursor: number;
  lastSavedAt: number | null;
  modules: ModuleEntity[];
  tags: TagEntity[];
  sessions: SessionEntity[];
  todos: TodoEntity[];
  todoChecks: TodoCheckEntity[];
  pending: PendingMutationRecord[];
}

export async function loadLocalSnapshot(): Promise<LocalSnapshot> {
  const [modules, tags, sessions, todos, todoChecks, pending, cursorMeta, savedMeta] =
    await Promise.all([
      localDb.modules.toArray(),
      localDb.tags.toArray(),
      localDb.sessions.toArray(),
      localDb.todos.toArray(),
      localDb.todoChecks.toArray(),
      localDb.pendingMutations.orderBy('seq').toArray(),
      localDb.meta.get('syncCursor'),
      localDb.meta.get('lastSavedAt'),
    ]);

  return {
    cursor: typeof cursorMeta?.value === 'number' ? cursorMeta.value : 0,
    lastSavedAt: typeof savedMeta?.value === 'number' ? savedMeta.value : null,
    modules,
    tags,
    sessions,
    todos,
    todoChecks,
    pending,
  };
}

export async function persistFullSync(
  data: SyncResponse & { runningSessionIds?: string[] },
): Promise<void> {
  await localDb.transaction(
    'rw',
    [localDb.modules, localDb.tags, localDb.sessions, localDb.todos, localDb.todoChecks, localDb.meta],
    async () => {
      await Promise.all([
        localDb.modules.clear(),
        localDb.tags.clear(),
        localDb.sessions.clear(),
        localDb.todos.clear(),
        localDb.todoChecks.clear(),
      ]);
      if (data.modules.length) await localDb.modules.bulkPut(data.modules);
      if (data.tags.length) await localDb.tags.bulkPut(data.tags);
      if (data.sessions.length) await localDb.sessions.bulkPut(data.sessions);
      if (data.todos.length) await localDb.todos.bulkPut(data.todos);
      if (data.todoChecks.length) await localDb.todoChecks.bulkPut(data.todoChecks);
      await localDb.meta.put({ key: 'syncCursor', value: data.cursor });
    },
  );
}

export async function persistDeltaSync(
  data: SyncResponse & { runningSessionIds?: string[] },
): Promise<void> {
  await localDb.transaction(
    'rw',
    [localDb.modules, localDb.tags, localDb.sessions, localDb.todos, localDb.todoChecks, localDb.meta],
    async () => {
      if (data.modules.length) await localDb.modules.bulkPut(data.modules);
      if (data.tags.length) await localDb.tags.bulkPut(data.tags);
      if (data.sessions.length) await localDb.sessions.bulkPut(data.sessions);
      if (data.todos.length) await localDb.todos.bulkPut(data.todos);
      if (data.todoChecks.length) await localDb.todoChecks.bulkPut(data.todoChecks);

      // 如果服务端传回了活跃进行中 ID 集合，清理已经在其他端被取消（物理删除）的本地进行中记录
      if (data.runningSessionIds) {
        const runningSet = new Set(data.runningSessionIds);
        const localRunning = await localDb.sessions
          .filter((s) => s.end_at === null && s.deleted_at === null)
          .toArray();
        const staleIds = localRunning.filter((s) => !runningSet.has(s.id)).map((s) => s.id);
        if (staleIds.length > 0) {
          await localDb.sessions.bulkDelete(staleIds);
        }
      }

      await localDb.meta.put({ key: 'syncCursor', value: data.cursor });
    },
  );
}

export async function clearAllLocalData(): Promise<void> {
  await localDb.transaction(
    'rw',
    [
      localDb.modules,
      localDb.tags,
      localDb.sessions,
      localDb.todos,
      localDb.todoChecks,
      localDb.pendingMutations,
      localDb.meta,
    ],
    async () => {
      await Promise.all([
        localDb.modules.clear(),
        localDb.tags.clear(),
        localDb.sessions.clear(),
        localDb.todos.clear(),
        localDb.todoChecks.clear(),
        localDb.pendingMutations.clear(),
        localDb.meta.clear(),
      ]);
    },
  );
}
