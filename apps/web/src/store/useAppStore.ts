import { create } from 'zustand';
import { ulid } from 'ulid';
import {
  dedupeDuplicateModules,
  ensureSingleDefaultModulesSeed,
  planLocalToRemoteMerge,
  type ColorKey,
  type ModuleEntity,
  type MutationItem,
  type SessionEntity,
  type SyncResponse,
  type TagEntity,
  type TodoCheckEntity,
  type TodoEntity,
} from '@timebook/core';
import {
  clearAllLocalData,
  loadLocalSnapshot,
  localDb,
  persistDeltaSync,
  persistFullSync,
  type PendingMutationRecord,
} from '../db/dexie.js';
import {
  DEFAULT_DESKTOP_CONFIG,
  desktopBridge,
  getDesktopWindowKind,
  isDesktopEnvironment,
  type DesktopConfig,
  type FastStateBroadcastPayload,
  type LocalSnapshotFile,
} from '../lib/desktopBridge.js';
import { buildTagLookup, formatSessionDisplayTitle } from '../lib/labels.js';

export type NavTab = 'today' | 'calendar' | 'history' | 'stats' | 'tags';
export type AuthState = 'checking' | 'unauthenticated' | 'authenticated';
export type SyncStatus = 'ok' | 'saving' | 'offline' | 'db_error';

const RETRY_DELAYS_MS = [2000, 5000, 15000, 30000];

export function normalizeServerUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

export function getApiUrl(path: string): string {
  const state = useAppStore.getState();
  if (state.isDesktop && state.desktopConfig?.connectionMode === 'nas') {
    const base = normalizeServerUrl(state.desktopConfig.serverUrl);
    if (base) return `${base}${path}`;
  }
  return path;
}

export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const state = useAppStore.getState();
  const headers = new Headers(init.headers);
  if (state.isDesktop && state.desktopConfig?.connectionMode === 'nas') {
    const token = state.desktopConfig.sessionToken;
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }
  return fetch(getApiUrl(path), {
    ...init,
    headers,
  });
}

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

  isDesktop: boolean;
  desktopConfig: DesktopConfig | null;
  desktopDataDir: string | null;

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

  syncFromBridgeUpdate: () => Promise<void>;
  applyFastRunningFromBridge: (payload?: FastStateBroadcastPayload) => void;
  applyConfigFromBridge: (config: DesktopConfig) => void;
  updateDesktopConfig: (patch: Partial<DesktopConfig>) => Promise<{ ok: boolean; error?: string }>;
  runDesktopBackup: () => Promise<{ ok: boolean; path?: string; error?: string }>;
  connectToNas: (
    serverUrl: string,
    password: string,
  ) => Promise<{ ok: boolean; error?: string; mergedCount?: number }>;
  switchToLocalMode: () => Promise<void>;

  enqueueMutation: (item: { type: MutationItem['type']; payload: unknown }) => Promise<void>;

  startTimer: (opts: { tagId: string | null; title: string | null; todoId?: string | null }) => Promise<string>;
  updateSession: (session: SessionEntity) => Promise<void>;
  batchUpdateSessions: (
    ids: string[],
    patch: { tag_id?: string | null; title?: string | null },
  ) => Promise<void>;
  batchDeleteSessions: (ids: string[]) => Promise<void>;
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

function buildLocalSnapshotFile(state: Pick<AppState, 'modules' | 'tags' | 'sessions' | 'todos' | 'todoChecks'>): LocalSnapshotFile {
  return {
    version: 1,
    savedAt: Date.now(),
    modules: state.modules,
    tags: state.tags,
    sessions: state.sessions,
    todos: state.todos,
    todoChecks: state.todoChecks,
  };
}

function emitFastRunningBroadcast(wakeWidgetIfRunning = false): void {
  const state = useAppStore.getState();
  if (!state.isDesktop) return;
  const runningSessions = state.sessions
    .filter((s) => s.deleted_at === null && s.end_at === null)
    .sort((a, b) => a.start_at - b.start_at);
  void desktopBridge
    .broadcastState(getDesktopWindowKind(), {
      runningSessions,
      clockOffsetMs: state.clockOffsetMs,
    })
    .catch(() => undefined);
  if (wakeWidgetIfRunning && runningSessions.length > 0 && state.desktopConfig?.widgetVisible) {
    void desktopBridge.setWidgetVisibility(true).catch(() => undefined);
  }
}

async function persistDesktopDiskAndTray(opts?: { broadcast?: boolean; wakeWidgetIfRunning?: boolean }): Promise<void> {
  const state = useAppStore.getState();
  if (!state.isDesktop) return;

  const snap = buildLocalSnapshotFile(state);
  try {
    const res = await desktopBridge.saveSnapshot(snap);
    if (state.desktopConfig && res.lastLocalBackupDate !== state.desktopConfig.lastLocalBackupDate) {
      useAppStore.setState({
        desktopConfig: {
          ...state.desktopConfig,
          lastLocalBackupDate: res.lastLocalBackupDate,
        },
      });
    }
  } catch {
    // 忽略瞬时落盘报错
  }

  const lookup = buildTagLookup(state.modules, state.tags);
  const runningSessions = state.sessions
    .filter((s) => s.deleted_at === null && s.end_at === null)
    .sort((a, b) => a.start_at - b.start_at);

  const running = runningSessions.map((s) => ({
    id: s.id,
    title: formatSessionDisplayTitle(s, lookup),
  }));

  // 按最近使用时间提取最多 5 个未删常用事项，不足则从 activeTags 补齐
  const recentTagIds: string[] = [];
  const seen = new Set<string>();
  const recentSessions = state.sessions
    .filter((s) => s.deleted_at === null && s.tag_id !== null)
    .sort((a, b) => b.start_at - a.start_at);

  for (const s of recentSessions) {
    if (!s.tag_id || seen.has(s.tag_id) || !lookup.tagById.has(s.tag_id)) continue;
    seen.add(s.tag_id);
    recentTagIds.push(s.tag_id);
    if (recentTagIds.length >= 5) break;
  }
  if (recentTagIds.length < 5) {
    for (const tag of lookup.activeTags) {
      if (seen.has(tag.id)) continue;
      seen.add(tag.id);
      recentTagIds.push(tag.id);
      if (recentTagIds.length >= 5) break;
    }
  }

  const recentTags = recentTagIds.map((id) => {
    const tag = lookup.tagById.get(id)!;
    const mod = lookup.moduleById.get(tag.module_id);
    return {
      id,
      label: mod ? `${mod.name} · ${tag.name}` : tag.name,
    };
  });

  const cfg = useAppStore.getState().desktopConfig;
  if (cfg) {
    await desktopBridge
      .syncTray({
        modeLabel: cfg.connectionMode === 'nas' ? 'NAS 同步' : '单机模式',
        running,
        recentTags,
        widgetVisible: cfg.widgetVisible,
      })
      .catch(() => undefined);

    if (cfg.widgetVisible) {
      if (cfg.autoHideWidgetWhenIdle) {
        await desktopBridge.setWidgetVisibility(running.length > 0).catch(() => undefined);
      } else if (opts?.wakeWidgetIfRunning && running.length > 0) {
        await desktopBridge.setWidgetVisibility(true).catch(() => undefined);
      }
    }
  }

  if (opts?.broadcast) {
    await desktopBridge
      .broadcastState(getDesktopWindowKind(), {
        runningSessions,
        clockOffsetMs: state.clockOffsetMs,
      })
      .catch(() => undefined);
  }
}

function applyOptimisticMutation(
  state: AppState,
  item: { type: MutationItem['type']; payload: unknown },
  now: number,
): { patch: Partial<AppState>; dbTasks: Promise<unknown>[] } {
  const payload = item.payload as Record<string, unknown>;
  const dbTasks: Promise<unknown>[] = [];

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
      dbTasks.push(localDb.modules.put(nextItem));
      return { patch: { modules }, dbTasks };
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
        tags = tags.map((t) => {
          if (t.module_id !== id || t.deleted_at !== null) return t;
          const dupId = targetExistingByName.get(t.name);
          if (dupId) {
            remapTagId.set(t.id, dupId);
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
      dbTasks.push(
        localDb.modules.bulkPut(modules),
        localDb.tags.bulkPut(tags),
        localDb.sessions.bulkPut(sessions),
        localDb.todos.bulkPut(todos),
      );
      return { patch: { modules, tags, sessions, todos }, dbTasks };
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
      dbTasks.push(localDb.tags.put(nextTag));
      return { patch: { tags }, dbTasks };
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
      dbTasks.push(
        localDb.tags.bulkPut(tags),
        localDb.sessions.bulkPut(sessions),
        localDb.todos.bulkPut(todos),
      );
      return { patch: { tags, sessions, todos }, dbTasks };
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
      dbTasks.push(localDb.sessions.put(nextSess));
      return { patch: { sessions }, dbTasks };
    }
    case 'session.cancel_running': {
      const id = payload.id as string;
      const sessions = state.sessions.filter((s) => s.id !== id);
      dbTasks.push(localDb.sessions.delete(id));
      return { patch: { sessions }, dbTasks };
    }
    case 'session.delete': {
      const id = payload.id as string;
      const sessions = state.sessions.map((s) =>
        s.id === id ? { ...s, deleted_at: now, updated_at: now } : s,
      );
      const target = sessions.find((s) => s.id === id);
      if (target) dbTasks.push(localDb.sessions.put(target));
      return { patch: { sessions }, dbTasks };
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
      dbTasks.push(localDb.todos.put(nextTodo));
      return { patch: { todos }, dbTasks };
    }
    case 'todo.delete': {
      const id = payload.id as string;
      const todos = state.todos.map((td) =>
        td.id === id ? { ...td, deleted_at: now, updated_at: now } : td,
      );
      const target = todos.find((td) => td.id === id);
      if (target) dbTasks.push(localDb.todos.put(target));
      return { patch: { todos }, dbTasks };
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
      dbTasks.push(localDb.todoChecks.put(check));
      return { patch: { todoChecks }, dbTasks };
    }
  }
  return { patch: {}, dbTasks };
}

async function flushPendingQueue(): Promise<boolean> {
  const st = useAppStore.getState();
  if (st.isDesktop && st.desktopConfig?.connectionMode === 'local') {
    return true;
  }

  if (flushInFlight) {
    await flushInFlight;
    return (await localDb.pendingMutations.count()) === 0;
  }

  let succeeded = true;
  flushInFlight = (async () => {
    while (true) {
      const batch: PendingMutationRecord[] = await localDb.pendingMutations
        .orderBy('seq')
        .limit(300)
        .toArray();
      if (batch.length === 0) break;

      useAppStore.setState({ syncStatus: 'saving', pendingCount: batch.length });

      try {
        const res = await apiFetch('/api/mutations', {
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
          if (!useAppStore.getState().isDesktop) {
            useAppStore.setState({ authState: 'unauthenticated' });
          } else {
            useAppStore.setState({
              syncStatus: 'offline',
              lastError: 'NAS 会话已过期，请在设置中重新验证口令',
            });
          }
          succeeded = false;
          break;
        }

        if (res.status === 400 || res.status === 409) {
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
  const st = useAppStore.getState();
  if (st.isDesktop && st.desktopConfig?.connectionMode === 'local') return;
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
  const res = await apiFetch(`/api/sync?since=${since}`);
  if (res.status === 401) {
    if (!state.isDesktop) {
      useAppStore.setState({ authState: 'unauthenticated' });
    } else {
      useAppStore.setState({
        syncStatus: 'offline',
        lastError: 'NAS 会话已过期，请在设置中重新连接验证',
      });
    }
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
  const savedAt = Date.now();
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

  if (state.isDesktop) {
    await persistDesktopDiskAndTray({ broadcast: true });
  }
}

async function fetchStatusMeta(): Promise<void> {
  try {
    const res = await apiFetch('/api/status');
    if (res.ok) {
      const json = (await res.json()) as { backup?: { lastBackupAt?: number | null } };
      useAppStore.setState({ lastBackupAt: json.backup?.lastBackupAt ?? null });
    }
  } catch {
    // 非关键元信息失败忽略
  }
}

async function commitSessionBatch(
  nextSessions: SessionEntity[],
  changedSessions: SessionEntity[],
  pendingItems: PendingMutationRecord[],
  set: (partial: Partial<AppState>) => void,
  get: () => AppState,
): Promise<void> {
  const isLocalDesktop =
    get().isDesktop && get().desktopConfig?.connectionMode === 'local';

  if (isLocalDesktop) {
    const savedAt = Date.now();
    set({
      sessions: nextSessions,
      pendingCount: 0,
      syncStatus: 'ok',
      lastSavedAt: savedAt,
      lastError: null,
    });
    emitFastRunningBroadcast(false);
    await Promise.all([
      localDb.sessions.bulkPut(changedSessions),
      localDb.meta.put({ key: 'lastSavedAt', value: savedAt }),
    ]);
    await persistDesktopDiskAndTray({ broadcast: true });
    return;
  }

  set({
    sessions: nextSessions,
    pendingCount: get().pendingCount + pendingItems.length,
    syncStatus: 'saving',
  });
  emitFastRunningBroadcast(false);

  await Promise.all([
    localDb.sessions.bulkPut(changedSessions),
    localDb.pendingMutations.bulkAdd(pendingItems),
  ]);

  const pendingCount = await localDb.pendingMutations.count();
  set({ pendingCount });

  if (get().isDesktop) {
    await persistDesktopDiskAndTray({ broadcast: true });
  }

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

  isDesktop: isDesktopEnvironment(),
  desktopConfig: null,
  desktopDataDir: null,

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
    const isDesktop = isDesktopEnvironment();
    let snap = await loadLocalSnapshot();

    if (isDesktop) {
      const windowKind = getDesktopWindowKind();
      try {
        const initRes = await desktopBridge.getInitState();
        set({
          isDesktop: true,
          desktopConfig: initRes.config,
          desktopDataDir: initRes.dataDir,
        });

        if (windowKind === 'main') {
          // 仅主窗口在原子事务内负责恢复快照、清洗存量重复模块或生成默认四模块种子
          await localDb.transaction(
            'rw',
            [localDb.modules, localDb.tags, localDb.sessions, localDb.todos, localDb.todoChecks, localDb.meta],
            async () => {
              const existingCount = await localDb.modules.count();
              if (existingCount === 0) {
                if (initRes.snapshot && initRes.snapshot.modules.length > 0) {
                  const cleaned = dedupeDuplicateModules(
                    initRes.snapshot.modules,
                    initRes.snapshot.tags ?? [],
                  );
                  await localDb.modules.bulkPut(cleaned.modules);
                  if (cleaned.tags.length) await localDb.tags.bulkPut(cleaned.tags);
                  if (initRes.snapshot.sessions?.length) await localDb.sessions.bulkPut(initRes.snapshot.sessions);
                  if (initRes.snapshot.todos?.length) await localDb.todos.bulkPut(initRes.snapshot.todos);
                  if (initRes.snapshot.todoChecks?.length) await localDb.todoChecks.bulkPut(initRes.snapshot.todoChecks);
                  await localDb.meta.put({ key: 'lastSavedAt', value: initRes.snapshot.savedAt || Date.now() });
                } else {
                  const seedMods = ensureSingleDefaultModulesSeed([], 'main', Date.now());
                  if (seedMods) {
                    await localDb.modules.bulkPut(seedMods);
                    await localDb.meta.put({ key: 'lastSavedAt', value: Date.now() });
                  }
                }
              } else {
                const curMods = await localDb.modules.toArray();
                const curTags = await localDb.tags.toArray();
                const cleaned = dedupeDuplicateModules(curMods, curTags);
                if (cleaned.deduped) {
                  await localDb.modules.clear();
                  if (cleaned.modules.length) await localDb.modules.bulkPut(cleaned.modules);
                  if (cleaned.tags.length) await localDb.tags.bulkPut(cleaned.tags);
                }
              }
            },
          );
          snap = await loadLocalSnapshot();

          set({
            modules: snap.modules,
            tags: snap.tags,
            sessions: snap.sessions,
            todos: snap.todos,
            todoChecks: snap.todoChecks,
            syncCursor: snap.cursor,
            pendingCount: snap.pending.length,
            lastSavedAt: snap.lastSavedAt ?? Date.now(),
            authState: 'authenticated',
          });

          await persistDesktopDiskAndTray({ broadcast: true });

          if (initRes.config.connectionMode === 'nas' && initRes.config.serverUrl) {
            await get().checkHealthAndSync();
            void fetchStatusMeta();
          } else {
            set({ syncStatus: 'ok', pendingCount: 0, lastError: null });
          }
        } else {
          // 轻量辅助窗口（widget / launcher）只读加载现状，严禁向空库生成种子或覆盖落盘
          const fallbackSnap = snap.modules.length > 0 ? snap : initRes.snapshot;
          const cleaned = dedupeDuplicateModules(
            fallbackSnap?.modules ?? [],
            fallbackSnap?.tags ?? [],
          );
          set({
            modules: cleaned.modules,
            tags: cleaned.tags,
            sessions: fallbackSnap?.sessions ?? [],
            todos: fallbackSnap?.todos ?? [],
            todoChecks: fallbackSnap?.todoChecks ?? [],
            syncCursor: snap.cursor,
            pendingCount: snap.pending.length,
            lastSavedAt: snap.lastSavedAt ?? initRes.snapshot?.savedAt ?? Date.now(),
            authState: 'authenticated',
            syncStatus: 'ok',
          });
        }
      } catch (err) {
        // 任何桌面初始化异常都必须兜底进入主页，绝不允许永久停留在 checking 加载页
        const fallbackMods =
          snap.modules.length > 0
            ? dedupeDuplicateModules(snap.modules, snap.tags).modules
            : (ensureSingleDefaultModulesSeed([], 'main', Date.now()) ?? []);
        const fallbackTags =
          snap.modules.length > 0
            ? dedupeDuplicateModules(snap.modules, snap.tags).tags
            : snap.tags;
        const errMsg = err instanceof Error ? err.message : String(err);
        set({
          isDesktop: true,
          desktopConfig: get().desktopConfig ?? { ...DEFAULT_DESKTOP_CONFIG },
          modules: fallbackMods,
          tags: fallbackTags,
          sessions: snap.sessions,
          todos: snap.todos,
          todoChecks: snap.todoChecks,
          syncCursor: snap.cursor,
          pendingCount: snap.pending.length,
          lastSavedAt: snap.lastSavedAt ?? Date.now(),
          authState: 'authenticated',
          syncStatus: 'ok',
          errorBanner: windowKind === 'main' ? `桌面初始化已自动切换兜底模式：${errMsg}` : null,
        });
      }
      return;
    }

    // 普通网页版与 PWA 流程（100% 保持原样）
    set({
      isDesktop: false,
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
      await apiFetch('/api/logout', { method: 'POST' });
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
    if (get().isDesktop && get().desktopConfig?.connectionMode === 'local') {
      set({ syncStatus: 'ok', pendingCount: 0, lastError: null });
      return;
    }

    try {
      const hRes = await apiFetch('/api/health');
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

  syncFromBridgeUpdate: async () => {
    if (!get().isDesktop) return;
    const snap = await loadLocalSnapshot();
    if (snap.modules.length === 0) {
      const initRes = await desktopBridge.getInitState();
      if (initRes.snapshot && initRes.snapshot.modules.length > 0) {
        set({
          modules: initRes.snapshot.modules,
          tags: initRes.snapshot.tags ?? [],
          sessions: initRes.snapshot.sessions ?? [],
          todos: initRes.snapshot.todos ?? [],
          todoChecks: initRes.snapshot.todoChecks ?? [],
          lastSavedAt: initRes.snapshot.savedAt ?? get().lastSavedAt,
        });
        return;
      }
    }
    set({
      modules: snap.modules,
      tags: snap.tags,
      sessions: snap.sessions,
      todos: snap.todos,
      todoChecks: snap.todoChecks,
      syncCursor: snap.cursor,
      pendingCount: snap.pending.length,
      lastSavedAt: snap.lastSavedAt ?? get().lastSavedAt,
    });
  },

  applyFastRunningFromBridge: (payload) => {
    if (!get().isDesktop) return;
    if (payload?.runningSessions) {
      const incoming = payload.runningSessions;
      const incomingIds = new Set(incoming.map((r) => r.id));
      const nonRunning = get().sessions.filter(
        (s) => (s.deleted_at !== null || s.end_at !== null) && !incomingIds.has(s.id),
      );
      set({
        sessions: [...nonRunning, ...incoming],
        ...(typeof payload.clockOffsetMs === 'number'
          ? { clockOffsetMs: payload.clockOffsetMs }
          : {}),
      });
    }
    void get().syncFromBridgeUpdate();
  },

  applyConfigFromBridge: (config: DesktopConfig) => {
    set({ desktopConfig: config });
  },

  updateDesktopConfig: async (patch) => {
    const current = get().desktopConfig;
    if (!current) return { ok: false, error: '当前非桌面端环境' };
    const nextCfg: DesktopConfig = { ...current, ...patch };
    try {
      const saved = await desktopBridge.saveConfig(nextCfg);
      set({ desktopConfig: saved });
      await persistDesktopDiskAndTray({ broadcast: false });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  runDesktopBackup: async () => {
    try {
      const res = await desktopBridge.runLocalBackup();
      const cfg = get().desktopConfig;
      if (cfg) {
        set({ desktopConfig: { ...cfg, lastLocalBackupDate: res.date } });
      }
      return { ok: true, path: res.path };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  connectToNas: async (rawUrl: string, password: string) => {
    const serverUrl = normalizeServerUrl(rawUrl);
    if (!serverUrl) {
      return { ok: false, error: '请先填写 NAS 服务地址' };
    }
    if (!password) {
      return { ok: false, error: '请填写访问口令' };
    }

    try {
      const loginRes = await fetch(`${serverUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const loginJson = (await loginRes.json().catch(() => ({}))) as {
        ok?: boolean;
        token?: string;
        error?: string;
      };
      if (!loginRes.ok || !loginJson.token) {
        return { ok: false, error: loginJson.error || `登录失败 (${loginRes.status})` };
      }
      const token = loginJson.token;

      // 1. 拉取远端现有全量数据
      const sync0Res = await fetch(`${serverUrl}/api/sync?since=0`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!sync0Res.ok) {
        return { ok: false, error: `拉取远端数据失败 (${sync0Res.status})` };
      }
      const remoteData = (await sync0Res.json()) as SyncResponse;

      // 2. 规划单机数据无损合并与默认四模块去重
      const st = get();
      const plan = planLocalToRemoteMerge(
        {
          modules: st.modules,
          tags: st.tags,
          sessions: st.sessions,
          todos: st.todos,
          todoChecks: st.todoChecks,
        },
        {
          modules: remoteData.modules,
          tags: remoteData.tags,
          sessions: remoteData.sessions,
          todos: remoteData.todos,
          todoChecks: remoteData.todoChecks,
        },
      );

      // 3. 分批幂等提交合并项至 NAS
      const chunkSize = 200;
      for (let i = 0; i < plan.mutationsToPush.length; i += chunkSize) {
        const chunk = plan.mutationsToPush.slice(i, i + chunkSize);
        const mutRes = await fetch(`${serverUrl}/api/mutations`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ mutations: chunk }),
        });
        if (!mutRes.ok) {
          const errJson = (await mutRes.json().catch(() => ({}))) as { error?: string };
          return { ok: false, error: errJson.error || `合并写入服务端失败 (${mutRes.status})` };
        }
      }

      // 4. 清空旧队列，重新全量拉取服务端权威状态落入 Dexie 与本地 JSON
      await localDb.pendingMutations.clear();
      const syncFinalRes = await fetch(`${serverUrl}/api/sync?since=0`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!syncFinalRes.ok) {
        return { ok: false, error: `同步最终状态失败 (${syncFinalRes.status})` };
      }
      const finalData = (await syncFinalRes.json()) as SyncResponse & { runningSessionIds?: string[] };
      await persistFullSync(finalData);
      const savedAt = Date.now();
      await localDb.meta.put({ key: 'lastSavedAt', value: savedAt });

      const currentCfg = get().desktopConfig;
      if (currentCfg) {
        const savedCfg = await desktopBridge.saveConfig({
          ...currentCfg,
          connectionMode: 'nas',
          serverUrl,
          sessionToken: token,
        });
        set({ desktopConfig: savedCfg });
      }

      const snap = await loadLocalSnapshot();
      set({
        modules: snap.modules,
        tags: snap.tags,
        sessions: snap.sessions,
        todos: snap.todos,
        todoChecks: snap.todoChecks,
        syncCursor: snap.cursor,
        pendingCount: 0,
        clockOffsetMs: finalData.serverTime - Date.now(),
        lastSavedAt: savedAt,
        syncStatus: 'ok',
        lastError: null,
      });

      await persistDesktopDiskAndTray({ broadcast: true });
      void fetchStatusMeta();
      return { ok: true, mergedCount: plan.mutationsToPush.length };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : '连接 NAS 失败，请确认地址和网络连通性',
      };
    }
  },

  switchToLocalMode: async () => {
    clearRetryTimer();
    const cfg = get().desktopConfig;
    if (!cfg) return;
    await localDb.pendingMutations.clear();
    const savedCfg = await desktopBridge.saveConfig({
      ...cfg,
      connectionMode: 'local',
    });
    set({
      desktopConfig: savedCfg,
      syncStatus: 'ok',
      pendingCount: 0,
      lastError: null,
    });
    await persistDesktopDiskAndTray({ broadcast: true });
  },

  enqueueMutation: async (item) => {
    const mutation_id = ulid();
    const now = get().nowMs();
    const { patch, dbTasks } = applyOptimisticMutation(get(), item, now);
    const isLocalDesktop =
      get().isDesktop && get().desktopConfig?.connectionMode === 'local';
    const wakeWidget = item.type === 'session.upsert';

    if (isLocalDesktop) {
      const savedAt = Date.now();
      set({ ...patch, pendingCount: 0, syncStatus: 'ok', lastSavedAt: savedAt, lastError: null });
      emitFastRunningBroadcast(wakeWidget);
      await Promise.all([
        ...dbTasks,
        localDb.meta.put({ key: 'lastSavedAt', value: savedAt }),
      ]);
      await persistDesktopDiskAndTray({
        broadcast: true,
        wakeWidgetIfRunning: wakeWidget,
      });
      return;
    }

    set({ ...patch, pendingCount: get().pendingCount + 1, syncStatus: 'saving' });
    emitFastRunningBroadcast(wakeWidget);

    await Promise.all([
      ...dbTasks,
      localDb.pendingMutations.add({
        mutation_id,
        type: item.type,
        payload: item.payload,
        createdAt: now,
      }),
    ]);

    const pendingCount = await localDb.pendingMutations.count();
    set({ pendingCount });

    if (get().isDesktop) {
      await persistDesktopDiskAndTray({
        broadcast: true,
        wakeWidgetIfRunning: wakeWidget,
      });
    }

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

  batchUpdateSessions: async (ids, patch) => {
    const idSet = new Set(ids);
    if (idSet.size === 0) return;
    const hasTagPatch = 'tag_id' in patch;
    const hasTitlePatch = 'title' in patch;
    if (!hasTagPatch && !hasTitlePatch) return;

    const now = get().nowMs();
    const updatedSessions: SessionEntity[] = [];
    const pendingItems: PendingMutationRecord[] = [];
    const nextSessions = get().sessions.map((s) => {
      if (!idSet.has(s.id) || s.deleted_at !== null || s.end_at === null) return s;
      const updated: SessionEntity = {
        ...s,
        tag_id: hasTagPatch ? (patch.tag_id ?? null) : s.tag_id,
        title: hasTitlePatch ? (patch.title ?? null) : s.title,
        updated_at: now,
      };
      updatedSessions.push(updated);
      pendingItems.push({
        mutation_id: ulid(),
        type: 'session.upsert',
        payload: {
          id: updated.id,
          tag_id: updated.tag_id,
          todo_id: updated.todo_id,
          title: updated.title,
          start_at: updated.start_at,
          end_at: updated.end_at,
          source: updated.source,
          import_batch: updated.import_batch,
          created_at: updated.created_at,
        },
        createdAt: now,
      });
      return updated;
    });

    if (updatedSessions.length === 0) return;
    await commitSessionBatch(nextSessions, updatedSessions, pendingItems, set, get);
  },

  batchDeleteSessions: async (ids) => {
    const idSet = new Set(ids);
    if (idSet.size === 0) return;

    const now = get().nowMs();
    const deletedSessions: SessionEntity[] = [];
    const pendingItems: PendingMutationRecord[] = [];
    const nextSessions = get().sessions.map((s) => {
      if (!idSet.has(s.id) || s.deleted_at !== null || s.end_at === null) return s;
      const updated: SessionEntity = {
        ...s,
        deleted_at: now,
        updated_at: now,
      };
      deletedSessions.push(updated);
      pendingItems.push({
        mutation_id: ulid(),
        type: 'session.delete',
        payload: { id: updated.id },
        createdAt: now,
      });
      return updated;
    });

    if (deletedSessions.length === 0) return;
    await commitSessionBatch(nextSessions, deletedSessions, pendingItems, set, get);
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
