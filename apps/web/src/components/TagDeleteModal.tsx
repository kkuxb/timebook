import { useEffect, useState } from 'react';
import { formatDurationLarge, getPaletteEntry } from '@timebook/core';
import { buildTagLookup } from '../lib/labels.js';
import { useAppStore } from '../store/useAppStore.js';

export type DeleteTarget = { kind: 'tag' | 'mod'; id: string } | null;

interface TagDeleteModalProps {
  target: DeleteTarget;
  onClose: () => void;
}

export function TagDeleteModal({ target, onClose }: TagDeleteModalProps) {
  const modules = useAppStore((s) => s.modules);
  const tags = useAppStore((s) => s.tags);
  const sessions = useAppStore((s) => s.sessions);
  const todos = useAppStore((s) => s.todos);
  const deleteTag = useAppStore((s) => s.deleteTag);
  const deleteModule = useAppStore((s) => s.deleteModule);

  const [mode, setMode] = useState<'move' | 'drop'>('move');
  const [targetId, setTargetId] = useState<string>('');

  useEffect(() => {
    setMode('move');
    setTargetId('');
  }, [target]);

  if (!target) return null;

  const lookup = buildTagLookup(modules, tags);
  const isTag = target.kind === 'tag';
  const obj = isTag
    ? lookup.tagById.get(target.id)
    : lookup.moduleById.get(target.id);
  if (!obj) return null;

  const modTagIds = isTag
    ? new Set([target.id])
    : new Set(lookup.activeTags.filter((t) => t.module_id === target.id).map((t) => t.id));

  const affectedDoneSessions = sessions.filter(
    (s) => s.deleted_at === null && s.end_at !== null && s.tag_id && modTagIds.has(s.tag_id),
  );
  const affectedTodos = todos.filter(
    (td) => td.deleted_at === null && td.tag_id && modTagIds.has(td.tag_id),
  );
  const totalMs = affectedDoneSessions.reduce((acc, s) => acc + (s.end_at! - s.start_at), 0);
  const hasData = isTag
    ? affectedDoneSessions.length > 0 || affectedTodos.length > 0
    : modTagIds.size > 0 || affectedDoneSessions.length > 0 || affectedTodos.length > 0;

  const candidates = isTag
    ? lookup.activeTags
        .filter((t) => t.id !== target.id)
        .map((t) => {
          const m = lookup.moduleById.get(t.module_id)!;
          const pal = getPaletteEntry(m.color_key);
          return { id: t.id, name: `${m.name} · ${t.name}`, color: pal.color, tint: pal.tint, ink: pal.ink };
        })
    : lookup.activeModules
        .filter((m) => m.id !== target.id)
        .map((m) => {
          const pal = getPaletteEntry(m.color_key);
          return { id: m.id, name: m.name, color: pal.color, tint: pal.tint, ink: pal.ink };
        });

  const canMove = candidates.length > 0;
  const effectiveMode = !canMove && hasData ? 'drop' : mode;
  const canConfirm = !hasData || effectiveMode === 'drop' || !!targetId;

  const SEL = 'inset 0 0 0 2px #111827';
  const UNSEL = 'inset 0 0 0 1.5px #E1E4EC';

  const handleConfirm = async () => {
    if (!canConfirm) return;
    const actualMode = hasData ? effectiveMode : 'drop';
    const resolvedTargetId =
      actualMode === 'move' && targetId ? targetId : undefined;
    if (isTag) {
      await deleteTag(target.id, actualMode, resolvedTargetId);
    } else {
      await deleteModule(target.id, actualMode, resolvedTargetId);
    }
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        role="dialog"
        aria-label={`删除${isTag ? '事项' : '模块'}「${obj.name}」`}
        className="card modal-panel"
        style={{ maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 16 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>
            删除{isTag ? '事项' : '模块'}「{obj.name}」
          </h2>
          <div style={{ marginTop: 6, fontSize: 14, fontWeight: 600, color: '#6B7280' }}>
            {hasData
              ? isTag
                ? `它下面有 ${affectedDoneSessions.length} 条专注记录（共 ${formatDurationLarge(totalMs)}）和 ${affectedTodos.length} 条待办。这些数据怎么处理？`
                : `它下面有 ${modTagIds.size} 个事项、${affectedDoneSessions.length} 条记录（共 ${formatDurationLarge(totalMs)}）。怎么处理？`
              : isTag
                ? '这个事项还没有任何关联记录或待办，可以直接删除。'
                : '这个模块是空的，可以直接删除。'}
          </div>
        </div>

        {hasData && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              background: '#F5F6FA',
              borderRadius: 18,
              padding: 10,
            }}
          >
            {canMove && (
              <>
                <button
                  type="button"
                  onClick={() => setMode('move')}
                  className="opt"
                  aria-pressed={effectiveMode === 'move'}
                  style={{ boxShadow: effectiveMode === 'move' ? SEL : UNSEL }}
                >
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#111827' }}>
                    {isTag ? '把这些记录和待办迁到另一个事项下' : '把这些事项移到另一个模块'}
                  </div>
                  <div style={{ marginTop: 2, fontSize: 13, fontWeight: 600, color: '#6B7280' }}>
                    统计时长保持不变，推荐
                  </div>
                </button>
                {effectiveMode === 'move' && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '2px 6px 6px' }}>
                    {candidates.map((x) => {
                      const sel = targetId === x.id;
                      return (
                        <button
                          key={x.id}
                          type="button"
                          onClick={() => setTargetId(x.id)}
                          className="btn"
                          aria-pressed={sel}
                          style={{
                            height: 36,
                            padding: '0 12px',
                            borderRadius: 10,
                            fontSize: 13,
                            background: sel ? x.tint : '#FFFFFF',
                            color: sel ? x.ink : '#374151',
                            boxShadow: sel ? `inset 0 0 0 2px ${x.color}` : UNSEL,
                          }}
                        >
                          <span
                            style={{ width: 7, height: 7, borderRadius: '50%', background: x.color }}
                          />
                          {x.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            <button
              type="button"
              onClick={() => setMode('drop')}
              className="opt"
              aria-pressed={effectiveMode === 'drop'}
              style={{
                boxShadow: effectiveMode === 'drop' ? 'inset 0 0 0 2px #E11D48' : UNSEL,
              }}
            >
              <div style={{ fontSize: 15, fontWeight: 800, color: '#C8203E' }}>
                {isTag
                  ? `连同 ${affectedDoneSessions.length} 条记录一起删除`
                  : `连同事项和 ${affectedDoneSessions.length} 条记录一起删除`}
              </div>
              <div style={{ marginTop: 2, fontSize: 13, fontWeight: 600, color: '#6B7280' }}>
                统计里会少掉 {formatDurationLarge(totalMs)}（30 天内可在回收站恢复）；关联待办和进行中计时会保留并转为未分类
              </div>
            </button>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button
            type="button"
            onClick={onClose}
            className="btn ghost"
            style={{ height: 46, padding: '0 20px', borderRadius: 12, fontSize: 15 }}
          >
            取消
          </button>
          <button
            type="button"
            disabled={!canConfirm}
            onClick={() => void handleConfirm()}
            className="btn"
            style={{
              height: 46,
              padding: '0 22px',
              borderRadius: 12,
              fontSize: 15,
              background: '#E11D48',
              color: '#FFFFFF',
              opacity: canConfirm ? 1 : 0.45,
            }}
          >
            删除
          </button>
        </div>
      </div>
    </div>
  );
}
