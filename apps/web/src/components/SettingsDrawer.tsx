import { useEffect, useState, type ChangeEvent } from 'react';
import { formatShanghaiTime, toShanghaiDateStr } from '@timebook/core';
import {
  parseNotionFiles,
  type ImportIssue,
  type NotionImportPreview,
  type ParsedSessionDraft,
} from '@timebook/notion-import';
import { buildTagLookup } from '../lib/labels.js';
import { useAppStore } from '../store/useAppStore.js';

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

export function SettingsDrawer() {
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const modules = useAppStore((s) => s.modules);
  const tags = useAppStore((s) => s.tags);
  const lastBackupAt = useAppStore((s) => s.lastBackupAt);
  const syncStatus = useAppStore((s) => s.syncStatus);
  const refreshAfterServerAction = useAppStore((s) => s.refreshAfterServerAction);
  const logout = useAppStore((s) => s.logout);

  const [preview, setPreview] = useState<NotionImportPreview | null>(null);
  const [issues, setIssues] = useState<ImportIssue[]>([]);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [batches, setBatches] = useState<ImportBatchMeta[]>([]);
  const [trash, setTrash] = useState<TrashItem[]>([]);
  const [backupBusy, setBackupBusy] = useState(false);

  const loadDrawerLists = async () => {
    try {
      const [bRes, tRes] = await Promise.all([
        fetch('/api/import/batches'),
        fetch('/api/trash'),
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
  }, [settingsOpen]);

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

      const res = await fetch('/api/import/notion', {
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
    const res = await fetch(`/api/import/${batchId}`, { method: 'DELETE' });
    if (res.ok) {
      await refreshAfterServerAction();
      await loadDrawerLists();
    }
  };

  const handleRestoreTrash = async (item: TrashItem) => {
    const res = await fetch('/api/trash/restore', {
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
      const res = await fetch('/api/backup/run', { method: 'POST' });
      if (res.ok) {
        await refreshAfterServerAction();
      }
    } finally {
      setBackupBusy(false);
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
                                (iss.start_at! - (Date.parse(`${baseDate}T00:00:00+08:00`))) / 60000,
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
            <a
              href="/api/export?format=json"
              download
              className="btn soft"
              style={{ height: 40, padding: '0 16px', borderRadius: 12, fontSize: 13 }}
            >
              导出全量 JSON
            </a>
            <a
              href="/api/export?format=csv"
              download
              className="btn soft"
              style={{ height: 40, padding: '0 16px', borderRadius: 12, fontSize: 13 }}
            >
              导出明细 CSV
            </a>
            <button
              type="button"
              disabled={backupBusy}
              onClick={() => void handleRunBackup()}
              className="btn ghost"
              style={{ height: 40, padding: '0 14px', borderRadius: 12, fontSize: 13 }}
            >
              {backupBusy ? '正在备份…' : '立即备份'}
            </button>
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#6B7280' }}>
            最近自动备份：
            {lastBackupAt
              ? `${toShanghaiDateStr(lastBackupAt)} ${formatShanghaiTime(lastBackupAt)}`
              : '尚未生成（每日凌晨 03:00 自动执行）'}
          </div>
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
      </div>
    </div>
  );
}
