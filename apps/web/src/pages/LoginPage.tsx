import { useEffect, useState, type FormEvent } from 'react';
import { useAppStore } from '../store/useAppStore.js';

export function LoginPage() {
  const login = useAppStore((s) => s.login);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockSec, setLockSec] = useState(0);

  useEffect(() => {
    if (lockSec <= 0) return;
    const t = setTimeout(() => setLockSec((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [lockSec]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password || busy || lockSec > 0) return;
    setBusy(true);
    setError(null);
    const res = await login(password);
    setBusy(false);
    if (!res.ok) {
      setError(res.error || '登录失败');
      if (res.retryAfterSec) {
        setLockSec(res.retryAfterSec);
      }
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        background: '#F6F7FA',
      }}
    >
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="card rise"
        style={{
          width: '100%',
          maxWidth: 400,
          padding: 32,
          borderRadius: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 14,
              background: '#FFD43B',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg
              width="24"
              height="24"
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
          <div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>时间簿</h1>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#6B7280' }}>
              输入个人访问口令解锁工作区
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label htmlFor="loginPassword" style={{ fontSize: 13, fontWeight: 800, color: '#4B5263' }}>
            访问口令
          </label>
          <input
            id="loginPassword"
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="请输入访问口令…"
            className="tin"
          />
        </div>

        {error && (
          <div
            role="alert"
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: '#C8203E',
              background: '#FFEDF0',
              padding: '10px 12px',
              borderRadius: 12,
            }}
          >
            {error}
            {lockSec > 0 ? `（${lockSec} 秒后可重试）` : ''}
          </div>
        )}

        <button
          type="submit"
          disabled={busy || !password || lockSec > 0}
          className="btn primary"
          style={{
            height: 48,
            borderRadius: 14,
            fontSize: 16,
            opacity: busy || !password || lockSec > 0 ? 0.55 : 1,
          }}
        >
          {busy ? '正在验证…' : '进入时间簿'}
        </button>
      </form>
    </div>
  );
}
