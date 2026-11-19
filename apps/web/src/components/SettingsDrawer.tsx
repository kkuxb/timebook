import { useEffect, useState, type ChangeEvent } from 'react';
import { formatClockMs, formatShanghaiTime, toShanghaiDateStr } from '@timebook/core';
import {
  parseNotionFiles,
  type ImportIssue,
  type NotionImportPreview,
  type ParsedSessionDraft,
} from '@timebook/notion-import';
import { buildTagLookup } from '../lib/labels.js';
import { apiFetch, useAppStore } from '../store/useAppStore.js';

interface ImportBatchMeta {
  batchId: string;
  batchName: string;
  createdAt: number;
  importedSessions: number;
  importedTodos: number;
  undoneAt: number | null;
}

interface TrashItem {
  kind: 'module' | 'tag' | 'session' | 'todo';
  id: string;
  title: string;
  subtitle: string;
  deletedAt: number;
}

const REASON_TEXT: Record<string, string> = {
  missing_end: '缺少结束时间',
  end_before_start: '结束时间早于开始时间',
  over_24h: '单条超过 24 小时',
  missing_tag: '未填写标签',
  module_only: '只匹配到一级模块名，无具体事项',
  unknown_tag: '未在时间标签表中找到',
  invalid_start: '开始时间无法解析',
};

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

  const [preview, setPreview] = useState<NotionImportPreview | null>(null);
  const [issues, setIssues] = useState<ImportIssue[]>([]);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [batches, setBatches] = useState<ImportBatchMeta[]>([]);
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
      setBatches([]);
      return;
    }

    try {
      const [bRes, tRes] = await Promise.all([
        apiFetch('/api/import/batches'),
        apiFetch('/api/trash'),
      ]);
      if (bRes.ok) {
        const bj = (await bRes.json()) as { batches?: ImportBatchMeta[] };
        setBatches(bj.batches ?? []);
      }
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

  const handleFilesSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setImportMsg(null);
    const loaded = await Promise.all(
      Array.from(files).map(async (f) => ({
        name: f.name,
        content: await f.text(),
      })),
    );
    const res = parseNotionFiles(loaded, lookup.activeModules, lookup.activeTags);
    setPreview(res);
    setIssues(res.issues);
    e.target.value = '';
  };

  const updateIssueResolution = (
    issueId: string,
    patch: Partial<ImportIssue['resolution']>,
  ) => {
    setIssues((prev) =>
      prev.map((it) =>
        it.issueId === issueId
          ? { ...it, resolution: { ...it.resolution, ...patch } }
          : it,
      ),
    );
  };

  const handleConfirmImport = async () => {
    if (!preview) return;
    setImporting(true);
    setImportMsg(null);

    try {
      const extraSessions: ParsedSessionDraft[] = [];
      for (const iss of issues) {
        if (iss.resolution.action === 'skip') continue;
        const start = iss.start_at;
        const end = iss.resolution.manualEndAt ?? iss.end_at;
        if (!start || !end || end <= start) continue;
        let moduleName: string | null = null;
        let tagName: string | null = null;
        if (iss.resolution.action === 'assign_tag' && iss.resolution.tagKey) {
          const [mName, tName] = iss.resolution.tagKey.split('::');
          moduleName = mName || null;
          tagName = tName || null;
        }
        extraSessions.push({
          moduleName,
          tagName,
          title: iss.resolvedTitle,
          start_at: start,
          end_at: end,
        });
      }

      if (isLocalDesktop) {
        const allSessions = [...preview.validSessions, ...extraSessions];
        const modByName = new Map(lookup.activeModules.map((m) => [m.name, m.id]));
        const tagByKey = new Map(
          lookup.activeTags.map((t) => {
            const mName = lookup.moduleById.get(t.module_id)?.name ?? '';
            return [`${mName}::${t.name}`, t.id];
          }),
        );
        const now = Date.now();
        for (const m of preview.modules) {
          if (!modByName.has(m.name)) {
            const id = `imp-m-${now}-${Math.random().toString(36).slice(2, 7)}`;
            modByName.set(m.name, id);
            await upsertModule({
              id,
              name: m.name,
              color_key: m.color_key,
              sort: modByName.size,
              created_at: now,
              updated_at: now,
              deleted_at: null,
            });
          }
        }
        for (const t of preview.tags) {
          const key = `${t.moduleName}::${t.name}`;
          const mId = modByName.get(t.moduleName);
          if (mId && !tagByKey.has(key)) {
            const id = `imp-t-${now}-${Math.random().toString(36).slice(2, 7)}`;
            tagByKey.set(key, id);
            await upsertTag({
              id,
              module_id: mId,
              name: t.name,
              sort: tagByKey.size,
              created_at: now,
              updated_at: now,
              deleted_at: null,
            });
          }
        }
        for (const s of allSessions) {
          const tagId = s.moduleName && s.tagName ? (tagByKey.get(`${s.moduleName}::${s.tagName}`) ?? null) : null;
          await updateSession({
            id: `imp-s-${now}-${Math.random().toString(36).slice(2, 8)}`,
            tag_id: tagId,
            todo_id: null,
            title: s.title,
            start_at: s.start_at,
            end_at: s.end_at,
            source: 'import',
            import_batch: null,
            created_at: now,
            updated_at: now,
            deleted_at: null,
          });
        }
        for (const td of preview.validTodos) {
          let tagId: string | null = null;
          if (td.tagName) {
            const found = Array.from(tagByKey.entries()).find(([k]) => k.endsWith(`::${td.tagName}`));
            if (found) tagId = found[1];
          }
          await upsertTodo({
            id: `imp-td-${now}-${Math.random().toString(36).slice(2, 8)}`,
            title: td.title,
            tag_id: tagId,
            plan_date: td.plan_date,
            due_date: td.due_date,
            recur: null,
            done_at: null,
            sort: 0,
            created_at: now,
            updated_at: now,
            deleted_at: null,
          });
        }
        setImportMsg(`单机导入完成：写入 ${allSessions.length} 条专注记录，${preview.validTodos.length} 条待办。`);
        setPreview(null);
        setIssues([]);
        return;
      }

      const res = await apiFetch('/api/import/notion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modules: preview.modules,
          tags: preview.tags,
          sessions: [...preview.validSessions, ...extraSessions],
          todos: preview.validTodos,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        importedSessions?: number;
        importedTodos?: number;
        error?: string;
      };
      if (!res.ok) {
        setImportMsg(json.error || '导入失败');
      } else {
        setImportMsg(
          `导入完成：写入 ${json.importedSessions ?? 0} 条专注记录，${json.importedTodos ?? 0} 条待办。`,
        );
        setPreview(null);
        setIssues([]);
        await refreshAfterServerAction();
        await loadDrawerLists();
      }
    } catch {
      setImportMsg('导入请求失败，请检查网络连接');
    } finally {
      setImporting(false);
    }
  };

  const handleUndoBatch = async (batchId: string) => {
    const res = await apiFetch(`/api/import/${batchId}`, { method: 'DELETE' });
    if (res.ok) {
      await refreshAfterServerAction();
      await loadDrawerLists();
    }
  };

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
          JSON.stringify({ version: 1, exportedAt: Date.now(), modules, tags, sessions, todos, todoChecks }, null, 2),
          'application/json;charset=utf-8',
        );
      } else {
        const header = '日期,开始时间,结束时间,时长,模块,事项,内容';
        const lines = sessions
          .filter((s) => s.deleted_at === null && s.end_at !== null)
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
              `"${(s.title || '').replace(/"/g, '""')}"`,
            ].join(',');
          });
        triggerBlobDownload(
          `timebook-sessions-${dateStr}.csv`,
          `\uFEFF${[header, ...lines].join('\n')}`,
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

  const allPreviewTags = preview?.tags ?? [];

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

        {/* 0. 桌面版与数据同步（仅桌面端展示） */}
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

        {/* 1. 从 Notion 导入 */}
        <section className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>从 Notion 导入历史数据</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#6B7280', lineHeight: 1.5 }}>
            在 Notion 导出「时间标签」「专注记录」「待办（可选）」CSV 后一次选中上传。系统会自动对账并支持整批撤销。
          </div>

          <label
            className="btn primary"
            style={{ height: 42, borderRadius: 12, fontSize: 14, cursor: 'pointer', alignSelf: 'flex-start', padding: '0 16px' }}
          >
            选择 CSV 文件（可多选）
            <input
              type="file"
              accept=".csv,text/csv"
              multiple
              onChange={(e) => void handleFilesSelected(e)}
              style={{ display: 'none' }}
            />
          </label>

          {importMsg && (
            <div style={{ fontSize: 13, fontWeight: 700, color: '#0B7F72', background: '#E6F7F4', padding: '10px 12px', borderRadius: 12 }}>
              {importMsg}
            </div>
          )}

          {preview && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 8, borderTop: '1px solid #EEF0F5' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>
                识别文件：{preview.detectedFiles.map((f) => `${f.name}(${f.type})`).join('、')}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, fontSize: 13, fontWeight: 700 }}>
                <div style={{ background: '#F5F6FA', padding: 10, borderRadius: 10 }}>
                  有效记录：<span className="tnum">{preview.validSessions.length}</span> 条
                </div>
                <div style={{ background: '#F5F6FA', padding: 10, borderRadius: 10 }}>
                  待导入待办：<span className="tnum">{preview.validTodos.length}</span> 条
                </div>
              </div>
              {preview.dateRange.startDate && (
                <div style={{ fontSize: 12, fontWeight: 600, color: '#6B7280' }}>
                  时间跨度：{preview.dateRange.startDate} 至 {preview.dateRange.endDate}（已跳过 {preview.skippedCancelledSessions} 条取消/未开始记录，{preview.skippedDoneTodos} 条已完成待办）
                </div>
              )}

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {preview.moduleTotals.map((mt) => (
                  <div
                    key={mt.moduleName}
                    style={{
                      background: '#F2F3F7',
                      borderRadius: 10,
                      padding: '6px 10px',
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    {mt.moduleName}：<span className="tnum">{mt.totalMinutes.toLocaleString('en-US')}</span> min（{mt.totalHours} h）
                  </div>
                ))}
              </div>

              {issues.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: '#9A3A0A' }}>
                      发现 {issues.length} 条问题记录
                    </span>
                    <button
                      type="button"
                      className="btn soft"
                      onClick={() =>
                        setIssues((prev) =>
                          prev.map((it) =>
                            it.start_at && it.end_at && it.end_at > it.start_at
                              ? { ...it, resolution: { ...it.resolution, action: 'unclassified' } }
                              : it,
                          ),
                        )
                      }
                      style={{ height: 28, padding: '0 10px', borderRadius: 8, fontSize: 12 }}
                    >
                      有时间的全部设为未分类
                    </button>
                  </div>
                  {issues.map((iss) => (
                    <div
                      key={iss.issueId}
                      style={{
                        background: '#FFF7F1',
                        border: '1px solid #FFB38A',
                        borderRadius: 12,
                        padding: 10,
                        fontSize: 12,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                      }}
                    >
                      <div style={{ fontWeight: 800, color: '#9A3A0A' }}>
                        第 {iss.rowNumber} 行 · {iss.rawTitle || iss.rawTag || '无标题'}（{iss.reasons.map((r) => REASON_TEXT[r] || r).join('、')}）
                      </div>
                      <div style={{ color: '#6B7280' }}>
                        {iss.rawStart} → {iss.rawEnd || '缺结束时间'}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                        {iss.reasons.includes('missing_end') && iss.start_at !== null && (
                          <input
                            type="time"
                            aria-label={`补填第 ${iss.rowNumber} 行结束时间`}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (!val) return;
                              const [hh, mm] = val.split(':').map((x) => parseInt(x, 10));
                              const baseDate = toShanghaiDateStr(iss.start_at!);
                              const startMin = Math.round(
                                (iss.start_at! - Date.parse(`${baseDate}T00:00:00+08:00`)) / 60000,
                              );
                              let endMin = hh * 60 + mm;
                              if (endMin <= startMin) endMin += 1440;
                              const manualEndAt =
                                Date.parse(`${baseDate}T00:00:00+08:00`) + endMin * 60000;
                              updateIssueResolution(iss.issueId, {
                                manualEndAt,
                                action:
                                  iss.resolution.action === 'skip'
                                    ? 'unclassified'
                                    : iss.resolution.action,
                              });
                            }}
                            style={{
                              height: 30,
                              borderRadius: 8,
                              border: '1px solid #FFB38A',
                              padding: '0 6px',
                              fontSize: 12,
                              fontWeight: 700,
                            }}
                          />
                        )}
                        <select
                          aria-label={`处理问题行 ${iss.rowNumber}`}
                          value={
                            iss.resolution.action === 'assign_tag'
                              ? `tag:${iss.resolution.tagKey}`
                              : iss.resolution.action
                          }
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === 'skip' || v === 'unclassified') {
                              updateIssueResolution(iss.issueId, { action: v });
                            } else if (v.startsWith('tag:')) {
                              updateIssueResolution(iss.issueId, {
                                action: 'assign_tag',
                                tagKey: v.slice(4),
                              });
                            }
                          }}
                          style={{ height: 30, borderRadius: 8, border: '1px solid #E1E4EC', padding: '0 8px', fontSize: 12, fontWeight: 700 }}
                        >
                          <option value="skip">跳过不导入</option>
                          <option value="unclassified">设为未分类导入</option>
                          {allPreviewTags.map((t) => (
                            <option key={`${t.moduleName}::${t.name}`} value={`tag:${t.moduleName}::${t.name}`}>
                              指定：{t.moduleName} · {t.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  disabled={importing}
                  onClick={() => void handleConfirmImport()}
                  className="btn dark"
                  style={{ height: 42, padding: '0 20px', borderRadius: 12, fontSize: 14 }}
                >
                  {importing ? '正在导入…' : '确认导入'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPreview(null);
                    setIssues([]);
                  }}
                  className="btn ghost"
                  style={{ height: 42, padding: '0 16px', borderRadius: 12, fontSize: 14 }}
                >
                  取消
                </button>
              </div>
            </div>
          )}

          {batches.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 8, borderTop: '1px solid #EEF0F5' }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#4B5263' }}>已导入批次</div>
              {batches.map((b) => (
                <div
                  key={b.batchId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    fontSize: 13,
                    padding: '6px 0',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700 }}>{b.batchName}</div>
                    <div style={{ fontSize: 12, color: '#6B7280' }}>
                      {b.importedSessions} 条记录 · {b.importedTodos} 条待办
                      {b.undoneAt ? '（已撤销）' : ''}
                    </div>
                  </div>
                  {!b.undoneAt && (
                    <button
                      type="button"
                      className="btn soft"
                      onClick={() => void handleUndoBatch(b.batchId)}
                      style={{ height: 32, padding: '0 12px', borderRadius: 9, fontSize: 12, color: '#C8203E' }}
                    >
                      整批撤销
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 2. 数据导出与备份 */}
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
