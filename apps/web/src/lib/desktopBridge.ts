import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  ModuleEntity,
  SessionEntity,
  TagEntity,
  TodoCheckEntity,
  TodoEntity,
} from '@timebook/core';

export interface DesktopConfig {
  connectionMode: 'local' | 'nas';
  serverUrl: string;
  sessionToken: string;
  backupDir: string;
  lastLocalBackupDate: string | null;
  widgetVisible: boolean;
  autoHideWidgetWhenIdle: boolean;
  widgetSkin: 'light' | 'dark';
  widgetPosition: { x: number; y: number } | null;
  closeToTray: boolean;
  autostart: boolean;
  globalShortcut: string;
}

export interface LocalSnapshotFile {
  version: 1;
  savedAt: number;
  modules: ModuleEntity[];
  tags: TagEntity[];
  sessions: SessionEntity[];
  todos: TodoEntity[];
  todoChecks: TodoCheckEntity[];
}

export interface InitStateResponse {
  config: DesktopConfig;
  snapshot: LocalSnapshotFile | null;
  dataDir: string;
  isIsolated: boolean;
  todayDate: string;
}

export interface TrayRunningItem {
  id: string;
  title: string;
}

export interface TrayRecentTag {
  id: string;
  label: string;
}

export interface TraySyncPayload {
  modeLabel: string;
  running: TrayRunningItem[];
  recentTags: TrayRecentTag[];
  widgetVisible: boolean;
}

export type DesktopWindowKind = 'main' | 'widget' | 'launcher';

export type DesktopWindowAction =
  | 'minimizeMain'
  | 'closeMain'
  | 'showMain'
  | 'toggleWidget'
  | 'showWidget'
  | 'hideWidget'
  | 'showLauncher'
  | 'hideLauncher'
  | 'quitApp';

const MOCK_FLAG_KEY = 'tb_desktop_mock';
const MOCK_CONFIG_KEY = 'tb_mock_desktop_config';
const MOCK_SNAPSHOT_KEY = 'tb_mock_desktop_snapshot';
const MOCK_BACKUP_KEY = 'tb_mock_desktop_backups';
const MOCK_TRAY_KEY = 'tb_mock_desktop_tray';
const SYNC_CHANNEL_NAME = 'timebook-sync-bus';

export const DEFAULT_DESKTOP_CONFIG: DesktopConfig = {
  connectionMode: 'local',
  serverUrl: '',
  sessionToken: '',
  backupDir: 'TimebookBackups',
  lastLocalBackupDate: null,
  widgetVisible: true,
  autoHideWidgetWhenIdle: false,
  widgetSkin: 'light',
  widgetPosition: null,
  closeToTray: true,
  autostart: false,
  globalShortcut: 'CommandOrControl+Alt+T',
};

export function hasTauriInternals(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

function isMockDesktopEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('desktopMock') === '1') {
      window.localStorage.setItem(MOCK_FLAG_KEY, '1');
      return true;
    }
    if (params.get('desktopMock') === '0') {
      window.localStorage.removeItem(MOCK_FLAG_KEY);
      return false;
    }
    return window.localStorage.getItem(MOCK_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

export function isDesktopEnvironment(): boolean {
  return hasTauriInternals() || isMockDesktopEnabled();
}

export function getDesktopWindowKind(): DesktopWindowKind {
  if (typeof window === 'undefined') return 'main';
  const kind = new URLSearchParams(window.location.search).get('window');
  if (kind === 'widget' || kind === 'launcher') return kind;
  return 'main';
}

const INSTANCE_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let sharedChannel: BroadcastChannel | null = null;

function getSyncChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!sharedChannel) {
    sharedChannel = new BroadcastChannel(SYNC_CHANNEL_NAME);
  }
  return sharedChannel;
}

function readMockConfig(): DesktopConfig {
  try {
    const raw = window.localStorage.getItem(MOCK_CONFIG_KEY);
    if (!raw) return { ...DEFAULT_DESKTOP_CONFIG };
    return { ...DEFAULT_DESKTOP_CONFIG, ...(JSON.parse(raw) as Partial<DesktopConfig>) };
  } catch {
    return { ...DEFAULT_DESKTOP_CONFIG };
  }
}

function writeMockConfig(cfg: DesktopConfig): void {
  try {
    window.localStorage.setItem(MOCK_CONFIG_KEY, JSON.stringify(cfg));
  } catch {
    // 忽略存储配额限制
  }
}

function readMockSnapshot(): LocalSnapshotFile | null {
  try {
    const raw = window.localStorage.getItem(MOCK_SNAPSHOT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LocalSnapshotFile;
  } catch {
    return null;
  }
}

function todayShanghaiDate(): string {
  const d = new Date(Date.now() + 8 * 3600_000);
  return d.toISOString().slice(0, 10);
}

export interface FastStateBroadcastPayload {
  revision: number;
  sourceWindow: DesktopWindowKind;
  instanceId: string;
  runningSessions?: SessionEntity[];
  clockOffsetMs?: number;
}

export interface BridgeSubscriptionHandlers {
  onStateUpdated?: (fastPayload?: FastStateBroadcastPayload) => void;
  onConfigUpdated?: (config: DesktopConfig) => void;
  onTrayQuickStart?: (tagId: string) => void;
  onTrayAction?: (action: { action: 'stop_all' | 'stop_one'; sessionId?: string }) => void;
  onTrayToggleWidget?: () => void;
  onLauncherOpened?: () => void;
}

export const desktopBridge = {
  async getInitState(): Promise<InitStateResponse> {
    if (hasTauriInternals()) {
      const delays = [40, 80, 160, 300];
      let lastErr: unknown;
      for (let attempt = 0; attempt <= delays.length; attempt += 1) {
        try {
          return await invoke<InitStateResponse>('desktop_get_init_state');
        } catch (err) {
          lastErr = err;
          if (attempt < delays.length) {
            await new Promise((r) => setTimeout(r, delays[attempt]));
          }
        }
      }
      throw lastErr;
    }
    const cfg = readMockConfig();
    const snap = readMockSnapshot();
    const todayDate = todayShanghaiDate();
    if (!window.localStorage.getItem(MOCK_CONFIG_KEY)) {
      writeMockConfig(cfg);
    }
    return {
      config: cfg,
      snapshot: snap,
      dataDir: 'browser-mock-desktop',
      isIsolated: true,
      todayDate,
    };
  },

  async saveSnapshot(snapshot: LocalSnapshotFile): Promise<{ savedAt: number; lastLocalBackupDate: string | null }> {
    if (hasTauriInternals()) {
      return invoke('desktop_save_snapshot', { snapshot });
    }
    window.localStorage.setItem(MOCK_SNAPSHOT_KEY, JSON.stringify(snapshot));
    const cfg = readMockConfig();
    const today = todayShanghaiDate();
    if (cfg.lastLocalBackupDate !== today) {
      cfg.lastLocalBackupDate = today;
      writeMockConfig(cfg);
      try {
        const existing = JSON.parse(window.localStorage.getItem(MOCK_BACKUP_KEY) || '{}') as Record<string, unknown>;
        existing[`timebook-local-${today}.json`] = snapshot;
        window.localStorage.setItem(MOCK_BACKUP_KEY, JSON.stringify(existing));
      } catch {
        // 忽略模拟备份异常
      }
    }
    return { savedAt: Date.now(), lastLocalBackupDate: cfg.lastLocalBackupDate };
  },

  async saveConfig(config: DesktopConfig): Promise<DesktopConfig> {
    if (hasTauriInternals()) {
      return invoke<DesktopConfig>('desktop_save_config', { config });
    }
    writeMockConfig(config);
    getSyncChannel()?.postMessage({
      kind: 'config-updated',
      source: INSTANCE_ID,
      config,
    });
    return config;
  },

  async runLocalBackup(): Promise<{ path: string; date: string; savedAt: number }> {
    if (hasTauriInternals()) {
      return invoke('desktop_run_local_backup');
    }
    const today = todayShanghaiDate();
    const cfg = readMockConfig();
    cfg.lastLocalBackupDate = today;
    writeMockConfig(cfg);
    const snap = readMockSnapshot();
    const existing = JSON.parse(window.localStorage.getItem(MOCK_BACKUP_KEY) || '{}') as Record<string, unknown>;
    existing[`timebook-local-${today}.json`] = snap;
    window.localStorage.setItem(MOCK_BACKUP_KEY, JSON.stringify(existing));
    getSyncChannel()?.postMessage({ kind: 'config-updated', source: INSTANCE_ID, config: cfg });
    return {
      path: `${cfg.backupDir}/timebook-local-${today}.json`,
      date: today,
      savedAt: Date.now(),
    };
  },

  async setWidgetExpanded(expanded: boolean, count: number): Promise<void> {
    if (hasTauriInternals()) {
      await invoke('desktop_set_widget_expanded', { expanded, count });
    }
  },

  async setWidgetVisibility(visible: boolean): Promise<void> {
    if (hasTauriInternals()) {
      await invoke('desktop_set_widget_visibility', { visible });
    }
  },

  async syncTray(payload: TraySyncPayload): Promise<void> {
    if (hasTauriInternals()) {
      await invoke('desktop_sync_tray', { payload });
      return;
    }
    try {
      window.localStorage.setItem(MOCK_TRAY_KEY, JSON.stringify(payload));
    } catch {
      // 忽略
    }
  },

  async windowAction(action: DesktopWindowAction): Promise<void> {
    if (hasTauriInternals()) {
      await invoke('desktop_window_action', { action });
      return;
    }
    if (action === 'toggleWidget') {
      const cfg = readMockConfig();
      cfg.widgetVisible = !cfg.widgetVisible;
      writeMockConfig(cfg);
      getSyncChannel()?.postMessage({ kind: 'config-updated', source: INSTANCE_ID, config: cfg });
    } else {
      getSyncChannel()?.postMessage({ kind: 'window-action', source: INSTANCE_ID, action });
    }
  },

  async broadcastState(
    sourceWindow: DesktopWindowKind,
    extra?: { runningSessions?: SessionEntity[]; clockOffsetMs?: number },
  ): Promise<void> {
    const payload: FastStateBroadcastPayload = {
      revision: Date.now(),
      sourceWindow,
      instanceId: INSTANCE_ID,
      ...(extra?.runningSessions ? { runningSessions: extra.runningSessions } : {}),
      ...(typeof extra?.clockOffsetMs === 'number' ? { clockOffsetMs: extra.clockOffsetMs } : {}),
    };
    getSyncChannel()?.postMessage({ kind: 'state-updated', ...payload });
    if (hasTauriInternals()) {
      await invoke('desktop_broadcast_state', { payload });
    }
  },

  async subscribe(handlers: BridgeSubscriptionHandlers): Promise<() => void> {
    const unsubs: Array<() => void> = [];

    const ch = getSyncChannel();
    if (ch) {
      const onMsg = (ev: MessageEvent) => {
        const data = ev.data as {
          kind?: string;
          source?: string;
          instanceId?: string;
          revision?: number;
          sourceWindow?: DesktopWindowKind;
          runningSessions?: SessionEntity[];
          clockOffsetMs?: number;
          config?: DesktopConfig;
          tagId?: string;
          action?: { action: 'stop_all' | 'stop_one'; sessionId?: string };
        };
        if (!data || data.source === INSTANCE_ID || data.instanceId === INSTANCE_ID) return;
        if (data.kind === 'state-updated') {
          handlers.onStateUpdated?.({
            revision: data.revision ?? Date.now(),
            sourceWindow: data.sourceWindow ?? 'main',
            instanceId: data.instanceId ?? '',
            runningSessions: data.runningSessions,
            clockOffsetMs: data.clockOffsetMs,
          });
        } else if (data.kind === 'config-updated' && data.config) {
          handlers.onConfigUpdated?.(data.config);
        } else if (data.kind === 'tray-quick-start' && data.tagId) {
          handlers.onTrayQuickStart?.(data.tagId);
        } else if (data.kind === 'tray-action' && data.action) {
          handlers.onTrayAction?.(data.action);
        } else if (data.kind === 'tray-toggle-widget') {
          handlers.onTrayToggleWidget?.();
        } else if (data.kind === 'launcher-opened') {
          handlers.onLauncherOpened?.();
        }
      };
      ch.addEventListener('message', onMsg);
      unsubs.push(() => ch.removeEventListener('message', onMsg));
    }

    if (hasTauriInternals()) {
      const tauriUnsubs: UnlistenFn[] = [];
      if (handlers.onStateUpdated) {
        tauriUnsubs.push(
          await listen<FastStateBroadcastPayload>('timebook://state-updated', (ev) => {
            if (ev.payload?.instanceId === INSTANCE_ID) return;
            handlers.onStateUpdated?.(ev.payload);
          }),
        );
      }
      if (handlers.onConfigUpdated) {
        tauriUnsubs.push(
          await listen<DesktopConfig>('timebook://config-updated', (ev) => {
            if (ev.payload) handlers.onConfigUpdated?.(ev.payload);
          }),
        );
      }
      if (handlers.onTrayQuickStart) {
        tauriUnsubs.push(
          await listen<{ tagId: string }>('timebook://tray-quick-start', (ev) => {
            if (ev.payload?.tagId) handlers.onTrayQuickStart?.(ev.payload.tagId);
          }),
        );
      }
      if (handlers.onTrayAction) {
        tauriUnsubs.push(
          await listen<{ action: 'stop_all' | 'stop_one'; sessionId?: string }>(
            'timebook://tray-action',
            (ev) => {
              if (ev.payload) handlers.onTrayAction?.(ev.payload);
            },
          ),
        );
      }
      if (handlers.onTrayToggleWidget) {
        tauriUnsubs.push(
          await listen('timebook://tray-toggle-widget', () => {
            handlers.onTrayToggleWidget?.();
          }),
        );
      }
      if (handlers.onLauncherOpened) {
        tauriUnsubs.push(
          await listen('timebook://launcher-opened', () => {
            handlers.onLauncherOpened?.();
          }),
        );
      }
      unsubs.push(() => {
        for (const fn of tauriUnsubs) fn();
      });
    }

    return () => {
      for (const fn of unsubs) fn();
    };
  },
};
