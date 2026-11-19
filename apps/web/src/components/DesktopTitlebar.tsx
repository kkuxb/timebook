import { desktopBridge } from '../lib/desktopBridge.js';
import { useAppStore, type NavTab } from '../store/useAppStore.js';
import { SyncStatusPill } from './SyncStatusPill.js';

const TABS: Array<{ id: NavTab; label: string }> = [
  { id: 'today', label: '今日' },
  { id: 'calendar', label: '日历' },
  { id: 'stats', label: '统计' },
  { id: 'tags', label: '标签' },
];

export function DesktopTitlebar() {
  const activeTab = useAppStore((s) => s.activeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const desktopConfig = useAppStore((s) => s.desktopConfig);

  const widgetVisible = desktopConfig?.widgetVisible ?? true;
  const closeToTray = desktopConfig?.closeToTray ?? true;

  return (
    <header
      className="tb-desktop-titlebar"
      data-tauri-drag-region
      data-testid="desktop-titlebar"
      style={{
        height: 56,
        padding: '0 16px 0 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        background: '#FFFFFF',
        borderBottom: '1px solid #E8EAF1',
        userSelect: 'none',
        flex: 'none',
      }}
    >
      {/* 左侧品牌图标与标题（可拖拽） */}
      <div
        data-tauri-drag-region
        style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 130 }}
      >
        <div
          data-tauri-drag-region
          style={{
            width: 32,
            height: 32,
            borderRadius: 10,
            background: '#FFD43B',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#111827"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
        </div>
        <div
          data-tauri-drag-region
          style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.01em', color: '#111827' }}
        >
          时间簿
        </div>
      </div>

      {/* 居中四栏分段导航 */}
      <nav
        aria-label="主导航"
        style={{
          display: 'flex',
          gap: 2,
          borderRadius: 12,
          padding: 3,
          background: '#F5F6FA',
          border: '1px solid #E8EAF1',
        }}
      >
        {TABS.map((t) => {
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => setActiveTab(t.id)}
              className={active ? 'btn dark' : 'btn'}
              style={{
                height: 32,
                padding: '0 16px',
                borderRadius: 9,
                fontSize: 13,
                color: active ? '#FFFFFF' : '#4B5263',
                background: active ? '#111827' : 'transparent',
              }}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      {/* 右侧状态胶囊、设置、小窗显隐及窗口控制 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <SyncStatusPill />

        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="btn ghost icon"
          aria-label="设置"
          title="桌面设置与数据管理"
          data-testid="open-settings"
          style={{ width: 32, height: 32, borderRadius: 9 }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>

        <button
          type="button"
          onClick={() => void desktopBridge.windowAction('toggleWidget')}
          className="btn ghost icon"
          aria-label={widgetVisible ? '隐藏悬浮小窗' : '显示悬浮小窗'}
          title={widgetVisible ? '隐藏灵动胶囊小窗' : '显示灵动胶囊小窗'}
          data-testid="toggle-widget-btn"
          style={{
            width: 32,
            height: 32,
            borderRadius: 9,
            background: widgetVisible ? '#FFFBEB' : '#FFFFFF',
            color: '#111827',
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="6" width="18" height="12" rx="6" />
            <circle cx="9" cy="12" r="2" fill={widgetVisible ? '#FFD43B' : 'none'} />
          </svg>
        </button>

        <button
          type="button"
          onClick={() => void desktopBridge.windowAction('minimizeMain')}
          className="btn soft icon"
          aria-label="最小化"
          title="最小化窗口"
          data-testid="desktop-minimize-btn"
          style={{ width: 30, height: 30, borderRadius: 9, fontSize: 14 }}
        >
          —
        </button>

        <button
          type="button"
          onClick={() => void desktopBridge.windowAction('closeMain')}
          className="btn soft icon"
          aria-label={closeToTray ? '最小化到托盘' : '关闭窗口'}
          title={closeToTray ? '隐藏到系统托盘（不断计时）' : '退出时间簿'}
          data-testid="desktop-close-btn"
          style={{ width: 30, height: 30, borderRadius: 9, fontSize: 13 }}
        >
          ✕
        </button>
      </div>
    </header>
  );
}
