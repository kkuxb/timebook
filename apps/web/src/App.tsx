import { useEffect } from 'react';
import { AppShell } from './components/AppShell.js';
import { SettingsDrawer } from './components/SettingsDrawer.js';
import { desktopBridge, getDesktopWindowKind, isDesktopEnvironment } from './lib/desktopBridge.js';
import { CalendarPage } from './pages/CalendarPage.js';
import { LauncherPage } from './pages/LauncherPage.js';
import { LoginPage } from './pages/LoginPage.js';
import { StatsPage } from './pages/StatsPage.js';
import { TagsPage } from './pages/TagsPage.js';
import { TodayPage } from './pages/TodayPage.js';
import { WidgetPage } from './pages/WidgetPage.js';
import { useAppStore } from './store/useAppStore.js';

export function App() {
  const authState = useAppStore((s) => s.authState);
  const activeTab = useAppStore((s) => s.activeTab);
  const init = useAppStore((s) => s.init);
  const checkHealthAndSync = useAppStore((s) => s.checkHealthAndSync);
  const syncFromBridgeUpdate = useAppStore((s) => s.syncFromBridgeUpdate);
  const applyConfigFromBridge = useAppStore((s) => s.applyConfigFromBridge);
  const startTimer = useAppStore((s) => s.startTimer);
  const endTimer = useAppStore((s) => s.endTimer);
  const updateDesktopConfig = useAppStore((s) => s.updateDesktopConfig);

  const windowKind = isDesktopEnvironment() ? getDesktopWindowKind() : 'main';

  useEffect(() => {
    void init();
  }, [init]);

  // 桌面多窗口与系统托盘事件订阅
  useEffect(() => {
    if (!isDesktopEnvironment()) return;
    let unsub: (() => void) | null = null;
    void desktopBridge
      .subscribe({
        onStateUpdated: () => {
          void syncFromBridgeUpdate();
        },
        onConfigUpdated: (cfg) => {
          applyConfigFromBridge(cfg);
        },
        onTrayQuickStart: (tagId) => {
          if (windowKind !== 'main') return;
          void startTimer({ tagId, title: null });
        },
        onTrayAction: (act) => {
          if (windowKind !== 'main') return;
          if (act.action === 'stop_one' && act.sessionId) {
            void endTimer(act.sessionId);
          } else if (act.action === 'stop_all') {
            const running = useAppStore
              .getState()
              .sessions.filter((s) => s.deleted_at === null && s.end_at === null);
            void (async () => {
              for (const s of running) {
                await endTimer(s.id);
              }
            })();
          }
        },
        onTrayToggleWidget: () => {
          if (windowKind !== 'main') return;
          const current = useAppStore.getState().desktopConfig;
          if (current) {
            void updateDesktopConfig({ widgetVisible: !current.widgetVisible });
          }
        },
      })
      .then((fn) => {
        unsub = fn;
      });
    return () => {
      unsub?.();
    };
  }, [windowKind, syncFromBridgeUpdate, applyConfigFromBridge, startTimer, endTimer, updateDesktopConfig]);

  useEffect(() => {
    if (authState !== 'authenticated' || windowKind !== 'main') return;

    const iv = setInterval(() => {
      void checkHealthAndSync();
    }, 30_000);

    const onFocus = () => {
      void checkHealthAndSync();
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void checkHealthAndSync();
      }
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(iv);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [authState, windowKind, checkHealthAndSync]);

  if (authState === 'checking') {
    if (windowKind === 'widget' || windowKind === 'launcher') {
      return null;
    }
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 15,
          fontWeight: 700,
          color: '#6B7280',
        }}
      >
        正在加载时间簿…
      </div>
    );
  }

  if (windowKind === 'widget') {
    return <WidgetPage />;
  }

  if (windowKind === 'launcher') {
    return <LauncherPage />;
  }

  if (authState === 'unauthenticated') {
    return <LoginPage />;
  }

  return (
    <AppShell>
      {activeTab === 'today' && <TodayPage />}
      {activeTab === 'calendar' && <CalendarPage />}
      {activeTab === 'stats' && <StatsPage />}
      {activeTab === 'tags' && <TagsPage />}
      <SettingsDrawer />
    </AppShell>
  );
}
