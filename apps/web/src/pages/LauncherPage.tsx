import { useEffect, useRef, useState, type FormEvent } from 'react';
import { getAllPendingTodos, getTodayTodos, toShanghaiDateStr, type TodoEntity } from '@timebook/core';
import { ModuleTagGroups } from '../components/ModuleTagGroups.js';
import { desktopBridge } from '../lib/desktopBridge.js';
import { buildTagLookup, getTagStyle } from '../lib/labels.js';
import { useAppStore } from '../store/useAppStore.js';

export function LauncherPage() {
  const modules = useAppStore((s) => s.modules);
  const tags = useAppStore((s) => s.tags);
  const sessions = useAppStore((s) => s.sessions);
  const todos = useAppStore((s) => s.todos);
  const todoChecks = useAppStore((s) => s.todoChecks);
  const nowMs = useAppStore((s) => s.nowMs);
  const startTimer = useAppStore((s) => s.startTimer);
  const syncFromBridgeUpdate = useAppStore((s) => s.syncFromBridgeUpdate);

  const [todoScope, setTodoScope] = useState<'all' | 'today'>('all');
  const [title, setTitle] = useState('');
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submittingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const clearTagBtnRef = useRef<HTMLButtonElement | null>(null);
  const scopeAllBtnRef = useRef<HTMLButtonElement | null>(null);
  const scopeTodayBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    document.body.style.overflow = 'hidden';
    void syncFromBridgeUpdate();
    inputRef.current?.focus();

    let unsub: (() => void) | null = null;
    void desktopBridge
      .subscribe({
        onLauncherOpened: () => {
          setTitle('');
          setSelectedTagId(null);
          void syncFromBridgeUpdate();
          setTimeout(() => inputRef.current?.focus(), 20);
        },
      })
      .then((fn) => {
        unsub = fn;
      });

    const onWindowFocus = () => {
      void syncFromBridgeUpdate();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!submittingRef.current) {
          setTitle('');
          setSelectedTagId(null);
          void desktopBridge.windowAction('hideLauncher');
        }
        return;
      }
      if (e.key === 'Enter') {
        const active = document.activeElement;
        if (
          active === cancelBtnRef.current ||
          active === closeBtnRef.current ||
          active === clearTagBtnRef.current ||
          active === scopeAllBtnRef.current ||
          active === scopeTodayBtnRef.current
        ) {
          return;
        }
        if (active instanceof HTMLElement && active.hasAttribute('data-quick-todo')) {
          return;
        }
        e.preventDefault();
        formRef.current?.requestSubmit();
      }
    };

    window.addEventListener('focus', onWindowFocus);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('focus', onWindowFocus);
      window.removeEventListener('keydown', onKeyDown);
      unsub?.();
    };
  }, [syncFromBridgeUpdate]);

  const lookup = buildTagLookup(modules, tags);
  const now = nowMs();
  const todayStr = toShanghaiDateStr(now);

  const pendingTodoItems =
    todoScope === 'all'
      ? getAllPendingTodos(todos, todoChecks, sessions, todayStr, now).filter((item) => !item.done)
      : getTodayTodos(todos, todoChecks, sessions, todayStr, now).items.filter((item) => !item.done);

  const selectedStyle = selectedTagId ? getTagStyle(selectedTagId, lookup) : null;

  const closeAndReset = () => {
    setTitle('');
    setSelectedTagId(null);
    void desktopBridge.windowAction('hideLauncher');
  };

  const handleQuickTodoStart = async (td: TodoEntity) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await startTimer({
        tagId: td.tag_id,
        title: td.title,
        todoId: td.id,
      });
      setTitle('');
      setSelectedTagId(null);
      await desktopBridge.windowAction('hideLauncher');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await startTimer({
        tagId: selectedTagId,
        title: title.trim() || null,
      });
      setTitle('');
      setSelectedTagId(null);
      await desktopBridge.windowAction('hideLauncher');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <div
      data-testid="launcher-root"
      style={{
        width: '100vw',
        height: '100vh',
        padding: 8,
        background: 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <form
        ref={formRef}
        onSubmit={(e) => void handleSubmit(e)}
        className="card"
        style={{
          width: '100%',
          maxHeight: '100%',
          borderRadius: 22,
          padding: '18px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          boxShadow: '0 20px 44px -14px rgba(17, 24, 39, 0.25)',
          overflow: 'hidden',
        }}
      >
        {/* 头部栏 */}
        <div
          data-tauri-drag-region
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            userSelect: 'none',
            flex: 'none',
          }}
        >
          <div data-tauri-drag-region style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: '#FFD43B',
                border: '2px solid #111827',
                flex: 'none',
              }}
            />
            <span style={{ fontSize: 16, fontWeight: 800 }}>新建专注</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#9CA3AF' }}>
              点待办秒开 · Enter 开始 · Esc 取消
            </span>
            <button
              ref={closeBtnRef}
              type="button"
              onClick={closeAndReset}
              data-testid="launcher-close-btn"
              className="btn soft"
              aria-label="收起选框"
              style={{ width: 28, height: 28, borderRadius: 8, fontSize: 13, padding: 0 }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* 操作区一：上方未完成待办简约小标签（点击直接开始） */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, flex: 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12.5, fontWeight: 800, color: '#4B5263' }}>
                点未完成待办直接开始
              </span>
              <span
                data-testid="launcher-todo-count"
                className="count tnum"
                style={{ height: 20, padding: '0 7px', fontSize: 11 }}
              >
                {pendingTodoItems.length}
              </span>
            </div>

            <div
              role="tablist"
              aria-label="快捷待办范围切换"
              style={{ display: 'flex', gap: 2, background: '#EEF0F5', padding: 2, borderRadius: 8 }}
            >
              <button
                ref={scopeAllBtnRef}
                type="button"
                role="tab"
                aria-selected={todoScope === 'all'}
                data-testid="launcher-todo-filter-all"
                onClick={() => setTodoScope('all')}
                className="btn"
                style={{
                  height: 22,
                  padding: '0 8px',
                  borderRadius: 6,
                  fontSize: 11,
                  background: todoScope === 'all' ? '#FFFFFF' : 'transparent',
                  color: todoScope === 'all' ? '#111827' : '#6B7280',
                }}
              >
                全部未完成
              </button>
              <button
                ref={scopeTodayBtnRef}
                type="button"
                role="tab"
                aria-selected={todoScope === 'today'}
                data-testid="launcher-todo-filter-today"
                onClick={() => setTodoScope('today')}
                className="btn"
                style={{
                  height: 22,
                  padding: '0 8px',
                  borderRadius: 6,
                  fontSize: 11,
                  background: todoScope === 'today' ? '#FFFFFF' : 'transparent',
                  color: todoScope === 'today' ? '#111827' : '#6B7280',
                }}
              >
                仅今日
              </button>
            </div>
          </div>

          <div
            data-testid="launcher-todo-list"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 6,
              maxHeight: 82,
              overflowY: 'auto',
              padding: '2px 0',
            }}
          >
            {pendingTodoItems.length === 0 ? (
              <span style={{ fontSize: 12, fontWeight: 600, color: '#9CA3AF', padding: '4px 2px' }}>
                当前范围内没有未完成待办
              </span>
            ) : (
              pendingTodoItems.map((item) => {
                const td = item.todo;
                const st = getTagStyle(td.tag_id, lookup);
                return (
                  <button
                    key={td.id}
                    type="button"
                    disabled={submitting}
                    data-quick-todo={td.id}
                    data-testid={`launcher-todo-${td.id}`}
                    title={`点击直接开始：${td.title}`}
                    onClick={() => void handleQuickTodoStart(td)}
                    className="todo-mini-tag"
                  >
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        background: st.color,
                        flex: 'none',
                      }}
                    />
                    <span className="todo-mini-title">{td.title}</span>
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      aria-hidden="true"
                      style={{ flex: 'none', opacity: 0.65 }}
                    >
                      <path d="M7 4.5v15a1 1 0 0 0 1.5.9l12-7.5a1 1 0 0 0 0-1.8l-12-7.5A1 1 0 0 0 7 4.5z" />
                    </svg>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div style={{ height: 1, background: '#EEF0F5', flex: 'none' }} />

        {/* 操作区二：下方填写专注内容 + 按一级模块分类点选时间标签 */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            minHeight: 0,
            flex: 1,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: '#4B5263' }}>
              或填写专注内容并选标签
            </span>
            <span
              data-testid="launcher-selected-hint"
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: selectedStyle?.tag ? selectedStyle.ink : '#6B7280',
              }}
            >
              {selectedStyle?.tag
                ? `已选：${selectedStyle.moduleName} · ${selectedStyle.tagName}`
                : '当前：未分类'}
            </span>
          </div>

          <input
            ref={inputRef}
            autoFocus
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="输入专注内容（可选，按 Enter 开始）"
            data-testid="launcher-title-input"
            className="tin"
            style={{ height: 40, fontSize: 14, flex: 'none' }}
          />

          <ModuleTagGroups
            lookup={lookup}
            selectedTagId={selectedTagId}
            onSelect={(id) => {
              setSelectedTagId(id);
              inputRef.current?.focus();
            }}
            compact
            maxHeight={185}
            testIdPrefix="launcher-tag"
          />
        </div>

        {/* 底部操作栏 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            paddingTop: 2,
            flex: 'none',
          }}
        >
          <button
            ref={clearTagBtnRef}
            type="button"
            onClick={() => {
              setSelectedTagId(null);
              inputRef.current?.focus();
            }}
            data-testid="launcher-clear-tag-btn"
            className="btn"
            style={{
              height: 34,
              padding: 0,
              background: 'transparent',
              color: '#6B7280',
              fontSize: 12.5,
              textDecoration: 'underline',
            }}
          >
            清空所选标签（记为未分类）
          </button>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              ref={cancelBtnRef}
              type="button"
              disabled={submitting}
              onClick={closeAndReset}
              data-testid="launcher-cancel-btn"
              className="btn ghost"
              style={{ height: 36, padding: '0 14px', borderRadius: 10, fontSize: 13 }}
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting}
              data-testid="launcher-start-btn"
              className="btn primary"
              style={{ height: 36, padding: '0 18px', borderRadius: 10, fontSize: 13 }}
            >
              开始
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
