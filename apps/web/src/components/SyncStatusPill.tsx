import { useEffect, useRef, useState } from 'react';
import { formatShanghaiTime } from '@timebook/core';
import { useAppStore, type SyncStatus } from '../store/useAppStore.js';

const STATUS_STYLE: Record<
  SyncStatus,
  {
    label: (pending: number) => string;
    dot: string;
    bg: string;
    fg: string;
    ring: string;
    dotLive: boolean;
  }
> = {
  ok: {
    label: () => '数据已同步',
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

  const st = STATUS_STYLE[syncStatus];
  const label = st.label(pendingCount);
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
          height: 34,
          padding: '0 12px',
          borderRadius: 999,
          fontSize: 13,
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
            top: 42,
            width: 280,
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
            <div>待发送改动：{pendingCount} 条</div>
            {syncStatus === 'db_error' && (
              <div style={{ color: '#C8203E', marginTop: 4 }}>
                数据可能没有保存：{lastError || '数据库读写异常'}
              </div>
            )}
            {syncStatus === 'offline' && lastError && (
              <div style={{ color: '#9A3A0A', marginTop: 4 }}>原因：{lastError}</div>
            )}
            {syncStatus === 'ok' && (
              <div style={{ marginTop: 4 }}>本地缓存与服务端 SQLite 已对齐。</div>
            )}
          </div>
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
        </div>
      )}
    </div>
  );
}
