import { getPaletteEntry } from '@timebook/core';
import { buildTagLookup } from '../lib/labels.js';
import { useAppStore } from '../store/useAppStore.js';

interface TagPickerModalProps {
  open: boolean;
  onPick: (tagId: string) => void;
  onSkip: () => void;
}

export function TagPickerModal({ open, onPick, onSkip }: TagPickerModalProps) {
  const modules = useAppStore((s) => s.modules);
  const tags = useAppStore((s) => s.tags);

  if (!open) return null;
  const { activeModules, activeTags } = buildTagLookup(modules, tags);

  return (
    <div className="modal-backdrop" onClick={onSkip}>
      <div
        role="dialog"
        aria-label="选择标签"
        className="card modal-panel"
        style={{ maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 18 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <span className="chip" style={{ background: '#FFF6CC', color: '#7A5A00' }}>
            <span className="live" style={{ color: '#E5A800', width: 7, height: 7 }} />
            计时已经开始
          </span>
          <h2 style={{ margin: '10px 0 0', fontSize: 24, fontWeight: 800 }}>这次专注属于？</h2>
        </div>

        {activeModules.map((mod) => {
          const pal = getPaletteEntry(mod.color_key);
          const mTags = activeTags.filter((t) => t.module_id === mod.id);
          if (mTags.length === 0) return null;
          return (
            <div key={mod.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#6B7280' }}>{mod.name}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {mTags.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="btn"
                    onClick={() => onPick(t.id)}
                    style={{
                      height: 40,
                      padding: '0 16px',
                      borderRadius: 12,
                      background: pal.tint,
                      color: pal.ink,
                      fontSize: 14,
                    }}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          );
        })}

        <button
          type="button"
          onClick={onSkip}
          className="btn"
          style={{
            alignSelf: 'flex-start',
            height: 36,
            padding: 0,
            background: 'transparent',
            color: '#4B5263',
            fontSize: 14,
            textDecoration: 'underline',
          }}
        >
          稍后再选
        </button>
      </div>
    </div>
  );
}
