import type { ReactNode } from 'react';
import { useAppStore, type NavTab } from '../store/useAppStore.js';
import { DesktopTitlebar } from './DesktopTitlebar.js';
import { SyncStatusPill } from './SyncStatusPill.js';

const TABS: Array<{ id: NavTab; label: string }> = [
  { id: 'today', label: '今日' },
  { id: 'calendar', label: '日历' },
  { id: 'history', label: '历史' },
  { id: 'stats', label: '统计' },
  { id: 'tags', label: '标签' },
];

export function AppShell({ children }: { children: ReactNode }) {
  const activeTab = useAppStore((s) => s.activeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const errorBanner = useAppStore((s) => s.errorBanner);
  const dismissErrorBanner = useAppStore((s) => s.dismissErrorBanner);
  const isDesktop = useAppStore((s) => s.isDesktop);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {isDesktop ? (
        <DesktopTitlebar />
      ) : (
        <div className="tb-header-wrap" data-testid="web-header-sticky">
        <header className="tb-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              background: '#FFD43B',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg
              width="22"
              height="22"
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
          <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.01em' }}>时间簿</div>
        </div>

        <nav
          className="card tb-desktop-nav"
          aria-label="主导航"
          style={{ display: 'flex', gap: 2, borderRadius: 14, padding: 4 }}
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
                  height: 40,
                  padding: '0 20px',
                  borderRadius: 10,
                  fontSize: 14,
                  color: active ? '#FFFFFF' : '#4B5263',
                  background: active ? '#111827' : 'transparent',
                }}
              >
                {t.label}
              </button>
            );
          })}
        </nav>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SyncStatusPill />
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="btn ghost icon"
            aria-label="设置"
            title="设置与数据管理"
            data-testid="open-settings"
            style={{ width: 36, height: 36, borderRadius: 10 }}
          >
            <svg
              width="18"
              height="18"
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
        </div>
      </header>
        </div>
      )}

      <main className="tb-main" style={isDesktop ? { paddingTop: 20 } : undefined}>
        {errorBanner && (
          <div
            role="alert"
            style={{
              marginBottom: 16,
              padding: '12px 16px',
              borderRadius: 14,
              background: '#FFEDF0',
              border: '1px solid #FFC9D2',
              color: '#C8203E',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            <span>{errorBanner}</span>
            <button
              type="button"
              onClick={dismissErrorBanner}
              className="btn"
              style={{
                height: 28,
                padding: '0 10px',
                borderRadius: 8,
                background: '#FFFFFF',
                color: '#C8203E',
                fontSize: 12,
              }}
            >
              知道了
            </button>
          </div>
        )}
        {children}
      </main>

      <nav className="tb-mobile-nav" aria-label="手机主导航">
        {TABS.map((t) => {
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => setActiveTab(t.id)}
              className="btn"
              style={{
                height: 44,
                padding: '0 4px',
                borderRadius: 12,
                fontSize: 12,
                background: active ? '#111827' : 'transparent',
                color: active ? '#FFFFFF' : '#4B5263',
              }}
            >
              {t.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
