import { useEffect, useRef, useState } from 'react';
import { formatShanghaiTime } from '@timebook/core';
import { useAppStore, type SyncStatus } from '../store/useAppStore.js';

const STATUS_STYLE: Record<
  SyncStatus,
  {
    label: (pending: number, isDesktop: boolean, mode: 'local' | 'nas') => string;
    dot: string;
    bg: string;
    fg: string;
    ring: string;
    dotLive: boolean;
  }
> = {
  ok: {
    label: (_n, isDesktop, mode) =>
      isDesktop
        ? mode === 'local'
          ? '本机已保存 · 单机模式'
          : '数据已同步 · 远程服务'
        : '数据已同步',
    dot: '#14B8A6',
    bg: 'transparent',
    fg: '#4B5263',
    ring: 'none',
    dotLive: true,
  },
  saving: {
    label: () => '正在保存…',
    dot: '#E5A800',
    bg: 'transparent',
    fg: '#4B5263',
    ring: 'none',
    dotLive: true,
  },
  offline: {
    label: (n) => (n > 0 ? `连接断开 · ${n} 条待保存` : '连接断开'),
    dot: '#F2711C',
    bg: '#FFF7F1',
    fg: '#9A3A0A',
    ring: 'inset 0 0 0 1.5px #FFB38A',
    dotLive: false,
  },
  db_error: {
    label: () => '数据库异常',
    dot: '#E11D48',
    bg: '#FFF7F1',
    fg: '#9A3A0A',
    ring: 'inset 0 0 0 1.5px #FFB38A',
    dotLive: false,
  },
};

export function SyncStatusPill() {
  const syncStatus = useAppStore((s) => s.syncStatus);
  const pendingCount = useAppStore((s) => s.pendingCount);
  const lastSavedAt = useAppStore((s) => s.lastSavedAt);
  const lastError = useAppStore((s) => s.lastError);
  const retryNow = useAppStore((s) => s.retryNow);
  const isDesktop = useAppStore((s) => s.isDesktop);
  const desktopConfig = useAppStore((s) => s.desktopConfig);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);

  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const mode = desktopConfig?.connectionMode ?? 'local';
  const st = STATUS_STYLE[syncStatus];
  const label = st.label(pendingCount, isDesktop, mode);
  const savedText = lastSavedAt ? formatShanghaiTime(lastSavedAt) : '尚未同步';

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid="sync-pill"
        aria-label={label}
        aria-expanded={open}
        className="btn"
        style={{
          height: 32,
          padding: '0 12px',
          borderRadius: 999,
          fontSize: 12,
          fontWeight: 700,
          background: st.bg,
          color: st.fg,
          boxShadow: st.ring,
        }}
      >
        <span
          className={st.dotLive ? 'live' : undefined}
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: st.dot,
            color: st.dot,
            flex: 'none',
          }}
        />
        <span>{label}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="同步状态详情"
          className="card"
          style={{
            position: 'absolute',
            right: 0,
            top: 40,
            width: 288,
            padding: 16,
            zIndex: 60,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 800 }}>{label}</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', lineHeight: 1.5 }}>
            <div>上次保存时间：{savedText}</div>
            {(!isDesktop || mode === 'nas') && <div>待发送改动：{pendingCount} 条</div>}
            {syncStatus === 'db_error' && (
              <div style={{ color: '#C8203E', marginTop: 4 }}>
                数据可能没有保存：{lastError || '数据库读写异常'}
              </div>
            )}
            {syncStatus === 'offline' && lastError && (
              <div style={{ color: '#9A3A0A', marginTop: 4 }}>原因：{lastError}</div>
            )}
            {syncStatus === 'ok' && isDesktop && mode === 'local' && (
              <div style={{ marginTop: 4 }}>
                数据已实时写入本机文件并每日自动备份，随时可在设置中连接 NAS 合并同步。
              </div>
            )}
            {syncStatus === 'ok' && (!isDesktop || mode === 'nas') && (
              <div style={{ marginTop: 4 }}>本地缓存与服务端 SQLite 已对齐。</div>
            )}
          </div>
          {isDesktop && mode === 'local' ? (
            <button
              type="button"
              className="btn soft"
              onClick={() => {
                setOpen(false);
                setSettingsOpen(true);
              }}
              style={{ height: 36, borderRadius: 10, fontSize: 13 }}
            >
              前往设置连接 NAS 或备份
            </button>
          ) : (
            <button
              type="button"
              className="btn soft"
              onClick={() => {
                void retryNow();
              }}
              style={{ height: 36, borderRadius: 10, fontSize: 13 }}
            >
              立即重试
            </button>
          )}
        </div>
      )}
    </div>
  );
}
