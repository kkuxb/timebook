import { useState } from 'react';
import {
  COLOR_KEYS,
  formatDurationLarge,
  getPaletteEntry,
  MODULE_PALETTE,
  type ColorKey,
  type ModuleEntity,
  type TagEntity,
} from '@timebook/core';
import { ulid } from 'ulid';
import { TagDeleteModal, type DeleteTarget } from '../components/TagDeleteModal.js';
import { buildTagLookup } from '../lib/labels.js';
import { useAppStore } from '../store/useAppStore.js';

interface ModuleModalState {
  mode: 'new' | 'edit';
  id?: string;
  name: string;
  colorKey: ColorKey;
  sort: number;
  createdAt?: number;
}

interface TagModalState {
  mode: 'new' | 'edit';
  id?: string;
  name: string;
  moduleId: string;
  originalModuleId: string;
  sort: number;
  createdAt?: number;
}

export function TagsPage() {
  const modules = useAppStore((s) => s.modules);
  const tags = useAppStore((s) => s.tags);
  const sessions = useAppStore((s) => s.sessions);
  const nowMs = useAppStore((s) => s.nowMs);
  const upsertModule = useAppStore((s) => s.upsertModule);
  const upsertTag = useAppStore((s) => s.upsertTag);

  const [modModal, setModModal] = useState<ModuleModalState | null>(null);
  const [tagModal, setTagModal] = useState<TagModalState | null>(null);
  const [delTarget, setDelTarget] = useState<DeleteTarget>(null);

  const lookup = buildTagLookup(modules, tags);

  // 统计每个事项累计时长与次数（仅已结束未删除记录）
  const tagMs = new Map<string, number>();
  const tagCnt = new Map<string, number>();
  for (const s of sessions) {
    if (s.deleted_at !== null || s.end_at === null || !s.tag_id) continue;
    const dur = Math.max(0, s.end_at - s.start_at);
    tagMs.set(s.tag_id, (tagMs.get(s.tag_id) ?? 0) + dur);
    tagCnt.set(s.tag_id, (tagCnt.get(s.tag_id) ?? 0) + 1);
  }

  const openNewModule = () => {
    const used = new Set(lookup.activeModules.map((m) => m.color_key));
    const free = COLOR_KEYS.find((k) => !used.has(k)) ?? 'blue';
    setModModal({
      mode: 'new',
      name: '',
      colorKey: free,
      sort: lookup.activeModules.length,
    });
  };

  const handleSaveModule = async () => {
    if (!modModal) return;
    const nm = modModal.name.trim();
    if (!nm) return;
    const ts = nowMs();
    await upsertModule({
      id: modModal.id ?? ulid(),
      name: nm,
      color_key: modModal.colorKey,
      sort: modModal.sort,
      created_at: modModal.createdAt ?? ts,
      updated_at: ts,
      deleted_at: null,
    });
    setModModal(null);
  };

  const tagDup =
    tagModal &&
    tagModal.name.trim().length > 0 &&
    lookup.activeTags.some(
      (t) =>
        t.module_id === tagModal.moduleId &&
        t.name === tagModal.name.trim() &&
        t.id !== tagModal.id,
    );

  const handleSaveTag = async () => {
    if (!tagModal || tagDup) return;
    const nm = tagModal.name.trim();
    if (!nm) return;
    const ts = nowMs();
    await upsertTag({
      id: tagModal.id ?? ulid(),
      module_id: tagModal.moduleId,
      name: nm,
      sort: tagModal.sort,
      created_at: tagModal.createdAt ?? ts,
      updated_at: ts,
      deleted_at: null,
    });
    setTagModal(null);
  };

  const SEL = 'inset 0 0 0 2px #111827';
  const UNSEL = 'inset 0 0 0 1.5px #E1E4EC';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <section
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 34, lineHeight: 1.15, fontWeight: 800, letterSpacing: '-0.02em' }}>
            标签
          </h1>
          <div style={{ marginTop: 6, fontSize: 14, fontWeight: 600, color: '#6B7280' }}>
            模块（一级）下面挂具体事项（二级）。事项的颜色跟随所属模块。
          </div>
        </div>
        <button
          type="button"
          onClick={openNewModule}
          className="btn primary"
          style={{ height: 44, padding: '0 18px', borderRadius: 12, fontSize: 14 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          新建模块
        </button>
      </section>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))',
          gap: 16,
          alignItems: 'start',
        }}
      >
        {lookup.activeModules.map((mod: ModuleEntity) => {
          const pal = getPaletteEntry(mod.color_key);
          const mTags = lookup.activeTags
            .filter((t) => t.module_id === mod.id)
            .sort((a, b) => (tagMs.get(b.id) ?? 0) - (tagMs.get(a.id) ?? 0));
          const totalMs = mTags.reduce((acc, t) => acc + (tagMs.get(t.id) ?? 0), 0);
          const totalRecs = mTags.reduce((acc, t) => acc + (tagCnt.get(t.id) ?? 0), 0);

          return (
            <section
              key={mod.id}
              className="card lift rise"
              aria-label={mod.name}
              style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}
            >
              <div className="mhead" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 14, height: 14, borderRadius: 4, background: pal.color, flex: 'none' }} />
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, flex: 1, minWidth: 0 }}>
                  {mod.name}
                </h2>
                <button
                  type="button"
                  onClick={() =>
                    setModModal({
                      mode: 'edit',
                      id: mod.id,
                      name: mod.name,
                      colorKey: mod.color_key,
                      sort: mod.sort,
                      createdAt: mod.created_at,
                    })
                  }
                  className="btn tiny act"
                  aria-label={`修改模块 ${mod.name}`}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4 20h4L19 9l-4-4L4 16z" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => setDelTarget({ kind: 'mod', id: mod.id })}
                  className="btn tiny del act"
                  aria-label={`删除模块 ${mod.name}`}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
                  </svg>
                </button>
              </div>

              <div
                style={{
                  display: 'flex',
                  gap: 16,
                  padding: '12px 14px',
                  borderRadius: 14,
                  background: pal.tint,
                }}
              >
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: pal.ink }}>累计</div>
                  <div className="tnum" style={{ fontSize: 20, fontWeight: 800, color: pal.ink }}>
                    {formatDurationLarge(totalMs)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: pal.ink }}>事项</div>
                  <div className="tnum" style={{ fontSize: 20, fontWeight: 800, color: pal.ink }}>
                    {mTags.length}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: pal.ink }}>记录</div>
                  <div className="tnum" style={{ fontSize: 20, fontWeight: 800, color: pal.ink }}>
                    {totalRecs.toLocaleString('en-US')}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {mTags.length === 0 ? (
                  <div style={{ padding: 10, fontSize: 13, fontWeight: 600, color: '#9CA3AF' }}>
                    还没有事项
                  </div>
                ) : (
                  mTags.map((t: TagEntity) => {
                    const ms = tagMs.get(t.id) ?? 0;
                    const cnt = tagCnt.get(t.id) ?? 0;
                    const pct = totalMs > 0 ? Math.round((ms / totalMs) * 100) : 0;
                    return (
                      <div
                        key={t.id}
                        className="trow"
                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px 8px 10px' }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                            <span
                              style={{
                                fontSize: 15,
                                fontWeight: 700,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {t.name}
                            </span>
                            <span className="tnum" style={{ fontSize: 13, fontWeight: 800, whiteSpace: 'nowrap' }}>
                              {formatDurationLarge(ms)}
                            </span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                            <div style={{ flex: 1, height: 5, borderRadius: 999, background: '#F0F1F5', overflow: 'hidden' }}>
                              <div
                                style={{
                                  width: `${pct}%`,
                                  height: '100%',
                                  borderRadius: 999,
                                  background: pal.color,
                                }}
                              />
                            </div>
                            <span
                              className="tnum"
                              style={{
                                width: 96,
                                whiteSpace: 'nowrap',
                                textAlign: 'right',
                                fontSize: 12,
                                fontWeight: 700,
                                color: '#6B7280',
                              }}
                            >
                              {pct}% · {cnt.toLocaleString('en-US')} 次
                            </span>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            setTagModal({
                              mode: 'edit',
                              id: t.id,
                              name: t.name,
                              moduleId: t.module_id,
                              originalModuleId: t.module_id,
                              sort: t.sort,
                              createdAt: t.created_at,
                            })
                          }
                          className="btn tiny act"
                          aria-label={`修改事项 ${t.name}`}
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M4 20h4L19 9l-4-4L4 16z" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => setDelTarget({ kind: 'tag', id: t.id })}
                          className="btn tiny del act"
                          aria-label={`删除事项 ${t.name}`}
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
                          </svg>
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              <button
                type="button"
                onClick={() =>
                  setTagModal({
                    mode: 'new',
                    name: '',
                    moduleId: mod.id,
                    originalModuleId: mod.id,
                    sort: mTags.length,
                  })
                }
                className="btn soft"
                style={{ height: 40, borderRadius: 12, fontSize: 14 }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                新建事项
              </button>
            </section>
          );
        })}
      </div>

      <div style={{ fontSize: 12, fontWeight: 600, color: '#9CA3AF' }}>
        鼠标移到事项或模块标题上，会出现修改和删除按钮。百分比是该事项在模块里的占比。
      </div>

      {/* 新建/修改事项弹窗 */}
      {tagModal && (
        <div className="modal-backdrop" onClick={() => setTagModal(null)}>
          <div
            role="dialog"
            aria-label={tagModal.mode === 'edit' ? '修改事项' : '新建事项'}
            className="card modal-panel"
            style={{ maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 20 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>
              {tagModal.mode === 'edit' ? '修改事项' : '新建事项'}
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label htmlFor="tagNameInput" style={{ fontSize: 13, fontWeight: 800, color: '#4B5263' }}>
                名称
              </label>
              <input
                id="tagNameInput"
                className="tin"
                value={tagModal.name}
                onChange={(e) => setTagModal({ ...tagModal, name: e.target.value })}
                placeholder="比如：英语、羽毛球、Zelda…"
              />
              {tagDup && (
                <div style={{ fontSize: 12, fontWeight: 700, color: '#C8203E' }}>
                  这个模块里已经有同名事项了
                </div>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#4B5263' }}>属于哪个模块</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {lookup.activeModules.map((m) => {
                  const p = getPaletteEntry(m.color_key);
                  const sel = tagModal.moduleId === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setTagModal({ ...tagModal, moduleId: m.id })}
                      className="btn"
                      aria-pressed={sel}
                      style={{
                        height: 38,
                        padding: '0 14px',
                        borderRadius: 10,
                        fontSize: 14,
                        background: sel ? p.tint : '#FFFFFF',
                        color: sel ? p.ink : '#374151',
                        boxShadow: sel ? `inset 0 0 0 2px ${p.color}` : UNSEL,
                      }}
                    >
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color }} />
                      {m.name}
                    </button>
                  );
                })}
              </div>
              {tagModal.mode === 'edit' && tagModal.moduleId !== tagModal.originalModuleId && tagModal.id && (
                <div style={{ fontSize: 12, fontWeight: 600, color: '#6B7280' }}>
                  换模块后，这个事项过去的 {tagCnt.get(tagModal.id) ?? 0} 条记录会一起算到新模块里。
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                onClick={() => setTagModal(null)}
                className="btn ghost"
                style={{ height: 46, padding: '0 20px', borderRadius: 12, fontSize: 15 }}
              >
                取消
              </button>
              <button
                type="button"
                disabled={!tagModal.name.trim() || !!tagDup}
                onClick={() => void handleSaveTag()}
                className="btn primary"
                style={{
                  height: 46,
                  padding: '0 26px',
                  borderRadius: 12,
                  fontSize: 15,
                  opacity: tagModal.name.trim() && !tagDup ? 1 : 0.45,
                }}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 新建/修改模块弹窗 */}
      {modModal && (() => {
        const pal = getPaletteEntry(modModal.colorKey);
        const owner = lookup.activeModules.find(
          (m) => m.id !== modModal.id && m.color_key === modModal.colorKey,
        );
        const usedColors = new Set(
          lookup.activeModules.filter((m) => m.id !== modModal.id).map((m) => m.color_key),
        );
        return (
          <div className="modal-backdrop" onClick={() => setModModal(null)}>
            <div
              role="dialog"
              aria-label={modModal.mode === 'edit' ? '修改模块' : '新建模块'}
              className="card modal-panel"
              style={{ maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 20 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>
                {modModal.mode === 'edit' ? '修改模块' : '新建模块'}
              </h2>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label htmlFor="modNameInput" style={{ fontSize: 13, fontWeight: 800, color: '#4B5263' }}>
                  名称
                </label>
                <input
                  id="modNameInput"
                  className="tin"
                  value={modModal.name}
                  onChange={(e) => setModModal({ ...modModal, name: e.target.value })}
                  placeholder="比如：阅读、副业…"
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#4B5263' }}>颜色</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  {COLOR_KEYS.map((k) => {
                    const p = MODULE_PALETTE[k];
                    const sel = modModal.colorKey === k;
                    const isUsed = usedColors.has(k);
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setModModal({ ...modModal, colorKey: k })}
                        className="sw"
                        aria-label={`${p.label}${isUsed ? '（已被使用）' : ''}`}
                        aria-pressed={sel}
                        title={`${p.label}${isUsed ? '（已被使用）' : ''}`}
                        style={{
                          background: p.color,
                          boxShadow: sel ? '0 0 0 3px #FFFFFF, 0 0 0 5px #111827' : 'none',
                          opacity: isUsed && !sel ? 0.35 : 1,
                        }}
                      />
                    );
                  })}
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: owner ? '#9A3A0A' : '#6B7280' }}>
                  {owner
                    ? `这个颜色「${owner.name}」也在用，两个模块在图表里会分不清，建议换一个`
                    : '日历、统计、时间条里都会用这个颜色'}
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '12px 14px',
                  borderRadius: 14,
                  background: pal.tint,
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 700, color: '#6B7280' }}>预览</span>
                <span className="chip" style={{ background: '#FFFFFF', color: pal.ink }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: pal.color }} />
                  {modModal.name.trim() || '模块名'}
                </span>
                <span style={{ flex: 1, height: 10, borderRadius: 4, background: pal.color }} />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setModModal(null)}
                  className="btn ghost"
                  style={{ height: 46, padding: '0 20px', borderRadius: 12, fontSize: 15 }}
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={!modModal.name.trim()}
                  onClick={() => void handleSaveModule()}
                  className="btn primary"
                  style={{
                    height: 46,
                    padding: '0 26px',
                    borderRadius: 12,
                    fontSize: 15,
                    opacity: modModal.name.trim() ? 1 : 0.45,
                  }}
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      <TagDeleteModal target={delTarget} onClose={() => setDelTarget(null)} />
    </div>
  );
}
