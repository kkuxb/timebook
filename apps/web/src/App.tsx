import { useEffect } from 'react';
import { AppShell } from './components/AppShell.js';
import { SettingsDrawer } from './components/SettingsDrawer.js';
import { CalendarPage } from './pages/CalendarPage.js';
import { LoginPage } from './pages/LoginPage.js';
import { StatsPage } from './pages/StatsPage.js';
import { TagsPage } from './pages/TagsPage.js';
import { TodayPage } from './pages/TodayPage.js';
import { useAppStore } from './store/useAppStore.js';

export function App() {
  const authState = useAppStore((s) => s.authState);
  const activeTab = useAppStore((s) => s.activeTab);
  const init = useAppStore((s) => s.init);
  const checkHealthAndSync = useAppStore((s) => s.checkHealthAndSync);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    if (authState !== 'authenticated') return;

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
  }, [authState, checkHealthAndSync]);

  if (authState === 'checking') {
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
