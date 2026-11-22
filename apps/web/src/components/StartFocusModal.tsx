import { useEffect, useRef, useState, type FormEvent } from 'react';
import { buildTagLookup, getTagStyle } from '../lib/labels.js';
import { useAppStore } from '../store/useAppStore.js';
import { ModuleTagGroups } from './ModuleTagGroups.js';

export interface StartFocusModalProps {
  open: boolean;
  onConfirm: (opts: { tagId: string | null; title: string | null }) => Promise<void> | void;
  onCancel: () => void;
}

/**
 * 今日页「开始专注」表单弹窗：
 * 先填写专注内容并按一级模块分类点选时间标签，仅在按回车或点击「开始」时创建并启动计时；
 * 点「取消」、遮罩、关闭或按 Esc 不产生任何记录。
 */
export function StartFocusModal({ open, onConfirm, onCancel }: StartFocusModalProps) {
  const modules = useAppStore((s) => s.modules);
  const tags = useAppStore((s) => s.tags);

  const [title, setTitle] = useState('');
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submittingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const clearTagBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setSelectedTagId(null);
    setSubmitting(false);
    submittingRef.current = false;
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 20);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!submittingRef.current) {
          onCancel();
        }
        return;
      }
      if (e.key === 'Enter') {
        const active = document.activeElement;
        if (
          active === cancelBtnRef.current ||
          active === closeBtnRef.current ||
          active === clearTagBtnRef.current
        ) {
          return;
        }
        e.preventDefault();
        formRef.current?.requestSubmit();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  const lookup = buildTagLookup(modules, tags);
  const selectedStyle = selectedTagId ? getTagStyle(selectedTagId, lookup) : null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await onConfirm({
        tagId: selectedTagId,
        title: title.trim() || null,
      });
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!submittingRef.current) onCancel();
      }}
    >
      <form
        ref={formRef}
        role="dialog"
        aria-modal="true"
        aria-label="开始专注"
        data-testid="start-focus-modal"
        className="card modal-panel"
        style={{ maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 18 }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => void handleSubmit(e)}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>开始专注</h2>
            <div style={{ marginTop: 4, fontSize: 13, fontWeight: 600, color: '#6B7280' }}>
              填写专注内容并点选标签，按回车或点击「开始」后正式计时
            </div>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={() => {
              if (!submittingRef.current) onCancel();
            }}
            className="btn ghost"
            aria-label="关闭"
            style={{ width: 34, height: 34, borderRadius: 10, padding: 0, flex: 'none' }}
          >
            ✕
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <label
            htmlFor="start-focus-title-input"
            style={{ fontSize: 13, fontWeight: 800, color: '#4B5263' }}
          >
            专注内容
          </label>
          <input
            id="start-focus-title-input"
            ref={inputRef}
            autoFocus
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="这次准备专注做什么？（可选，按 Enter 直接开始）"
            data-testid="start-focus-title-input"
            className="tin"
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: '#4B5263' }}>
              时间标签（按一级模块分类）
            </span>
            <span
              data-testid="start-focus-tag-hint"
              style={{
                fontSize: 12.5,
                fontWeight: 700,
                color: selectedStyle?.tag ? selectedStyle.ink : '#6B7280',
              }}
            >
              {selectedStyle?.tag
                ? `已选：${selectedStyle.moduleName} · ${selectedStyle.tagName}`
                : '当前：未分类'}
            </span>
          </div>

          <ModuleTagGroups
            lookup={lookup}
            selectedTagId={selectedTagId}
            onSelect={(id) => {
              setSelectedTagId(id);
              inputRef.current?.focus();
            }}
            maxHeight="42vh"
            testIdPrefix="start-focus-tag"
          />
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            paddingTop: 4,
          }}
        >
          <button
            ref={clearTagBtnRef}
            type="button"
            onClick={() => {
              setSelectedTagId(null);
              inputRef.current?.focus();
            }}
            className="btn"
            style={{
              height: 36,
              padding: 0,
              background: 'transparent',
              color: '#6B7280',
              fontSize: 13,
              textDecoration: 'underline',
            }}
          >
            不选标签（直接记为未分类）
          </button>

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              ref={cancelBtnRef}
              type="button"
              disabled={submitting}
              onClick={onCancel}
              data-testid="start-focus-cancel-btn"
              className="btn ghost"
              style={{ height: 44, padding: '0 20px', borderRadius: 12, fontSize: 14.5 }}
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting}
              data-testid="start-focus-submit-btn"
              className="btn primary"
              style={{ height: 44, padding: '0 26px', borderRadius: 12, fontSize: 14.5 }}
            >
              开始
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
