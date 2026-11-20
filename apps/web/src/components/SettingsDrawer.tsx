import { useEffect, useState } from 'react';
import { formatClockMs, formatShanghaiTime, toCsv, toShanghaiDateStr } from '@timebook/core';
import { buildTagLookup } from '../lib/labels.js';
import { apiFetch, useAppStore } from '../store/useAppStore.js';

interface TrashItem {
  kind: 'module' | 'tag' | 'session' | 'todo';
  id: string;
  title: string;
  subtitle: string;
  deletedAt: number;
}

function triggerBlobDownload(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function SettingsDrawer() {
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const modules = useAppStore((s) => s.modules);
  const tags = useAppStore((s) => s.tags);
  const sessions = useAppStore((s) => s.sessions);
  const todos = useAppStore((s) => s.todos);
  const todoChecks = useAppStore((s) => s.todoChecks);
  const lastBackupAt = useAppStore((s) => s.lastBackupAt);
  const syncStatus = useAppStore((s) => s.syncStatus);
  const refreshAfterServerAction = useAppStore((s) => s.refreshAfterServerAction);
  const logout = useAppStore((s) => s.logout);

  const isDesktop = useAppStore((s) => s.isDesktop);
  const desktopConfig = useAppStore((s) => s.desktopConfig);
  const desktopDataDir = useAppStore((s) => s.desktopDataDir);
  const updateDesktopConfig = useAppStore((s) => s.updateDesktopConfig);
  const runDesktopBackup = useAppStore((s) => s.runDesktopBackup);
  const connectToNas = useAppStore((s) => s.connectToNas);
  const switchToLocalMode = useAppStore((s) => s.switchToLocalMode);
  const upsertModule = useAppStore((s) => s.upsertModule);
  const upsertTag = useAppStore((s) => s.upsertTag);
  const upsertTodo = useAppStore((s) => s.upsertTodo);
  const updateSession = useAppStore((s) => s.updateSession);

  const [trash, setTrash] = useState<TrashItem[]>([]);
  const [backupBusy, setBackupBusy] = useState(false);

  // 桌面配置输入态
  const [nasUrlInput, setNasUrlInput] = useState('');
  const [nasPwdInput, setNasPwdInput] = useState('');
  const [nasConnectBusy, setNasConnectBusy] = useState(false);
  const [nasMsg, setNasMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [backupDirInput, setBackupDirInput] = useState('');
  const [shortcutInput, setShortcutInput] = useState('CommandOrControl+Alt+T');
  const [desktopMsg, setDesktopMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [desktopBackupBusy, setDesktopBackupBusy] = useState(false);

  const isLocalDesktop = isDesktop && desktopConfig?.connectionMode === 'local';

  useEffect(() => {
    if (desktopConfig) {
      setNasUrlInput(desktopConfig.serverUrl || '');
      setBackupDirInput(desktopConfig.backupDir || '');
      setShortcutInput(desktopConfig.globalShortcut || 'CommandOrControl+Alt+T');
    }
  }, [desktopConfig]);

  const loadDrawerLists = async () => {
    if (isLocalDesktop) {
      const localTrash: TrashItem[] = [];
      for (const m of modules) {
        if (m.deleted_at !== null) {
          localTrash.push({
            kind: 'module',
            id: m.id,
            title: m.name,
            subtitle: '模块',
            deletedAt: m.deleted_at,
          });
        }
      }
      for (const t of tags) {
        if (t.deleted_at !== null) {
          localTrash.push({
            kind: 'tag',
            id: t.id,
            title: t.name,
            subtitle: '事项标签',
            deletedAt: t.deleted_at,
          });
        }
      }
      for (const s of sessions) {
        if (s.deleted_at !== null) {
          localTrash.push({
            kind: 'session',
            id: s.id,
            title: s.title || '专注记录',
            subtitle: toShanghaiDateStr(s.start_at),
            deletedAt: s.deleted_at,
          });
        }
      }
      for (const td of todos) {
        if (td.deleted_at !== null) {
          localTrash.push({
            kind: 'todo',
            id: td.id,
            title: td.title,
            subtitle: '待办事项',
            deletedAt: td.deleted_at,
          });
        }
      }
      localTrash.sort((a, b) => b.deletedAt - a.deletedAt);
      setTrash(localTrash);
      return;
    }

    try {
      const tRes = await apiFetch('/api/trash');
      if (tRes.ok) {
        const tj = (await tRes.json()) as { items?: TrashItem[] };
        setTrash(tj.items ?? []);
      }
    } catch {
      // 离线时不阻塞面板
    }
  };

  useEffect(() => {
    if (settingsOpen) {
      void loadDrawerLists();
    }
  }, [settingsOpen, isLocalDesktop]);

  if (!settingsOpen) return null;

  const lookup = buildTagLookup(modules, tags);

  const handleRestoreTrash = async (item: TrashItem) => {
    if (isLocalDesktop) {
      if (item.kind === 'module') {
        const m = modules.find((x) => x.id === item.id);
        if (m) await upsertModule({ ...m, deleted_at: null });
      } else if (item.kind === 'tag') {
        const t = tags.find((x) => x.id === item.id);
        if (t) await upsertTag({ ...t, deleted_at: null });
      } else if (item.kind === 'session') {
        const s = sessions.find((x) => x.id === item.id);
        if (s) await updateSession({ ...s, deleted_at: null });
      } else if (item.kind === 'todo') {
        const td = todos.find((x) => x.id === item.id);
        if (td) await upsertTodo({ ...td, deleted_at: null });
      }
      await loadDrawerLists();
      return;
    }

    const res = await apiFetch('/api/trash/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: item.kind, id: item.id }),
    });
    if (res.ok) {
      await refreshAfterServerAction();
      await loadDrawerLists();
    }
  };

  const handleRunBackup = async () => {
    setBackupBusy(true);
    try {
      const res = await apiFetch('/api/backup/run', { method: 'POST' });
      if (res.ok) {
        await refreshAfterServerAction();
      }
    } finally {
      setBackupBusy(false);
    }
  };

  const handleExportFile = async (format: 'json' | 'csv') => {
    const dateStr = toShanghaiDateStr(Date.now());
    if (isLocalDesktop) {
      if (format === 'json') {
        triggerBlobDownload(
          `timebook-backup-${dateStr}.json`,
          JSON.stringify(
            { version: '0.2.1', exportedAt: Date.now(), modules, tags, sessions, todos, todoChecks },
            null,
            2,
          ),
          'application/json;charset=utf-8',
        );
      } else {
        const rows = sessions
          .filter((s) => s.deleted_at === null && s.end_at !== null)
          .sort((a, b) => b.start_at - a.start_at)
          .map((s) => {
            const tag = s.tag_id ? lookup.tagById.get(s.tag_id) : undefined;
            const mod = tag ? lookup.moduleById.get(tag.module_id) : undefined;
            const dur = formatClockMs(Math.max(0, (s.end_at ?? s.start_at) - s.start_at));
            return [
              toShanghaiDateStr(s.start_at),
              formatShanghaiTime(s.start_at),
              formatShanghaiTime(s.end_at!),
              dur,
              mod?.name ?? '未分类',
              tag?.name ?? '未分类',
              s.title ?? '',
            ];
          });
        triggerBlobDownload(
          `timebook-sessions-${dateStr}.csv`,
          toCsv(['日期', '开始时间', '结束时间', '时长', '模块', '事项', '内容'], rows, true),
          'text/csv;charset=utf-8',
        );
      }
      return;
    }

    const res = await apiFetch(`/api/export?format=${format}`);
    if (res.ok) {
      const text = await res.text();
      triggerBlobDownload(
        format === 'csv' ? `timebook-sessions-${dateStr}.csv` : `timebook-backup-${dateStr}.json`,
        text,
        format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8',
      );
    }
  };

  const handleConnectNas = async () => {
    setNasConnectBusy(true);
    setNasMsg(null);
    try {
      const res = await connectToNas(nasUrlInput, nasPwdInput);
      if (res.ok) {
        setNasPwdInput('');
        setNasMsg({
          ok: true,
          text:
            res.mergedCount && res.mergedCount > 0
              ? `连接成功，已自动合并上传 ${res.mergedCount} 条单机变动（同名默认模块已去重）。`
              : '连接成功，本机已与远程服务完全对齐。',
        });
      } else {
        setNasMsg({ ok: false, text: res.error || '连接失败' });
      }
    } finally {
      setNasConnectBusy(false);
    }
  };

  const handleSaveDesktopPref = async (patch: Record<string, unknown>, successText?: string) => {
    setDesktopMsg(null);
    const res = await updateDesktopConfig(patch);
    if (res.ok) {
      if (successText) setDesktopMsg({ ok: true, text: successText });
    } else {
      setDesktopMsg({ ok: false, text: res.error || '保存设置失败' });
    }
  };

  const handleDesktopBackupNow = async () => {
    setDesktopBackupBusy(true);
    setDesktopMsg(null);
    try {
      const res = await runDesktopBackup();
      if (res.ok) {
        setDesktopMsg({ ok: true, text: `已备份到本地文件：${res.path}` });
      } else {
        setDesktopMsg({ ok: false, text: res.error || '本地备份失败' });
      }
    } finally {
      setDesktopBackupBusy(false);
    }
  };

  return (
    <div className="drawer-backdrop" onClick={() => setSettingsOpen(false)}>
      <div
        role="dialog"
        aria-label="设置与数据管理"
        className="drawer-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>设置与数据</h2>
          <button
            type="button"
            onClick={() => setSettingsOpen(false)}
            className="btn ghost icon"
            aria-label="关闭设置"
          >
            ✕
          </button>
        </div>

        {/* 1. 桌面版与数据同步（仅桌面端展示） */}
        {isDesktop && desktopConfig && (
          <section
            className="card"
            data-testid="desktop-settings-section"
            style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 16, fontWeight: 800 }}>桌面版与数据同步</div>
              <span
                className="chip"
                style={{
                  background: desktopConfig.connectionMode === 'local' ? '#E6F7F4' : '#EDF1FF',
                  color: desktopConfig.connectionMode === 'local' ? '#0B7F72' : '#2D4FCC',
                  fontSize: 12,
                }}
              >
                {desktopConfig.connectionMode === 'local' ? '单机直用模式' : 'NAS 同步模式'}
              </span>
            </div>

            {/* 连接模式与单机转连 NAS */}
            <div
              style={{
                background: '#F5F6FA',
                borderRadius: 14,
                padding: 12,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 800 }}>
                {desktopConfig.connectionMode === 'local'
                  ? '接入家庭绿联 NAS（将自动无损合并本机单机数据）'
                  : `当前已连接：${desktopConfig.serverUrl}`}
              </div>
              <input
                type="text"
                value={nasUrlInput}
                onChange={(e) => setNasUrlInput(e.target.value)}
                placeholder="NAS 服务地址（例如 http://nas.local:3210）"
                data-testid="nas-url-input"
                className="tin"
                style={{ height: 38, fontSize: 13, background: '#FFFFFF' }}
              />
              <input
                type="password"
                value={nasPwdInput}
                onChange={(e) => setNasPwdInput(e.target.value)}
                placeholder="输入访问口令"
                data-testid="nas-password-input"
                className="tin"
                style={{ height: 38, fontSize: 13, background: '#FFFFFF' }}
              />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button
                  type="button"
                  disabled={nasConnectBusy}
                  onClick={() => void handleConnectNas()}
                  data-testid="connect-nas-btn"
                  className="btn primary"
                  style={{ height: 36, padding: '0 14px', borderRadius: 10, fontSize: 13 }}
                >
                  {nasConnectBusy ? '正在合并同步…' : '连接并同步'}
                </button>
                {desktopConfig.connectionMode === 'nas' && (
                  <button
                    type="button"
                    onClick={() => void switchToLocalMode()}
                    data-testid="switch-local-btn"
                    className="btn ghost"
                    style={{ height: 36, padding: '0 14px', borderRadius: 10, fontSize: 13 }}
                  >
                    切换回单机模式
                  </button>
                )}
              </div>
              {nasMsg && (
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: nasMsg.ok ? '#0B7F72' : '#C8203E',
                  }}
                >
                  {nasMsg.text}
                </div>
              )}
            </div>

            {/* 本地防丢备份目录 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#4B5263' }}>
                本地每日备份目录（自动保留最近 30 份）
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  value={backupDirInput}
                  onChange={(e) => setBackupDirInput(e.target.value)}
                  data-testid="desktop-backup-dir-input"
                  className="tin"
                  style={{ height: 36, fontSize: 13 }}
                />
                <button
                  type="button"
                  onClick={() =>
                    void handleSaveDesktopPref({ backupDir: backupDirInput.trim() }, '已保存备份目录')
                  }
                  data-testid="desktop-save-backup-dir-btn"
                  className="btn soft"
                  style={{ height: 36, padding: '0 12px', borderRadius: 10, fontSize: 12, flex: 'none' }}
                >
                  保存路径
                </button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 12, color: '#6B7280' }}>
                  最近本地快照：{desktopConfig.lastLocalBackupDate ?? '今日尚未生成'}
                  {desktopDataDir ? ` · 数据目录已就绪` : ''}
                </span>
                <button
                  type="button"
                  disabled={desktopBackupBusy}
                  onClick={() => void handleDesktopBackupNow()}
                  data-testid="desktop-backup-now-btn"
                  className="btn ghost"
                  style={{ height: 32, padding: '0 12px', borderRadius: 9, fontSize: 12 }}
                >
                  {desktopBackupBusy ? '备份中…' : '立即备份到本地'}
                </button>
              </div>
            </div>

            {/* 小窗外观与行为开关 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 6, borderTop: '1px solid #EEF0F5' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>置顶灵动胶囊小窗外观</span>
                <div style={{ display: 'flex', gap: 4, background: '#F2F3F7', padding: 3, borderRadius: 10 }}>
                  <button
                    type="button"
                    onClick={() => void handleSaveDesktopPref({ widgetSkin: 'light' })}
                    data-testid="skin-light-btn"
                    className="btn"
                    style={{
                      height: 28,
                      padding: '0 10px',
                      borderRadius: 8,
                      fontSize: 12,
                      background: desktopConfig.widgetSkin === 'light' ? '#FFFFFF' : 'transparent',
                      color: '#111827',
                    }}
                  >
                    白底干净
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSaveDesktopPref({ widgetSkin: 'dark' })}
                    data-testid="skin-dark-btn"
                    className="btn"
                    style={{
                      height: 28,
                      padding: '0 10px',
                      borderRadius: 8,
                      fontSize: 12,
                      background: desktopConfig.widgetSkin === 'dark' ? '#111827' : 'transparent',
                      color: desktopConfig.widgetSkin === 'dark' ? '#FFFFFF' : '#4B5263',
                    }}
                  >
                    墨色深底
                  </button>
                </div>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                <span>显示灵动胶囊悬浮小窗</span>
                <input
                  type="checkbox"
                  checked={desktopConfig.widgetVisible}
                  onChange={(e) => void handleSaveDesktopPref({ widgetVisible: e.target.checked })}
                  data-testid="toggle-widget-visible-chk"
                />
              </label>

              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                <span>无进行中计时时自动隐藏小窗</span>
                <input
                  type="checkbox"
                  checked={desktopConfig.autoHideWidgetWhenIdle}
                  onChange={(e) =>
                    void handleSaveDesktopPref({ autoHideWidgetWhenIdle: e.target.checked })
                  }
                  data-testid="toggle-auto-hide-widget-chk"
                />
              </label>

              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                <span>点关闭 × 时隐藏到托盘（不中断计时）</span>
                <input
                  type="checkbox"
                  checked={desktopConfig.closeToTray}
                  onChange={(e) => void handleSaveDesktopPref({ closeToTray: e.target.checked })}
                  data-testid="toggle-close-to-tray-chk"
                />
              </label>

              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                <span>开机自动静默启动并驻留托盘</span>
                <input
                  type="checkbox"
                  checked={desktopConfig.autostart}
                  onChange={(e) => void handleSaveDesktopPref({ autostart: e.target.checked })}
                  data-testid="toggle-autostart-chk"
                />
              </label>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>全局极速呼出快捷键</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    value={shortcutInput}
                    onChange={(e) => setShortcutInput(e.target.value)}
                    data-testid="global-shortcut-input"
                    className="tin"
                    style={{ height: 36, fontSize: 13 }}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      void handleSaveDesktopPref(
                        { globalShortcut: shortcutInput.trim() },
                        '已更新全局快捷键',
                      )
                    }
                    data-testid="save-shortcut-btn"
                    className="btn soft"
                    style={{ height: 36, padding: '0 12px', borderRadius: 10, fontSize: 12, flex: 'none' }}
                  >
                    应用
                  </button>
                </div>
              </div>

              {desktopMsg && (
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: desktopMsg.ok ? '#0B7F72' : '#C8203E',
                  }}
                >
                  {desktopMsg.text}
                </div>
              )}
            </div>
          </section>
        )}

        {/* 2. 数据导出与自动备份 */}
        <section className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>数据导出与自动备份</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button
              type="button"
              onClick={() => void handleExportFile('json')}
              className="btn soft"
              style={{ height: 40, padding: '0 16px', borderRadius: 12, fontSize: 13 }}
            >
              导出全量 JSON
            </button>
            <button
              type="button"
              onClick={() => void handleExportFile('csv')}
              className="btn soft"
              style={{ height: 40, padding: '0 16px', borderRadius: 12, fontSize: 13 }}
            >
              导出明细 CSV
            </button>
            {!isLocalDesktop && (
              <button
                type="button"
                disabled={backupBusy}
                onClick={() => void handleRunBackup()}
                className="btn ghost"
                style={{ height: 40, padding: '0 14px', borderRadius: 12, fontSize: 13 }}
              >
                {backupBusy ? '正在备份…' : '立即备份'}
              </button>
            )}
          </div>
          {!isLocalDesktop && (
            <div style={{ fontSize: 12, fontWeight: 600, color: '#6B7280' }}>
              最近服务端自动备份：
              {lastBackupAt
                ? `${toShanghaiDateStr(lastBackupAt)} ${formatShanghaiTime(lastBackupAt)}`
                : '尚未生成（每日凌晨 03:00 自动执行）'}
            </div>
          )}
        </section>

        {/* 3. 30 天回收站 */}
        <section className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>回收站（最近 30 天已删除）</div>
          {trash.length === 0 ? (
            <div style={{ fontSize: 13, fontWeight: 600, color: '#9CA3AF' }}>回收站是空的</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {trash.map((item) => (
                <div
                  key={`${item.kind}:${item.id}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                    padding: '8px 10px',
                    background: '#F5F6FA',
                    borderRadius: 12,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.title}
                    </div>
                    <div style={{ fontSize: 12, color: '#6B7280' }}>{item.subtitle}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleRestoreTrash(item)}
                    className="btn ghost"
                    style={{ height: 32, padding: '0 12px', borderRadius: 9, fontSize: 12, flex: 'none' }}
                  >
                    恢复
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 4. 账户与设备 */}
        {!isLocalDesktop && (
          <section className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 16, fontWeight: 800 }}>账户与设备</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#6B7280' }}>
              当前连接状态：{syncStatus === 'ok' ? '正常' : syncStatus === 'saving' ? '正在保存' : syncStatus === 'db_error' ? '数据库异常' : '连接断开'}
            </div>
            <button
              type="button"
              onClick={() => void logout()}
              className="btn"
              style={{
                height: 42,
                borderRadius: 12,
                background: '#FFEDF0',
                color: '#C8203E',
                fontSize: 14,
                alignSelf: 'flex-start',
                padding: '0 18px',
              }}
            >
              退出当前设备
            </button>
          </section>
        )}
      </div>
    </div>
  );
}
