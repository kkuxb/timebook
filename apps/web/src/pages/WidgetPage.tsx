import { useEffect, useState } from 'react';
import { formatClockMs } from '@timebook/core';
import { desktopBridge } from '../lib/desktopBridge.js';
import { buildTagLookup, formatSessionDisplayTitle, getTagStyle } from '../lib/labels.js';
import { useAppStore } from '../store/useAppStore.js';

export function WidgetPage() {
  const modules = useAppStore((s) => s.modules);
  const tags = useAppStore((s) => s.tags);
  const sessions = useAppStore((s) => s.sessions);
  const nowMs = useAppStore((s) => s.nowMs);
  const endTimer = useAppStore((s) => s.endTimer);
  const desktopConfig = useAppStore((s) => s.desktopConfig);

  const [nowTick, setNowTick] = useState(() => nowMs());
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    document.body.style.overflow = 'hidden';
    const iv = setInterval(() => setNowTick(nowMs()), 250);
    return () => clearInterval(iv);
  }, [nowMs]);

  const lookup = buildTagLookup(modules, tags);
  const runningTimers = sessions
    .filter((s) => s.deleted_at === null && s.end_at === null)
    .sort((a, b) => a.start_at - b.start_at);

  const runningSignature = runningTimers.map((r) => `${r.id}:${r.start_at}`).join('|');
  useEffect(() => {
    setNowTick(nowMs());
  }, [runningSignature, nowMs]);

  const skin = desktopConfig?.widgetSkin ?? 'light';
  const isDark = skin === 'dark';

  const surfaceStyle = isDark
    ? {
        background: 'rgba(17, 24, 39, 0.94)',
        color: '#F9FAFB',
        border: '1px solid rgba(255, 255, 255, 0.14)',
        boxShadow: '0 8px 24px -4px rgba(0, 0, 0, 0.38)',
      }
    : {
        background: '#FFFFFF',
        color: '#111827',
        border: '1px solid #E8EAF1',
        boxShadow: '0 6px 20px -4px rgba(17, 24, 39, 0.14)',
      };

  const mutedColor = isDark ? '#9CA3AF' : '#6B7280';
  const rowBg = isDark ? 'rgba(255, 255, 255, 0.06)' : '#F5F6FA';

  const handleMouseEnter = () => {
    setExpanded(true);
    void desktopBridge.setWidgetExpanded(true, runningTimers.length);
  };

  const handleMouseLeave = () => {
    setExpanded(false);
    void desktopBridge.setWidgetExpanded(false, runningTimers.length);
  };

  useEffect(() => {
    if (expanded) {
      void desktopBridge.setWidgetExpanded(true, runningTimers.length);
    }
  }, [expanded, runningTimers.length]);

  const primary = runningTimers[0];
  const primaryStyle = primary ? getTagStyle(primary.tag_id, lookup) : null;
  const primaryTitle = primary ? formatSessionDisplayTitle(primary, lookup) : '当前空闲';

  return (
    <div
      data-testid="widget-root"
      data-skin={skin}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        width: '100vw',
        height: '100vh',
        padding: 4,
        background: 'transparent',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
      }}
    >
      {!expanded ? (
        <div
          data-tauri-drag-region
          data-testid="widget-compact"
          style={{
            width: '100%',
            height: 44,
            borderRadius: 999,
            padding: '0 12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            userSelect: 'none',
            cursor: 'grab',
            ...surfaceStyle,
          }}
        >
          {primary && primaryStyle ? (
            <>
              <div
                data-tauri-drag-region
                style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}
              >
                <span
                  className="live"
                  style={{
                    width: 8,
                    height: 8,
                    color: primaryStyle.color,
                    background: primaryStyle.color,
                  }}
                />
                <span
                  data-tauri-drag-region
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {primaryTitle}
                </span>
                {runningTimers.length > 1 && (
                  <span
                    data-testid="widget-multi-badge"
                    style={{
                      background: '#FFD43B',
                      color: '#111827',
                      fontSize: 11,
                      fontWeight: 800,
                      padding: '1px 6px',
                      borderRadius: 999,
                      flex: 'none',
                    }}
                  >
                    +{runningTimers.length - 1}
                  </span>
                )}
              </div>
              <span
                data-tauri-drag-region
                className="tnum"
                style={{ fontSize: 13, fontWeight: 800, flex: 'none' }}
              >
                {formatClockMs(Math.max(0, nowTick - primary.start_at))}
              </span>
            </>
          ) : (
            <>
              <div
                data-tauri-drag-region
                style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: mutedColor,
                    flex: 'none',
                  }}
                />
                <span style={{ fontSize: 13, fontWeight: 700, color: mutedColor }}>当前空闲</span>
              </div>
              <button
                type="button"
                onClick={() => void desktopBridge.windowAction('showLauncher')}
                className="btn primary"
                data-testid="widget-idle-start"
                style={{ height: 28, padding: '0 10px', borderRadius: 999, fontSize: 12 }}
              >
                + 开始专注
              </button>
            </>
          )}
        </div>
      ) : (
        <div
          data-testid="widget-expanded"
          style={{
            width: '100%',
            borderRadius: 20,
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            userSelect: 'none',
            ...surfaceStyle,
          }}
        >
          <div
            data-tauri-drag-region
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: 12,
              fontWeight: 700,
              color: mutedColor,
              cursor: 'grab',
            }}
          >
            <span data-tauri-drag-region>
              {runningTimers.length > 0
                ? `进行中专注（${runningTimers.length}）`
                : '当前没有进行中的计时'}
            </span>
            <span data-tauri-drag-region>{isDark ? '墨色' : '白底'}</span>
          </div>

          {runningTimers.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {runningTimers.slice(0, 4).map((s) => {
                const st = getTagStyle(s.tag_id, lookup);
                return (
                  <div
                    key={s.id}
                    data-testid={`widget-running-row-${s.id}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      padding: '6px 8px',
                      borderRadius: 12,
                      background: rowBg,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, flex: 1 }}>
                      <span
                        className="live"
                        style={{ width: 7, height: 7, color: st.color, background: st.color }}
                      />
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {formatSessionDisplayTitle(s, lookup)}
                      </span>
                    </div>
                    <span className="tnum" style={{ fontSize: 12, fontWeight: 800, flex: 'none' }}>
                      {formatClockMs(Math.max(0, nowTick - s.start_at))}
                    </span>
                    <button
                      type="button"
                      onClick={() => void endTimer(s.id)}
                      data-testid="widget-stop-btn"
                      className="btn"
                      style={{
                        height: 26,
                        padding: '0 10px',
                        borderRadius: 8,
                        fontSize: 12,
                        background: isDark ? '#FFD43B' : '#111827',
                        color: isDark ? '#111827' : '#FFFFFF',
                        flex: 'none',
                      }}
                    >
                      结束
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, paddingTop: 2 }}>
            <button
              type="button"
              onClick={() => void desktopBridge.windowAction('showLauncher')}
              className="btn primary"
              data-testid="widget-new-focus-btn"
              style={{ flex: 1, height: 32, borderRadius: 10, fontSize: 12 }}
            >
              + 新建专注
            </button>
            <button
              type="button"
              onClick={() => void desktopBridge.windowAction('showMain')}
              className="btn"
              data-testid="widget-open-main-btn"
              style={{
                height: 32,
                padding: '0 12px',
                borderRadius: 10,
                fontSize: 12,
                background: rowBg,
                color: isDark ? '#F9FAFB' : '#111827',
              }}
            >
              主界面
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
