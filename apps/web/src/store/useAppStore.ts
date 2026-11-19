import { create } from 'zustand';
import { ulid } from 'ulid';
import type {
  ColorKey,
  ModuleEntity,
  MutationItem,
  SessionEntity,
  SyncResponse,
  TagEntity,
  TodoCheckEntity,
  TodoEntity,
} from '@timebook/core';
import {
  clearAllLocalData,
  loadLocalSnapshot,
  localDb,
  persistDeltaSync,
  persistFullSync,
  type PendingMutationRecord,
} from '../db/dexie.js';

export type NavTab = 'today' | 'calendar' | 'stats' | 'tags';
export type AuthState = 'checking' | 'unauthenticated' | 'authenticated';
export type SyncStatus = 'ok' | 'saving' | 'offline' | 'db_error';

const RETRY_DELAYS_MS = [2000, 5000, 15000, 30000];

interface AppState {
  activeTab: NavTab;
  authState: AuthState;
  syncStatus: SyncStatus;
  lastSavedAt: number | null;
  lastError: string | null;
  errorBanner: string | null;
  clockOffsetMs: number;
  syncCursor: number;
  pendingCount: number;
  lastBackupAt: number | null;
  settingsOpen: boolean;

  modules: ModuleEntity[];
  tags: TagEntity[];
  sessions: SessionEntity[];
  todos: TodoEntity[];
  todoChecks: TodoCheckEntity[];

  setActiveTab: (tab: NavTab) => void;
  setSettingsOpen: (open: boolean) => void;
  dismissErrorBanner: () => void;
  nowMs: () => number;

  init: () => Promise<void>;
  login: (password: string) => Promise<{ ok: boolean; error?: string; retryAfterSec?: number }>;
  logout: () => Promise<void>;
  checkHealthAndSync: () => Promise<void>;
  retryNow: () => Promise<void>;
  refreshAfterServerAction: () => Promise<void>;

  enqueueMutation: (item: { type: MutationItem['type']; payload: unknown }) => Promise<void>;

  startTimer: (opts: { tagId: string | null; title: string | null; todoId?: string | null }) => Promise<string>;
  updateSession: (session: SessionEntity) => Promise<void>;
  cancelRunningTimer: (sessionId: string) => Promise<void>;
  endTimer: (sessionId: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;

  upsertTodo: (todo: TodoEntity) => Promise<void>;
  deleteTodo: (todoId: string) => Promise<void>;
  toggleTodoDone: (todo: TodoEntity, dateStr: string, done: boolean) => Promise<void>;

  upsertModule: (mod: ModuleEntity) => Promise<void>;
  deleteModule: (id: string, mode: 'move' | 'drop', targetModuleId?: string) => Promise<void>;

  upsertTag: (tag: TagEntity) => Promise<void>;
  deleteTag: (id: string, mode: 'move' | 'drop', targetTagId?: string) => Promise<void>;
}

let flushInFlight: Promise<void> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempt = 0;

function clearRetryTimer() {
  if (retryTimer !== null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function applyOptimisticMutation(
  state: AppState,
  item: { type: MutationItem['type']; payload: unknown },
  now: number,
): Partial<AppState> {
  const payload = item.payload as Record<string, unknown>;
  switch (item.type) {
    case 'module.upsert': {
      const p = payload as unknown as ModuleEntity;
      const nextItem: ModuleEntity = {
        id: p.id,
        name: p.name,
        color_key: p.color_key,
        sort: p.sort ?? state.modules.length,
        created_at: p.created_at ?? now,
        updated_at: now,
        deleted_at: null,
      };
      const exists = state.modules.some((m) => m.id === nextItem.id);
      const modules = exists
        ? state.modules.map((m) => (m.id === nextItem.id ? nextItem : m))
        : [...state.modules, nextItem];
      void localDb.modules.put(nextItem);
      return { modules };
    }
    case 'module.delete': {
      const id = payload.id as string;
      const mode = payload.mode as 'move' | 'drop';
      const targetModuleId = payload.targetModuleId as string | undefined;
      const modTags = state.tags.filter((t) => t.module_id === id && t.deleted_at === null);
      const modTagIds = new Set(modTags.map((t) => t.id));

      let tags = state.tags;
      let sessions = state.sessions;
      let todos = state.todos;

      if (mode === 'move' && targetModuleId) {
        const targetExistingByName = new Map(
          tags
            .filter((t) => t.module_id === targetModuleId && t.deleted_at === null)
            .map((t) => [t.name, t.id]),
        );
        const remapTagId = new Map<string, string>();
        const deletedTagIds = new Set<string>();
        tags = tags.map((t) => {
          if (t.module_id !== id || t.deleted_at !== null) return t;
          const dupId = targetExistingByName.get(t.name);
          if (dupId) {
            remapTagId.set(t.id, dupId);
            deletedTagIds.add(t.id);
            return { ...t, deleted_at: now, updated_at: now };
          }
          return { ...t, module_id: targetModuleId, updated_at: now };
        });
        if (remapTagId.size > 0) {
          sessions = sessions.map((s) =>
            s.tag_id && remapTagId.has(s.tag_id) && s.deleted_at === null
              ? { ...s, tag_id: remapTagId.get(s.tag_id)!, updated_at: now }
              : s,
          );
          todos = todos.map((td) =>
            td.tag_id && remapTagId.has(td.tag_id) && td.deleted_at === null
              ? { ...td, tag_id: remapTagId.get(td.tag_id)!, updated_at: now }
              : td,
          );
        }
      } else {
        tags = tags.map((t) =>
          modTagIds.has(t.id) ? { ...t, deleted_at: now, updated_at: now } : t,
        );
        sessions = sessions.map((s) => {
          if (!s.tag_id || !modTagIds.has(s.tag_id) || s.deleted_at !== null) return s;
          if (s.end_at !== null) return { ...s, deleted_at: now, updated_at: now };
          return { ...s, tag_id: null, updated_at: now };
        });
        todos = todos.map((td) =>
          td.tag_id && modTagIds.has(td.tag_id) && td.deleted_at === null
            ? { ...td, tag_id: null, updated_at: now }
            : td,
        );
      }

      const modules = state.modules.map((m) =>
        m.id === id ? { ...m, deleted_at: now, updated_at: now } : m,
      );
      void localDb.modules.bulkPut(modules);
      void localDb.tags.bulkPut(tags);
      void localDb.sessions.bulkPut(sessions);
      void localDb.todos.bulkPut(todos);
      return { modules, tags, sessions, todos };
    }
    case 'tag.upsert': {
      const p = payload as unknown as TagEntity;
      const nextTag: TagEntity = {
        id: p.id,
        module_id: p.module_id,
        name: p.name,
        sort: p.sort ?? 0,
        created_at: p.created_at ?? now,
        updated_at: now,
        deleted_at: null,
      };
      const exists = state.tags.some((t) => t.id === nextTag.id);
      const tags = exists
        ? state.tags.map((t) => (t.id === nextTag.id ? nextTag : t))
        : [...state.tags, nextTag];
      void localDb.tags.put(nextTag);
      return { tags };
    }
    case 'tag.delete': {
      const id = payload.id as string;
      const mode = payload.mode as 'move' | 'drop';
      const targetTagId = payload.targetTagId as string | undefined;

      let sessions = state.sessions;
      let todos = state.todos;
      if (mode === 'move' && targetTagId) {
        sessions = sessions.map((s) =>
          s.tag_id === id && s.deleted_at === null
            ? { ...s, tag_id: targetTagId, updated_at: now }
            : s,
        );
        todos = todos.map((td) =>
          td.tag_id === id && td.deleted_at === null
            ? { ...td, tag_id: targetTagId, updated_at: now }
            : td,
        );
      } else {
        sessions = sessions.map((s) => {
          if (s.tag_id !== id || s.deleted_at !== null) return s;
          if (s.end_at !== null) return { ...s, deleted_at: now, updated_at: now };
          return { ...s, tag_id: null, updated_at: now };
        });
        todos = todos.map((td) =>
          td.tag_id === id && td.deleted_at === null
            ? { ...td, tag_id: null, updated_at: now }
            : td,
        );
      }

      const tags = state.tags.map((t) =>
        t.id === id ? { ...t, deleted_at: now, updated_at: now } : t,
      );
      void localDb.tags.bulkPut(tags);
      void localDb.sessions.bulkPut(sessions);
      void localDb.todos.bulkPut(todos);
      return { tags, sessions, todos };
    }
    case 'session.upsert': {
      const p = payload as unknown as SessionEntity;
      const nextSess: SessionEntity = {
        id: p.id,
        tag_id: p.tag_id ?? null,
        todo_id: p.todo_id ?? null,
        title: p.title ?? null,
        start_at: p.start_at,
        end_at: p.end_at ?? null,
        source: p.source ?? 'manual',
        import_batch: p.import_batch ?? null,
        created_at: p.created_at ?? now,
        updated_at: now,
        deleted_at: null,
      };
      const exists = state.sessions.some((s) => s.id === nextSess.id);
      const sessions = exists
        ? state.sessions.map((s) => (s.id === nextSess.id ? nextSess : s))
        : [...state.sessions, nextSess];
      void localDb.sessions.put(nextSess);
      return { sessions };
    }
    case 'session.cancel_running': {
      const id = payload.id as string;
      const sessions = state.sessions.filter((s) => s.id !== id);
      void localDb.sessions.delete(id);
      return { sessions };
    }
    case 'session.delete': {
      const id = payload.id as string;
      const sessions = state.sessions.map((s) =>
        s.id === id ? { ...s, deleted_at: now, updated_at: now } : s,
      );
      const target = sessions.find((s) => s.id === id);
      if (target) void localDb.sessions.put(target);
      return { sessions };
    }
    case 'todo.upsert': {
      const p = payload as unknown as TodoEntity;
      const nextTodo: TodoEntity = {
        id: p.id,
        title: p.title,
        tag_id: p.tag_id ?? null,
        plan_date: p.plan_date ?? null,
        due_date: p.due_date ?? null,
        recur: p.recur ?? null,
        done_at: p.done_at ?? null,
        sort: p.sort ?? 0,
        created_at: p.created_at ?? now,
        updated_at: now,
        deleted_at: null,
      };
      const exists = state.todos.some((td) => td.id === nextTodo.id);
      const todos = exists
        ? state.todos.map((td) => (td.id === nextTodo.id ? nextTodo : td))
        : [...state.todos, nextTodo];
      void localDb.todos.put(nextTodo);
      return { todos };
    }
    case 'todo.delete': {
      const id = payload.id as string;
      const todos = state.todos.map((td) =>
        td.id === id ? { ...td, deleted_at: now, updated_at: now } : td,
      );
      const target = todos.find((td) => td.id === id);
      if (target) void localDb.todos.put(target);
      return { todos };
    }
    case 'todo_check.toggle': {
      const todo_id = payload.todo_id as string;
      const date = payload.date as string;
      const done = payload.done as boolean;
      const done_at = (payload.done_at as number | undefined) ?? now;
      const check: TodoCheckEntity = {
        todo_id,
        date,
        done_at,
        updated_at: now,
        deleted_at: done ? null : now,
      };
      const idx = state.todoChecks.findIndex(
        (c) => c.todo_id === todo_id && c.date === date,
      );
      const todoChecks =
        idx >= 0
          ? state.todoChecks.map((c, i) => (i === idx ? check : c))
          : [...state.todoChecks, check];
      void localDb.todoChecks.put(check);
      return { todoChecks };
    }
  }
  return {};
}

async function flushPendingQueue(): Promise<boolean> {
  if (flushInFlight) {
    await flushInFlight;
    return (await localDb.pendingMutations.count()) === 0;
  }

  let succeeded = true;
  flushInFlight = (async () => {
    while (true) {
      const batch: PendingMutationRecord[] = await localDb.pendingMutations
        .orderBy('seq')
        .toArray();
      if (batch.length === 0) break;

      useAppStore.setState({ syncStatus: 'saving', pendingCount: batch.length });

      try {
        const res = await fetch('/api/mutations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mutations: batch.map((b) => ({
              mutation_id: b.mutation_id,
              type: b.type,
              payload: b.payload,
            })),
          }),
        });

        if (res.status === 401) {
          useAppStore.setState({ authState: 'unauthenticated' });
          succeeded = false;
          break;
        }

        if (res.status === 400 || res.status === 409) {
          // 协议校验或命名冲突：丢弃问题批并立即全量拉回服务端权威状态，避免本地乐观状态失真
          const errJson = (await res.json().catch(() => ({}))) as { error?: string };
          const seqs = batch.map((b) => b.seq!).filter((x) => x !== undefined);
          await localDb.pendingMutations.bulkDelete(seqs);
          const left = await localDb.pendingMutations.count();
          const errMsg = errJson.error || `提交被服务端拒绝 (${res.status})，已还原为服务器最新状态`;
          useAppStore.setState({
            pendingCount: left,
            lastError: errMsg,
            errorBanner: errMsg,
          });
          await pullSyncDelta(true).catch(() => undefined);
          continue;
        }

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const seqs = batch.map((b) => b.seq!).filter((x) => x !== undefined);
        await localDb.pendingMutations.bulkDelete(seqs);
        const savedAt = Date.now();
        await localDb.meta.put({ key: 'lastSavedAt', value: savedAt });
        retryAttempt = 0;
        clearRetryTimer();

        const left = await localDb.pendingMutations.count();
        useAppStore.setState({
          pendingCount: left,
          lastSavedAt: savedAt,
          lastError: null,
        });
        if (left === 0) break;
      } catch (err) {
        succeeded = false;
        const msg = err instanceof Error ? err.message : '网络请求失败';
        const left = await localDb.pendingMutations.count();
        useAppStore.setState({
          syncStatus: 'offline',
          pendingCount: left,
          lastError: msg,
        });
        scheduleRetry();
        break;
      }
    }
  })();

  try {
    await flushInFlight;
  } finally {
    flushInFlight = null;
  }

  return succeeded;
}

function scheduleRetry() {
  clearRetryTimer();
  const delay = RETRY_DELAYS_MS[Math.min(retryAttempt, RETRY_DELAYS_MS.length - 1)];
  retryAttempt += 1;
  retryTimer = setTimeout(() => {
    void useAppStore.getState().checkHealthAndSync();
  }, delay);
}

async function pullSyncDelta(full = false): Promise<void> {
  const state = useAppStore.getState();
  const since = full ? 0 : state.syncCursor;
  const res = await fetch(`/api/sync?since=${since}`);
  if (res.status === 401) {
    useAppStore.setState({ authState: 'unauthenticated' });
    return;
  }
  if (!res.ok) {
    throw new Error(`同步接口异常 (${res.status})`);
  }
  const data = (await res.json()) as SyncResponse & { runningSessionIds?: string[] };
  if (full) {
    await persistFullSync(data);
  } else {
    await persistDeltaSync(data);
  }

  const snap = await loadLocalSnapshot();
  const savedAt = state.lastSavedAt ?? Date.now();
  await localDb.meta.put({ key: 'lastSavedAt', value: savedAt });
  useAppStore.setState({
    modules: snap.modules,
    tags: snap.tags,
    sessions: snap.sessions,
    todos: snap.todos,
    todoChecks: snap.todoChecks,
    syncCursor: snap.cursor,
    pendingCount: snap.pending.length,
    clockOffsetMs: data.serverTime - Date.now(),
    lastSavedAt: savedAt,
  });
}

async function fetchStatusMeta(): Promise<void> {
  try {
    const res = await fetch('/api/status');
    if (res.ok) {
      const json = (await res.json()) as { backup?: { lastBackupAt?: number | null } };
      useAppStore.setState({ lastBackupAt: json.backup?.lastBackupAt ?? null });
    }
  } catch {
    // 非关键元信息失败忽略
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  activeTab: 'today',
  authState: 'checking',
  syncStatus: 'ok',
  lastSavedAt: null,
  lastError: null,
  errorBanner: null,
  clockOffsetMs: 0,
  syncCursor: 0,
  pendingCount: 0,
  lastBackupAt: null,
  settingsOpen: false,

  modules: [],
  tags: [],
  sessions: [],
  todos: [],
  todoChecks: [],

  setActiveTab: (activeTab) => set({ activeTab }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  dismissErrorBanner: () => set({ errorBanner: null }),
  nowMs: () => Date.now() + get().clockOffsetMs,

  init: async () => {
    const snap = await loadLocalSnapshot();
    set({
      modules: snap.modules,
      tags: snap.tags,
      sessions: snap.sessions,
      todos: snap.todos,
      todoChecks: snap.todoChecks,
      syncCursor: snap.cursor,
      pendingCount: snap.pending.length,
      lastSavedAt: snap.lastSavedAt,
    });

    try {
      const meRes = await fetch('/api/auth/me');
      if (meRes.status === 401) {
        set({ authState: 'unauthenticated' });
        return;
      }
      if (meRes.ok) {
        set({ authState: 'authenticated' });
        await get().checkHealthAndSync();
        void fetchStatusMeta();
        return;
      }
      // 服务端 5xx 时若本地已有数据先进入界面并标为连接断开，避免锁死
      if (snap.modules.length > 0) {
        set({ authState: 'authenticated', syncStatus: 'offline', lastError: `HTTP ${meRes.status}` });
        scheduleRetry();
      } else {
        set({ authState: 'unauthenticated' });
      }
    } catch {
      if (snap.modules.length > 0) {
        set({ authState: 'authenticated', syncStatus: 'offline', lastError: '暂时连不上服务器' });
        scheduleRetry();
      } else {
        set({ authState: 'unauthenticated' });
      }
    }
  },

  login: async (password: string) => {
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        retryAfterSec?: number;
      };
      if (!res.ok) {
        return { ok: false, error: json.error || '登录失败', retryAfterSec: json.retryAfterSec };
      }

      set({ authState: 'authenticated', lastError: null });
      await pullSyncDelta(true);
      await get().checkHealthAndSync();
      void fetchStatusMeta();
      return { ok: true };
    } catch {
      return { ok: false, error: '无法连接服务器，请检查网络或容器状态' };
    }
  },

  logout: async () => {
    clearRetryTimer();
    try {
      await fetch('/api/logout', { method: 'POST' });
    } catch {
      // 忽略网络错误
    }
    await clearAllLocalData();
    set({
      authState: 'unauthenticated',
      settingsOpen: false,
      modules: [],
      tags: [],
      sessions: [],
      todos: [],
      todoChecks: [],
      syncCursor: 0,
      pendingCount: 0,
      lastSavedAt: null,
      lastError: null,
    });
  },

  checkHealthAndSync: async () => {
    if (get().authState !== 'authenticated') return;

    try {
      const hRes = await fetch('/api/health');
      const hBody = (await hRes.json().catch(() => ({}))) as {
        ok?: boolean;
        db?: boolean;
        error?: string;
        serverTime?: number;
      };

      if (hRes.status === 503 || hBody.db === false) {
        set({
          syncStatus: 'db_error',
          lastError: hBody.error || '数据库读写异常，数据可能没有保存',
        });
        scheduleRetry();
        return;
      }

      if (!hRes.ok) {
        throw new Error(`健康检查失败 (${hRes.status})`);
      }

      if (typeof hBody.serverTime === 'number') {
        set({ clockOffsetMs: hBody.serverTime - Date.now() });
      }

      const flushed = await flushPendingQueue();
      if (!flushed) return;

      // 如果本地尚无游标（首次登录），执行全量拉取，否则增量拉取
      await pullSyncDelta(get().syncCursor === 0);

      if ((await localDb.pendingMutations.count()) === 0) {
        set({
          syncStatus: 'ok',
          pendingCount: 0,
          lastError: null,
        });
      }
    } catch (err) {
      const left = await localDb.pendingMutations.count();
      set({
        syncStatus: 'offline',
        pendingCount: left,
        lastError: err instanceof Error ? err.message : '连接服务器失败',
      });
      scheduleRetry();
    }
  },

  retryNow: async () => {
    clearRetryTimer();
    retryAttempt = 0;
    await get().checkHealthAndSync();
  },

  refreshAfterServerAction: async () => {
    await pullSyncDelta(false);
    void fetchStatusMeta();
  },

  enqueueMutation: async (item) => {
    const mutation_id = ulid();
    const now = get().nowMs();
    const patch = applyOptimisticMutation(get(), item, now);

    await localDb.pendingMutations.add({
      mutation_id,
      type: item.type,
      payload: item.payload,
      createdAt: now,
    });

    const pendingCount = await localDb.pendingMutations.count();
    set({ ...patch, pendingCount, syncStatus: 'saving' });

    const ok = await flushPendingQueue();
    if (ok && get().authState === 'authenticated') {
      try {
        await pullSyncDelta(false);
        if ((await localDb.pendingMutations.count()) === 0) {
          set({ syncStatus: 'ok', pendingCount: 0, lastError: null });
        }
      } catch {
        set({ syncStatus: 'offline' });
        scheduleRetry();
      }
    }
  },

  startTimer: async ({ tagId, title, todoId }) => {
    const id = ulid();
    const now = get().nowMs();
    await get().enqueueMutation({
      type: 'session.upsert',
      payload: {
        id,
        tag_id: tagId,
        todo_id: todoId ?? null,
        title: title ?? null,
        start_at: now,
        end_at: null,
        source: 'timer',
        import_batch: null,
        created_at: now,
      },
    });
    return id;
  },

  updateSession: async (session) => {
    await get().enqueueMutation({
      type: 'session.upsert',
      payload: {
        id: session.id,
        tag_id: session.tag_id,
        todo_id: session.todo_id,
        title: session.title,
        start_at: session.start_at,
        end_at: session.end_at,
        source: session.source,
        import_batch: session.import_batch,
        created_at: session.created_at,
      },
    });
  },

  cancelRunningTimer: async (sessionId) => {
    await get().enqueueMutation({
      type: 'session.cancel_running',
      payload: { id: sessionId },
    });
  },

  endTimer: async (sessionId) => {
    const s = get().sessions.find((x) => x.id === sessionId);
    if (!s) return;
    const endAt = Math.max(s.start_at + 1000, get().nowMs());
    await get().enqueueMutation({
      type: 'session.upsert',
      payload: {
        id: s.id,
        tag_id: s.tag_id,
        todo_id: s.todo_id,
        title: s.title,
        start_at: s.start_at,
        end_at: endAt,
        source: s.source,
        import_batch: s.import_batch,
        created_at: s.created_at,
      },
    });
  },

  deleteSession: async (sessionId) => {
    await get().enqueueMutation({
      type: 'session.delete',
      payload: { id: sessionId },
    });
  },

  upsertTodo: async (todo) => {
    await get().enqueueMutation({
      type: 'todo.upsert',
      payload: {
        id: todo.id,
        title: todo.title,
        tag_id: todo.tag_id,
        plan_date: todo.plan_date,
        due_date: todo.due_date,
        recur: todo.recur,
        done_at: todo.done_at,
        sort: todo.sort,
        created_at: todo.created_at,
      },
    });
  },

  deleteTodo: async (todoId) => {
    await get().enqueueMutation({
      type: 'todo.delete',
      payload: { id: todoId },
    });
  },

  toggleTodoDone: async (todo, dateStr, done) => {
    const now = get().nowMs();
    if (todo.recur) {
      await get().enqueueMutation({
        type: 'todo_check.toggle',
        payload: { todo_id: todo.id, date: dateStr, done, done_at: now },
      });
    } else {
      await get().upsertTodo({
        ...todo,
        done_at: done ? now : null,
      });
    }
  },

  upsertModule: async (mod) => {
    await get().enqueueMutation({
      type: 'module.upsert',
      payload: {
        id: mod.id,
        name: mod.name,
        color_key: mod.color_key as ColorKey,
        sort: mod.sort,
        created_at: mod.created_at,
      },
    });
  },

  deleteModule: async (id, mode, targetModuleId) => {
    await get().enqueueMutation({
      type: 'module.delete',
      payload: { id, mode, targetModuleId },
    });
  },

  upsertTag: async (tag) => {
    await get().enqueueMutation({
      type: 'tag.upsert',
      payload: {
        id: tag.id,
        module_id: tag.module_id,
        name: tag.name,
        sort: tag.sort,
        created_at: tag.created_at,
      },
    });
  },

  deleteTag: async (id, mode, targetTagId) => {
    await get().enqueueMutation({
      type: 'tag.delete',
      payload: { id, mode, targetTagId },
    });
  },
}));
