import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModuleEntity, TagEntity } from '@timebook/core';

const callOrder: string[] = [];

const memTables = {
  modules: [] as ModuleEntity[],
  tags: [] as TagEntity[],
  pending: [] as Array<{ seq: number; mutation_id: string; type: string; payload: unknown; createdAt: number }>,
  cursor: 10,
  lastSavedAt: null as number | null,
};
let seqCounter = 1;

vi.mock('../src/db/dexie.js', () => ({
  localDb: {
    modules: { put: vi.fn(async () => undefined), bulkPut: vi.fn(async () => undefined) },
    tags: {
      put: vi.fn(async (tag: TagEntity) => {
        callOrder.push('db.tags.put:start');
        await Promise.resolve();
        callOrder.push('db.tags.put:resolved');
        const idx = memTables.tags.findIndex((t) => t.id === tag.id);
        if (idx >= 0) memTables.tags[idx] = tag;
        else memTables.tags.push(tag);
      }),
      bulkPut: vi.fn(async () => undefined),
    },
    sessions: {
      put: vi.fn(async () => {
        callOrder.push('db.sessions.put:start');
        await Promise.resolve();
        callOrder.push('db.sessions.put:resolved');
      }),
      bulkPut: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    },
    todos: { put: vi.fn(async () => undefined), bulkPut: vi.fn(async () => undefined) },
    todoChecks: { put: vi.fn(async () => undefined) },
    pendingMutations: {
      add: vi.fn(async (rec: { mutation_id: string; type: string; payload: unknown; createdAt: number }) => {
        callOrder.push('db.pendingMutations.add');
        memTables.pending.push({ seq: seqCounter++, ...rec });
      }),
      count: vi.fn(async () => memTables.pending.length),
      orderBy: vi.fn(() => ({
        limit: () => ({
          toArray: async () => [...memTables.pending],
        }),
      })),
      bulkDelete: vi.fn(async (seqs: number[]) => {
        const set = new Set(seqs);
        memTables.pending = memTables.pending.filter((p) => !set.has(p.seq));
      }),
      clear: vi.fn(async () => {
        memTables.pending = [];
      }),
    },
    meta: {
      put: vi.fn(async ({ key, value }: { key: string; value: unknown }) => {
        if (key === 'lastSavedAt') memTables.lastSavedAt = value as number;
        if (key === 'syncCursor') memTables.cursor = value as number;
      }),
    },
  },
  loadLocalSnapshot: vi.fn(async () => ({
    cursor: memTables.cursor,
    lastSavedAt: memTables.lastSavedAt,
    modules: memTables.modules,
    tags: memTables.tags.map((t) => ({ ...t, disabled_at: t.disabled_at ?? null })),
    sessions: [],
    todos: [],
    todoChecks: [],
    pending: memTables.pending,
  })),
  persistFullSync: vi.fn(async (data: { tags?: TagEntity[]; cursor: number }) => {
    if (data.tags) memTables.tags = data.tags;
    memTables.cursor = data.cursor;
  }),
  persistDeltaSync: vi.fn(async (data: { tags?: TagEntity[]; cursor: number }) => {
    if (data.tags?.length) {
      for (const t of data.tags) {
        const idx = memTables.tags.findIndex((x) => x.id === t.id);
        if (idx >= 0) memTables.tags[idx] = t;
        else memTables.tags.push(t);
      }
    }
    memTables.cursor = data.cursor;
  }),
  clearAllLocalData: vi.fn(async () => undefined),
}));

vi.mock('../src/lib/desktopBridge.js', () => ({
  DEFAULT_DESKTOP_CONFIG: {
    connectionMode: 'local',
    serverUrl: '',
    sessionToken: '',
    backupDir: '',
    widgetVisible: true,
    widgetSkin: 'light',
    autoHideWidgetWhenIdle: false,
    closeToTray: true,
    autostart: false,
    globalShortcut: 'CommandOrControl+Alt+T',
    lastLocalBackupDate: null,
  },
  isDesktopEnvironment: () => false,
  getDesktopWindowKind: () => 'main',
  desktopBridge: {
    saveSnapshot: vi.fn(async () => ({ lastLocalBackupDate: '2026-11-22' })),
    syncTray: vi.fn(async () => undefined),
    setWidgetVisibility: vi.fn(async () => undefined),
    broadcastState: vi.fn(async () => {
      callOrder.push('bridge.broadcastState');
    }),
  },
}));

import { useAppStore } from '../src/store/useAppStore.js';

const BASE_MODULE: ModuleEntity = {
  id: 'm1',
  name: '工作',
  color_key: 'blue',
  sort: 0,
  created_at: 1000,
  updated_at: 1000,
  deleted_at: null,
};

const BASE_TAG: TagEntity = {
  id: 't1',
  module_id: 'm1',
  name: '个人工作',
  sort: 0,
  created_at: 1000,
  updated_at: 1000,
  deleted_at: null,
  disabled_at: null,
};

describe('useAppStore v0.2.2 tag disable & sync resilience', () => {
  beforeEach(() => {
    callOrder.length = 0;
    memTables.modules = [BASE_MODULE];
    memTables.tags = [{ ...BASE_TAG }];
    memTables.pending = [];
    memTables.cursor = 10;
    memTables.lastSavedAt = null;
    seqCounter = 1;
    useAppStore.setState({
      authState: 'authenticated',
      isDesktop: false,
      desktopConfig: null,
      clockOffsetMs: 0,
      syncCursor: 10,
      pendingCount: 0,
      errorBanner: null,
      lastError: null,
      modules: [BASE_MODULE],
      tags: [{ ...BASE_TAG }],
      sessions: [],
      todos: [],
      todoChecks: [],
    });
  });

  it('truncates disabled_at to integer even with fractional clockOffsetMs and clears banner on valid v0.2.2 sync', async () => {
    useAppStore.setState({ clockOffsetMs: 123.87 });
    let capturedDisabledAt: unknown = null;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/mutations') {
          const body = JSON.parse(String(init?.body)) as {
            mutations: Array<{ payload: { disabled_at?: unknown } }>;
          };
          capturedDisabledAt = body.mutations[0].payload.disabled_at;
          return new Response(
            JSON.stringify({ ok: true, cursor: 11, serverTime: 2000, appliedCount: 1 }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (url.startsWith('/api/sync')) {
          return new Response(
            JSON.stringify({
              cursor: 11,
              serverTime: 2000,
              modules: [],
              tags: [
                {
                  ...BASE_TAG,
                  updated_at: 11,
                  disabled_at: capturedDisabledAt,
                },
              ],
              sessions: [],
              todos: [],
              todoChecks: [],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response('{}', { status: 404 });
      }),
    );

    await useAppStore.getState().setTagDisabled('t1', true);
    expect(Number.isInteger(capturedDisabledAt)).toBe(true);
    expect(useAppStore.getState().tags[0].disabled_at).toBe(capturedDisabledAt);
    expect(useAppStore.getState().errorBanner).toBeNull();

    // 重新启用时服务端返回 disabled_at: null，绝不误报警
    await useAppStore.getState().setTagDisabled('t1', false);
    expect(useAppStore.getState().tags[0].disabled_at).toBeNull();
    expect(useAppStore.getState().errorBanner).toBeNull();
  });

  it('shows Chinese upgrade banner when legacy server omits disabled_at or returns null on disable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/mutations') {
          return new Response(
            JSON.stringify({ ok: true, cursor: 11, serverTime: 2000, appliedCount: 1 }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (url.startsWith('/api/sync')) {
          // 模拟旧版服务端返回不含 disabled_at 键的 tag
          return new Response(
            JSON.stringify({
              cursor: 11,
              serverTime: 2000,
              modules: [],
              tags: [
                {
                  id: 't1',
                  module_id: 'm1',
                  name: '个人工作',
                  sort: 0,
                  created_at: 1000,
                  updated_at: 11,
                  deleted_at: null,
                },
              ],
              sessions: [],
              todos: [],
              todoChecks: [],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response('{}', { status: 404 });
      }),
    );

    await useAppStore.getState().setTagDisabled('t1', true);
    expect(useAppStore.getState().errorBanner).toContain('NAS');
    expect(useAppStore.getState().errorBanner).toContain('v0.2.2+');
  });

  it('prevents concurrent background pullSyncDelta from overwriting newer optimistic tag disable', async () => {
    let releaseHealthSync!: (res: Response) => void;
    const healthSyncPromise = new Promise<Response>((resolve) => {
      releaseHealthSync = resolve;
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/health') {
          return new Response(JSON.stringify({ ok: true, db: true, serverTime: 2000 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url === '/api/sync?since=10') {
          return healthSyncPromise;
        }
        if (url === '/api/mutations') {
          // 模拟停用请求暂时未成功或仍在排队中
          return new Response(JSON.stringify({ ok: false }), { status: 500 });
        }
        return new Response('{}', { status: 404 });
      }),
    );

    // 启动后台轮询，此时挂起在 /api/sync?since=10
    const bgSync = useAppStore.getState().checkHealthAndSync();
    await new Promise((r) => setTimeout(r, 10));

    // 用户在后台轮询飞行途中点停用标签
    await useAppStore.getState().setTagDisabled('t1', true);
    const localDisabledAt = useAppStore.getState().tags[0].disabled_at;
    expect(typeof localDisabledAt).toBe('number');

    // 后台过期的 /api/sync 返回了停用前的旧快照 (disabled_at: null)
    releaseHealthSync(
      new Response(
        JSON.stringify({
          cursor: 10,
          serverTime: 2000,
          modules: [],
          tags: [{ ...BASE_TAG, disabled_at: null }],
          sessions: [],
          todos: [],
          todoChecks: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    await bgSync;

    // 乐观停用状态绝不能被旧快照覆盖还原
    expect(useAppStore.getState().tags[0].disabled_at).toBe(localDisabledAt);
  });

  it('persists non-timer mutation to IndexedDB before broadcasting in local desktop mode', async () => {
    useAppStore.setState({
      isDesktop: true,
      desktopConfig: {
        connectionMode: 'local',
        serverUrl: '',
        sessionToken: '',
        backupDir: '',
        widgetVisible: true,
        widgetSkin: 'light',
        autoHideWidgetWhenIdle: false,
        closeToTray: true,
        autostart: false,
        globalShortcut: 'CommandOrControl+Alt+T',
        lastLocalBackupDate: null,
      },
    });

    await useAppStore.getState().setTagDisabled('t1', true);
    const putResolvedIdx = callOrder.indexOf('db.tags.put:resolved');
    const bcastIdx = callOrder.indexOf('bridge.broadcastState');
    expect(putResolvedIdx).toBeGreaterThanOrEqual(0);
    expect(bcastIdx).toBeGreaterThan(putResolvedIdx);

    // 计时器动作仍然保留快速广播优先（在 IndexedDB 落盘完成前就先触发广播）
    callOrder.length = 0;
    await useAppStore.getState().startTimer({ tagId: 't1', title: '测试' });
    const firstBcast = callOrder.indexOf('bridge.broadcastState');
    const firstPutResolved = callOrder.indexOf('db.sessions.put:resolved');
    expect(firstBcast).toBeGreaterThanOrEqual(0);
    expect(firstBcast).toBeLessThan(firstPutResolved);
  });
});
