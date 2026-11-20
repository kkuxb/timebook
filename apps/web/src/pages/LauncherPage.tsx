import { useEffect, useRef, useState, type FormEvent } from 'react';
import { desktopBridge } from '../lib/desktopBridge.js';
import { buildTagLookup, getTagStyle } from '../lib/labels.js';
import { useAppStore } from '../store/useAppStore.js';

export function LauncherPage() {
  const modules = useAppStore((s) => s.modules);
  const tags = useAppStore((s) => s.tags);
  const sessions = useAppStore((s) => s.sessions);
  const startTimer = useAppStore((s) => s.startTimer);

  const [title, setTitle] = useState('');
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);
  const startBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    document.body.style.overflow = 'hidden';
    inputRef.current?.focus();

    let unsub: (() => void) | null = null;
    void desktopBridge
      .subscribe({
        onLauncherOpened: () => {
          setTitle('');
          setTimeout(() => inputRef.current?.focus(), 20);
        },
      })
      .then((fn) => {
        unsub = fn;
      });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setTitle('');
        void desktopBridge.windowAction('hideLauncher');
        return;
      }
      if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
        const active = document.activeElement;
        if (active === cancelBtnRef.current) {
          return;
        }
        if (active !== inputRef.current && active !== startBtnRef.current) {
          e.preventDefault();
          formRef.current?.requestSubmit();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      unsub?.();
    };
  }, []);

  const lookup = buildTagLookup(modules, tags);

  // 优先按最近使用排序展示最多 8 个启用中的常用事项
  const enabledTagIds = new Set(lookup.enabledTags.map((t) => t.id));
  const orderedTagIds: string[] = [];
  const seen = new Set<string>();
  const sortedSessions = sessions
    .filter((s) => s.deleted_at === null && s.tag_id !== null)
    .sort((a, b) => b.start_at - a.start_at);
  for (const s of sortedSessions) {
    if (!s.tag_id || seen.has(s.tag_id) || !enabledTagIds.has(s.tag_id)) continue;
    seen.add(s.tag_id);
    orderedTagIds.push(s.tag_id);
    if (orderedTagIds.length >= 8) break;
  }
  for (const t of lookup.enabledTags) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    orderedTagIds.push(t.id);
    if (orderedTagIds.length >= 8) break;
  }

  const selectTag = (tagId: string | null) => {
    setSelectedTagId(tagId);
    inputRef.current?.focus();
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
          borderRadius: 24,
          padding: 18,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          boxShadow: '0 16px 36px -10px rgba(17, 24, 39, 0.25)',
        }}
      >
        <div
          data-tauri-drag-region
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            userSelect: 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: '#FFD43B',
                border: '2px solid #111827',
              }}
            />
            <span style={{ fontSize: 14, fontWeight: 800 }}>极速开始专注</span>
          </div>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#9CA3AF' }}>
            Enter 开始 · Esc 取消
          </span>
        </div>

        <input
          ref={inputRef}
          autoFocus
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="输入正在做的具体内容（可选，直接回车也可开始）"
          data-testid="launcher-title-input"
          className="tin"
          style={{ height: 44, fontSize: 15 }}
        />

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 74, overflowY: 'auto' }}>
          <button
            type="button"
            onClick={() => selectTag(null)}
            data-testid="launcher-tag-later"
            className="chip"
            style={{
              border: selectedTagId === null ? '2px solid #111827' : '1px solid #E1E4EC',
              background: selectedTagId === null ? '#F2F3F7' : '#FFFFFF',
              color: '#4B5263',
            }}
          >
            稍后再选
          </button>

          {orderedTagIds.map((id) => {
            const st = getTagStyle(id, lookup);
            const active = selectedTagId === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => selectTag(id)}
                data-testid={`launcher-tag-${id}`}
                className="chip"
                style={{
                  background: st.tint,
                  color: st.ink,
                  border: active ? '2px solid #111827' : `1px solid ${st.line}`,
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: st.color,
                  }}
                />
                <span>{st.tagName}</span>
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            ref={cancelBtnRef}
            type="button"
            onClick={() => {
              setTitle('');
              void desktopBridge.windowAction('hideLauncher');
            }}
            data-testid="launcher-cancel-btn"
            className="btn ghost"
            style={{ height: 36, padding: '0 14px', borderRadius: 10, fontSize: 13 }}
          >
            取消
          </button>
          <button
            ref={startBtnRef}
            type="submit"
            disabled={submitting}
            data-testid="launcher-start-btn"
            className="btn primary"
            style={{ height: 36, padding: '0 18px', borderRadius: 10, fontSize: 13 }}
          >
            立即开始
          </button>
        </div>
      </form>
    </div>
  );
}
