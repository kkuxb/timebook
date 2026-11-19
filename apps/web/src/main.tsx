import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import { App } from './App.js';
import { isDesktopEnvironment } from './lib/desktopBridge.js';

async function setupServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  const inDesktop = isDesktopEnvironment() || window.location.hostname === 'tauri.localhost';
  if (inDesktop) {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch {
      // 忽略清理异常
    }
    return;
  }

  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    });
  }
}

void setupServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
